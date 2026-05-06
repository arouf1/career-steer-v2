import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { embedBatch } from "../lib/ai/providers";
import { buildJobEmbeddingTexts } from "../lib/ai/prompts/job-embedding-text";

const EMBED_DIM = 1536;
const EMBED_MODEL = "google/gemini-embedding-2-preview";

const BACKFILL_BATCH_SIZE = 5;
const BACKFILL_STAGGER_MS = 2_000;

const RELATED_LIMIT_DEFAULT = 4;
// Vector index reads have a hard `limit` of 256 — we ask for slightly more
// than we need so we can drop the self-match and still return `limit` items.
const RELATED_OVERSCAN = 4;

// ── Reads ─────────────────────────────────────────────────────────────────

export const byJobPosting = internalQuery({
  args: { jobPostingId: v.id("job_postings") },
  handler: async (
    ctx,
    args,
  ): Promise<Doc<"job_posting_embeddings"> | null> => {
    return await ctx.db
      .query("job_posting_embeddings")
      .withIndex("by_jobPostingId", (q) =>
        q.eq("jobPostingId", args.jobPostingId),
      )
      .unique();
  },
});

// ── Upsert ────────────────────────────────────────────────────────────────

export const upsert = internalMutation({
  args: {
    jobPostingId: v.id("job_postings"),
    wholeVector: v.array(v.float64()),
    arcVector: v.array(v.float64()),
    currentStateVector: v.array(v.float64()),
    domainVector: v.array(v.float64()),
    dimensions: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("job_posting_embeddings")
      .withIndex("by_jobPostingId", (q) =>
        q.eq("jobPostingId", args.jobPostingId),
      )
      .unique();

    const doc = {
      jobPostingId: args.jobPostingId,
      wholeVector: args.wholeVector,
      arcVector: args.arcVector,
      currentStateVector: args.currentStateVector,
      domainVector: args.domainVector,
      dimensions: args.dimensions,
      model: args.model,
      generatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("job_posting_embeddings", doc);
    }
    // No fan-out yet — Discover doesn't consume job vectors. When a "Jobs
    // for You" canvas lands, hook it here (mirroring guideEmbeddings.upsert
    // → discover.fanOutGuideUpdate).
  },
});

// ── Generate ──────────────────────────────────────────────────────────────

export const _loadGenerationContext = internalQuery({
  args: { jobPostingId: v.id("job_postings") },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) return null;
    const company = await ctx.db.get(posting.companyId);
    if (!company) return null;
    return {
      title: posting.title,
      companyName: company.nameRaw,
      city: posting.city,
      countryCode: posting.countryCode ?? null,
      schedule: posting.detectedExtensions?.schedule ?? null,
      workFromHome: posting.detectedExtensions?.workFromHome ?? null,
      salary: posting.detectedExtensions?.salary ?? null,
      content: posting.content
        ? {
            overview: posting.content.overview,
            theRole: posting.content.theRole,
            whatStandsOut: posting.content.whatStandsOut,
            idealCandidate: posting.content.idealCandidate,
            compSummary: posting.content.compSummary,
          }
        : null,
      roleArchetypeSlug: posting.roleArchetypeSlug ?? null,
    };
  },
});

export const generate = internalAction({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ctxRow = await ctx.runQuery(
      internal.jobPostingEmbeddings._loadGenerationContext,
      { jobPostingId: args.jobPostingId },
    );
    if (!ctxRow) {
      console.error("jobPostingEmbeddings.generate:posting_missing", {
        jobPostingId: args.jobPostingId,
      });
      return null;
    }
    // Hard guard: never embed an unrewritten posting. The facet builder
    // would technically run (it falls back to header-only signal) but the
    // resulting vectors would be thin and pollute related-jobs / future
    // matching. The natural trigger is _markContentComplete which patches
    // content BEFORE scheduling this action, so this branch should be
    // unreachable from the happy path. It catches manual dashboard runs
    // or any future code that fires this directly.
    if (!ctxRow.content) {
      console.warn("jobPostingEmbeddings.generate:no-content-skipping", {
        jobPostingId: args.jobPostingId,
      });
      return null;
    }

    const texts = buildJobEmbeddingTexts(ctxRow);

    try {
      const [wholeVector, arcVector, currentStateVector, domainVector] =
        await embedBatch(
          [
            { text: texts.whole, taskHint: "sentence similarity" },
            { text: texts.arc, taskHint: "sentence similarity" },
            { text: texts.currentState, taskHint: "sentence similarity" },
            { text: texts.domain, taskHint: "sentence similarity" },
          ],
          { outputDimensionality: EMBED_DIM, model: EMBED_MODEL },
        );

      for (const [name, vec] of [
        ["whole", wholeVector],
        ["arc", arcVector],
        ["currentState", currentStateVector],
        ["domain", domainVector],
      ] as const) {
        if (vec.length !== EMBED_DIM) {
          throw new Error(
            `${name} embedding has ${vec.length} dims, expected ${EMBED_DIM}`,
          );
        }
      }

      await ctx.runMutation(internal.jobPostingEmbeddings.upsert, {
        jobPostingId: args.jobPostingId,
        wholeVector,
        arcVector,
        currentStateVector,
        domainVector,
        dimensions: EMBED_DIM,
        model: EMBED_MODEL,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.slice(0, 500) : "unknown error";
      console.error("jobPostingEmbeddings.generate:failed", {
        jobPostingId: args.jobPostingId,
        reason,
      });
    }
    return null;
  },
});

// ── Backfill ─────────────────────────────────────────────────────────────

export const _missingEmbeddingIds = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<Id<"job_postings">[]> => {
    // Only consider postings whose content has landed — embedding raw
    // descriptions is wasteful since we'd just regenerate after the rewrite.
    const candidates = await ctx.db
      .query("job_postings")
      .withIndex("by_contentStatus_firstSeenAt", (q) =>
        q.eq("contentStatus", "complete"),
      )
      .take(args.limit * 4); // overscan; many already have embeddings
    const missing: Id<"job_postings">[] = [];
    for (const p of candidates) {
      if (missing.length >= args.limit) break;
      const existing = await ctx.db
        .query("job_posting_embeddings")
        .withIndex("by_jobPostingId", (q) => q.eq("jobPostingId", p._id))
        .unique();
      if (!existing) missing.push(p._id);
    }
    return missing;
  },
});

export const backfillBatch = internalAction({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const limit = args.limit ?? BACKFILL_BATCH_SIZE;
    const ids: Id<"job_postings">[] = await ctx.runQuery(
      internal.jobPostingEmbeddings._missingEmbeddingIds,
      { limit },
    );
    for (let i = 0; i < ids.length; i += 1) {
      await ctx.scheduler.runAfter(
        i * BACKFILL_STAGGER_MS,
        internal.jobPostingEmbeddings.generate,
        { jobPostingId: ids[i] },
      );
    }
    return { scheduled: ids.length };
  },
});

// ── Related-jobs read API ─────────────────────────────────────────────────
//
// Public (no auth) action — called from the SSR'd /jobs/listing/... page.
// Vector-search has to be an action (not a query) because vectorSearch is
// only available on action ctx.

type RelatedJobHit = {
  jobPostingId: Id<"job_postings">;
  score: number;
  title: string;
  companyName: string;
  city: string;
  citySlug: string;
  companySlug: string;
  titleSlug: string;
  illustrationUrl: string | null;
  overviewSnippet: string;
};

const RELATED_SNIPPET_MAX = 180;

const smartTruncate = (s: string, max: number): string => {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
};

export const relatedByPostingId = action({
  args: {
    jobPostingId: v.id("job_postings"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      jobPostingId: v.id("job_postings"),
      score: v.number(),
      title: v.string(),
      companyName: v.string(),
      city: v.string(),
      citySlug: v.string(),
      companySlug: v.string(),
      titleSlug: v.string(),
      illustrationUrl: v.union(v.string(), v.null()),
      overviewSnippet: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<RelatedJobHit[]> => {
    const limit = args.limit ?? RELATED_LIMIT_DEFAULT;

    const sourceEmbedding = await ctx.runQuery(
      internal.jobPostingEmbeddings.byJobPosting,
      { jobPostingId: args.jobPostingId },
    );
    if (!sourceEmbedding) return [];

    const hits: Array<{
      _id: Id<"job_posting_embeddings">;
      _score: number;
    }> = await ctx.vectorSearch("job_posting_embeddings", "by_whole", {
      vector: sourceEmbedding.wholeVector,
      limit: limit + RELATED_OVERSCAN,
    });

    // Hydrate hit rows + drop the self-match. Inactive postings are also
    // excluded — we don't want to send a reader to an archived listing.
    const enriched = await ctx.runQuery(
      internal.jobPostingEmbeddings._hydrateRelated,
      {
        embeddingIds: hits.map((h) => h._id),
        excludeJobPostingId: args.jobPostingId,
        scoresById: hits.map((h) => ({ id: h._id, score: h._score })),
      },
    );

    return enriched.slice(0, limit);
  },
});

export const _hydrateRelated = internalQuery({
  args: {
    embeddingIds: v.array(v.id("job_posting_embeddings")),
    excludeJobPostingId: v.id("job_postings"),
    scoresById: v.array(
      v.object({ id: v.id("job_posting_embeddings"), score: v.number() }),
    ),
  },
  handler: async (ctx, args): Promise<RelatedJobHit[]> => {
    const scoreLookup = new Map(args.scoresById.map((s) => [s.id, s.score]));
    const out: RelatedJobHit[] = [];

    for (const embeddingId of args.embeddingIds) {
      const embedding = await ctx.db.get(embeddingId);
      if (!embedding) continue;
      if (embedding.jobPostingId === args.excludeJobPostingId) continue;
      const posting = await ctx.db.get(embedding.jobPostingId);
      if (!posting || !posting.isActive) continue;
      const company = await ctx.db.get(posting.companyId);
      if (!company) continue;
      const illustrationUrl = posting.illustrationStorageId
        ? await ctx.storage.getUrl(posting.illustrationStorageId)
        : null;
      const snippetSource =
        posting.content?.overview ?? posting.rawDescription ?? "";
      out.push({
        jobPostingId: posting._id,
        score: scoreLookup.get(embeddingId) ?? 0,
        title: posting.title,
        companyName: company.nameRaw,
        city: posting.city,
        citySlug: posting.citySlug,
        companySlug: company.slug,
        titleSlug: posting.titleSlug,
        illustrationUrl,
        overviewSnippet: smartTruncate(snippetSource, RELATED_SNIPPET_MAX),
      });
    }
    return out;
  },
});
