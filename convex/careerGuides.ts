import { v } from "convex/values";
import { generateText, Output } from "ai";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { chatModel } from "../lib/ai/providers";
import {
  CAREER_STAGE_MODEL_ID,
  CONTENT_MODEL_ID,
  CareerStageSchema,
  ContentResponseGroundedSchema,
  ContentResponseSchema,
  DedupResponseSchema,
  ENRICHMENT_TASKS,
  FIELD_PATH_TO_USED_KEY,
  JUDGE_MODEL_ID,
  MetaOnlySchema,
  SalaryJudgeSchema,
  SkillsDetailOnlySchema,
  VALIDATION_MODEL_ID,
  ValidationResponseSchema,
  buildCareerStagePrompt,
  buildContentPrompt,
  buildDedupPrompt,
  buildEnrichmentQuery,
  buildGroundedContentPrompt,
  buildMetaPrompt,
  buildSalaryJudgePrompt,
  buildSkillsDetailPrompt,
  buildValidationPrompt,
} from "../lib/ai/prompts/career-guides";
import type {
  EnrichmentTask,
  GroundedResearch,
} from "../lib/ai/prompts/career-guides";
import { tryConsumeRateLimit } from "./lib/rateLimit";
import {
  findGuideByExactTitle,
  searchGuideCandidates,
} from "./lib/dedup";
import { normalizeTitle, slugify } from "./lib/normalize";
import {
  constructImagePrompt,
  SECTION_SLOTS,
  type SectionSlot,
} from "./lib/imagePrompts";
import { buildImageMessages } from "./lib/imageReference";
import { exaAnswer, type Citation } from "../lib/server/exa";

const RUN_TIMEOUT_MS = 180_000;
const ENRICHMENT_TIMEOUT_MS = 90_000;
const ENRICHMENT_CONCURRENCY = 6;
const ENRICHMENT_MAX_ATTEMPTS = 2;
const ENRICHMENT_RETRY_DELAY_MS = 60_000;
const ENRICHMENT_TOTAL = ENRICHMENT_TASKS.length;
// Threshold for taking the grounded path. If fewer than this many of the 8
// pre-content Exa fan-out tasks succeed, treat as a systemic Exa issue and
// fall back to ungrounded content + deferred enrichment.
const MIN_GROUNDED_TASKS = 4;
// How long after fallback publication to retry full Exa enrichment.
const DEFERRED_ENRICHMENT_DELAY_MS = 60 * 60 * 1000;
const VALIDATE_RATE = { max: 15, windowMs: 60_000 };
const GENERATE_RATE = { max: 3, windowMs: 300_000 };
const IMAGE_MODEL_ID = "google/gemini-3.1-flash-image-preview";

// Failed-content auto-retry policy. Initial attempt + 2 auto-retries = 3 total
// before the cron and page-load triggers stop firing. The "Try again" button
// in the failed UI bypasses the cap (force=true) so users always have a path
// out of a permanently-stuck guide.
const CONTENT_MAX_ATTEMPTS = 3;
const CONTENT_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
const CONTENT_RETRY_BATCH_SIZE = 5;
const CONTENT_RETRY_STAGGER_MS = 10_000;
const RETRY_RATE = { max: 1, windowMs: 30_000 };

const salaryValidator = v.object({
  entry: v.string(),
  mid: v.string(),
  senior: v.string(),
  note: v.optional(v.string()),
});

const regionalBlockValidator = v.object({
  salary: salaryValidator,
  careerOutlook: v.string(),
  learningPath: v.array(v.string()),
  relatedRoles: v.array(v.string()),
});

const citationValidator = v.object({
  url: v.string(),
  title: v.string(),
  publisher: v.optional(v.string()),
  fetchedAt: v.number(),
});

const sectionSlotValidator = v.union(
  v.literal("day-to-day"),
  v.literal("outlook"),
  v.literal("learning-path"),
  v.literal("risks"),
);

// Validator mirrors the schema's record shape rather than enumerating keys
// — Convex v.object rejects identifiers with hyphens, but section IDs use
// kebab-case ("day-to-day", "outlook-us", etc.) per FOLLOW_UP_SECTION_IDS.
const followUpsValidator = v.record(v.string(), v.array(v.string()));

const metaValidator = v.object({
  title: v.string(),
  description: v.string(),
  keywords: v.array(v.string()),
  socialAlt: v.string(),
});

const contentValidator = v.object({
  overview: v.string(),
  typicalSkills: v.array(v.string()),
  typicalSkillsDetail: v.optional(
    v.array(
      v.object({
        name: v.string(),
        rationale: v.string(),
        tier: v.union(v.literal("must"), v.literal("nice")),
      }),
    ),
  ),
  dayToDay: v.string(),
  riskFactors: v.array(v.string()),
  whyConsider: v.string(),
  meta: v.optional(metaValidator),
  regional: v.object({
    us: regionalBlockValidator,
    uk: regionalBlockValidator,
  }),
});

export type GuideWithUrl = Doc<"career_guides"> & {
  illustrationUrl: string | null;
  podcastAudioUrl: string | null;
  slotIllustrationUrls: Record<string, string>;
};

const resolveIllustration = async (
  storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> },
  doc: Doc<"career_guides">,
): Promise<GuideWithUrl> => {
  const slotEntries = Object.entries(doc.slotIllustrations ?? {});
  const resolved = await Promise.all(
    slotEntries.map(async ([slot, val]) => {
      if (!val.storageId) return [slot, null] as const;
      const url = await storage.getUrl(val.storageId);
      return [slot, url] as const;
    }),
  );
  const slotIllustrationUrls: Record<string, string> = {};
  for (const [slot, url] of resolved) {
    if (url) slotIllustrationUrls[slot] = url;
  }
  return {
    ...doc,
    illustrationUrl: doc.illustrationStorageId
      ? await storage.getUrl(doc.illustrationStorageId)
      : null,
    podcastAudioUrl: doc.podcast?.audioStorageId
      ? await storage.getUrl(doc.podcast.audioStorageId)
      : null,
    slotIllustrationUrls,
  };
};

// ── Public queries ──────────────────────────────────────────────────────────

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<GuideWithUrl[]> => {
    const limit = Math.min(args.limit ?? 9, 50);
    const docs = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .order("desc")
      .take(limit);
    return Promise.all(docs.map((d) => resolveIllustration(ctx.storage, d)));
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx): Promise<GuideWithUrl[]> => {
    const docs = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .order("desc")
      .take(200);
    return Promise.all(docs.map((d) => resolveIllustration(ctx.storage, d)));
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<GuideWithUrl | null> => {
    const doc = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    return doc ? resolveIllustration(ctx.storage, doc) : null;
  },
});

export const getValidation = query({
  args: { careerNormalized: v.string() },
  handler: async (ctx, args): Promise<Doc<"career_validations"> | null> => {
    const normalized = normalizeTitle(args.careerNormalized);
    if (!normalized) return null;
    const row = await ctx.db
      .query("career_validations")
      .withIndex("by_career_normalized", (q) =>
        q.eq("careerNormalized", normalized),
      )
      .first();
    if (!row?.slug) return row;
    // Self-heal: strip stale slugs whose guide has been deleted (or was
    // never created — earlier validateCareer set slug optimistically before
    // a guide existed). Without this, the search hero would short-circuit
    // straight to a 404.
    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", row.slug as string))
      .first();
    if (guide && guide.contentStatus !== "failed") return row;
    return { ...row, slug: undefined };
  },
});

// ── Public actions (vector search lives here) ───────────────────────────────

export type RelatedGuide = {
  slug: string;
  title: string;
  illustrationUrl: string | null;
  overviewSnippet: string;
  vectorScore: number;
};

const RELATED_LIMIT_DEFAULT = 4;
const RELATED_LIMIT_MAX = 12;
const RELATED_SEARCH_LIMIT = 16;
const OVERVIEW_SNIPPET_LENGTH = 220;

export const _getEmbeddingBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    guideId: Id<"career_guides">;
    wholeVector: number[];
  } | null> => {
    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!guide) return null;
    const embedding = await ctx.db
      .query("career_guide_embeddings")
      .withIndex("by_guideId", (q) => q.eq("guideId", guide._id))
      .unique();
    if (!embedding) return null;
    return { guideId: guide._id, wholeVector: embedding.wholeVector };
  },
});

export const _hydrateRelated = internalQuery({
  args: {
    embeddingIds: v.array(v.id("career_guide_embeddings")),
    excludeGuideId: v.id("career_guides"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      embeddingId: Id<"career_guide_embeddings">;
      slug: string;
      title: string;
      illustrationStorageId: Id<"_storage"> | null;
      overviewSnippet: string;
    }>
  > => {
    const out: Array<{
      embeddingId: Id<"career_guide_embeddings">;
      slug: string;
      title: string;
      illustrationStorageId: Id<"_storage"> | null;
      overviewSnippet: string;
    }> = [];
    for (const id of args.embeddingIds) {
      const embedding = await ctx.db.get(id);
      if (!embedding) continue;
      if (embedding.guideId === args.excludeGuideId) continue;
      const guide = await ctx.db.get(embedding.guideId);
      if (!guide || guide.contentStatus !== "complete" || !guide.content)
        continue;
      const overview = guide.content.overview ?? "";
      const snippet =
        overview.length > OVERVIEW_SNIPPET_LENGTH
          ? `${overview.slice(0, OVERVIEW_SNIPPET_LENGTH).trimEnd()}…`
          : overview;
      out.push({
        embeddingId: id,
        slug: guide.slug,
        title: guide.title,
        illustrationStorageId: guide.illustrationStorageId ?? null,
        overviewSnippet: snippet,
      });
    }
    return out;
  },
});

// Returns up to `limit` guides whose wholeVector is closest to the source
// guide's wholeVector. Pure cosine — no rerank — because at depth 4 a fast
// SSR-friendly response matters more than the marginal quality lift.
//
// Returns [] (not null) if the source guide is missing its embedding row;
// the UI hides the related-guides block in that case.
export const relatedBySlug = action({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<RelatedGuide[]> => {
    const limit = Math.min(
      args.limit ?? RELATED_LIMIT_DEFAULT,
      RELATED_LIMIT_MAX,
    );

    const source = await ctx.runQuery(
      internal.careerGuides._getEmbeddingBySlug,
      { slug: args.slug },
    );
    if (!source) return [];

    const searchResults = await ctx.vectorSearch(
      "career_guide_embeddings",
      "by_whole",
      { vector: source.wholeVector, limit: RELATED_SEARCH_LIMIT },
    );
    if (searchResults.length === 0) return [];

    const hydrated = await ctx.runQuery(
      internal.careerGuides._hydrateRelated,
      {
        embeddingIds: searchResults.map((r) => r._id),
        excludeGuideId: source.guideId,
      },
    );

    const scoreById = new Map<Id<"career_guide_embeddings">, number>();
    for (const r of searchResults) scoreById.set(r._id, r._score);

    const scored: RelatedGuide[] = [];
    for (const h of hydrated) {
      const url = h.illustrationStorageId
        ? await ctx.storage.getUrl(h.illustrationStorageId)
        : null;
      scored.push({
        slug: h.slug,
        title: h.title,
        illustrationUrl: url,
        overviewSnippet: h.overviewSnippet,
        vectorScore: scoreById.get(h.embeddingId) ?? 0,
      });
    }

    scored.sort((a, b) => b.vectorScore - a.vectorScore);
    return scored.slice(0, limit);
  },
});

// ── Internal queries (for actions) ──────────────────────────────────────────

export const _findByExactTitle = internalQuery({
  args: { rawQuery: v.string() },
  handler: (ctx, args) => findGuideByExactTitle(ctx, args.rawQuery),
});

export const _searchCandidates = internalQuery({
  args: { rawQuery: v.string(), limit: v.number() },
  handler: (ctx, args) =>
    searchGuideCandidates(ctx, args.rawQuery, args.limit),
});

export const _getById = internalQuery({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => ctx.db.get(args.guideId),
});

// Pulls every previously-used podcast guest name across the catalog so the
// script generator can avoid reusing them. Unbounded scan: at our scale
// (hundreds of guides) this is well within Convex's per-query limits, and
// dedup correctness requires seeing every guide. Pass `excludeGuideId` so a
// re-trigger on the same guide doesn't conflict with its own prior attempt.
export const _getUsedGuestNames = internalQuery({
  args: { excludeGuideId: v.optional(v.id("career_guides")) },
  returns: v.array(v.string()),
  handler: async (ctx, { excludeGuideId }) => {
    const guides = await ctx.db.query("career_guides").collect();
    const names = new Set<string>();
    for (const g of guides) {
      if (excludeGuideId && g._id === excludeGuideId) continue;
      const n = g.podcast?.guestName?.trim();
      if (n) names.add(n);
    }
    return [...names];
  },
});

// ── Internal mutations (state transitions) ──────────────────────────────────

export const _requestValidation = internalMutation({
  args: { career: v.string(), clientIp: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    careerNormalized: string;
    status: "pending" | "valid" | "invalid" | "rate-limited";
  }> => {
    const careerNormalized = normalizeTitle(args.career);
    if (!careerNormalized || careerNormalized.length < 2) {
      return { careerNormalized, status: "invalid" };
    }

    const existing = await ctx.db
      .query("career_validations")
      .withIndex("by_career_normalized", (q) =>
        q.eq("careerNormalized", careerNormalized),
      )
      .first();
    if (existing) {
      return { careerNormalized, status: existing.status };
    }

    const limit = await tryConsumeRateLimit(ctx, {
      key: `validate:${args.clientIp}`,
      ...VALIDATE_RATE,
    });
    if (!limit.ok) {
      return { careerNormalized, status: "rate-limited" };
    }

    const validationId = await ctx.db.insert("career_validations", {
      careerNormalized,
      status: "pending",
      clientIp: args.clientIp,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.careerGuides.validateCareer, {
      validationId,
      career: args.career,
    });

    return { careerNormalized, status: "pending" };
  },
});

export const _updateValidation = internalMutation({
  args: {
    validationId: v.id("career_validations"),
    status: v.union(v.literal("valid"), v.literal("invalid")),
    normalizedTitle: v.optional(v.string()),
    slug: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.validationId, {
      status: args.status,
      normalizedTitle: args.normalizedTitle,
      slug: args.slug,
      reason: args.reason,
    });
  },
});

export const _requestGeneration = internalMutation({
  args: { title: v.string(), clientIp: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ slug: string } | { error: string }> => {
    const limit = await tryConsumeRateLimit(ctx, {
      key: `generate:${args.clientIp}`,
      ...GENERATE_RATE,
    });
    if (!limit.ok) {
      return {
        error: "Too many generations from this address. Please wait a few minutes.",
      };
    }

    const slug = slugify(args.title);
    const titleNormalized = normalizeTitle(args.title);
    if (!slug || !titleNormalized) {
      return { error: "Invalid title." };
    }

    const existingBySlug = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    const existingByTitle =
      existingBySlug ??
      (await ctx.db
        .query("career_guides")
        .withIndex("by_title_normalized", (q) =>
          q.eq("titleNormalized", titleNormalized),
        )
        .first());

    const now = Date.now();

    // Reuse existing row unless it failed — failed rows get reset and rerun.
    if (existingByTitle && existingByTitle.contentStatus !== "failed") {
      return { slug: existingByTitle.slug };
    }

    const initialSlotIllustrations = buildInitialSlotIllustrations();

    let guideId;
    if (existingByTitle) {
      guideId = existingByTitle._id;
      await ctx.db.patch(guideId, {
        contentStatus: "generating",
        illustrationStatus: "generating",
        illustrationStorageId: undefined,
        slotIllustrations: initialSlotIllustrations,
        content: undefined,
        updatedAt: now,
      });
    } else {
      guideId = await ctx.db.insert("career_guides", {
        slug,
        title: args.title,
        titleNormalized,
        contentStatus: "generating",
        illustrationStatus: "generating",
        slotIllustrations: initialSlotIllustrations,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.careerGuides.generateContent, {
      guideId,
      title: args.title,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.careerGuides.generateIllustration,
      { guideId, title: args.title },
    );
    for (const slot of SECTION_SLOTS) {
      await ctx.scheduler.runAfter(
        0,
        internal.careerGuides.generateSlotIllustration,
        { guideId, title: args.title, slot },
      );
    }

    return { slug: existingByTitle?.slug ?? slug };
  },
});

function buildInitialSlotIllustrations(): Record<
  string,
  { status: "generating" }
> {
  const initial: Record<string, { status: "generating" }> = {};
  for (const slot of SECTION_SLOTS) {
    initial[slot] = { status: "generating" };
  }
  return initial;
}

// Grounded path: content was written with Exa research already attached.
// Citations are materialised from the LLM's `usedSources` index map and
// stored alongside content in a single atomic patch. Skips enrichGuide
// because grounding is already done — only schedules the podcast.
export const _updateContentGrounded = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    content: contentValidator,
    followUps: followUpsValidator,
    citations: v.record(v.string(), v.array(citationValidator)),
    costCents: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.guideId, {
      content: args.content,
      contentStatus: "complete",
      contentAttempts: 0,
      contentLastError: undefined,
      followUps: args.followUps,
      followUpsStatus: "complete",
      citations: args.citations,
      enrichment: {
        status: "complete",
        progress: { total: ENRICHMENT_TOTAL, done: ENRICHMENT_TOTAL },
        attempts: 0,
        costCents: Math.round(args.costCents * 100) / 100,
        lastEnrichedAt: now,
      },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.podcasts.generateScript, {
      guideId: args.guideId,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.guideBranches._prewarmTopBranches,
      { guideId: args.guideId },
    );
    await ctx.scheduler.runAfter(0, internal.guideEmbeddings.generate, {
      guideId: args.guideId,
    });
  },
});

// Deferred path: Exa retrieval failed (or returned <MIN_GROUNDED_TASKS).
// Publishes ungrounded content immediately and schedules a full Exa
// enrichment to run in 1 hour. Status "deferred" tells the UI that
// citations are not yet available but are coming.
export const _updateContentDeferred = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    content: contentValidator,
    followUps: followUpsValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.guideId, {
      content: args.content,
      contentStatus: "complete",
      contentAttempts: 0,
      contentLastError: undefined,
      followUps: args.followUps,
      followUpsStatus: "complete",
      enrichment: {
        status: "deferred",
        progress: { total: ENRICHMENT_TOTAL, done: 0 },
        attempts: 0,
        costCents: 0,
      },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      DEFERRED_ENRICHMENT_DELAY_MS,
      internal.careerGuides.enrichGuide,
      { guideId: args.guideId },
    );
    await ctx.scheduler.runAfter(0, internal.podcasts.generateScript, {
      guideId: args.guideId,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.guideBranches._prewarmTopBranches,
      { guideId: args.guideId },
    );
    await ctx.scheduler.runAfter(0, internal.guideEmbeddings.generate, {
      guideId: args.guideId,
    });
  },
});

export const _markContentFailed = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    const prevAttempts = guide?.contentAttempts ?? 0;
    const now = Date.now();
    await ctx.db.patch(args.guideId, {
      contentStatus: "failed",
      contentAttempts: prevAttempts + 1,
      contentLastFailureAt: now,
      contentLastError: args.error?.slice(0, 500),
      updatedAt: now,
    });
  },
});

export const _updateIllustration = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.guideId, {
      illustrationStorageId: args.storageId,
      illustrationStatus: "complete",
      updatedAt: Date.now(),
    });
  },
});

export const _markIllustrationFailed = internalMutation({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.guideId, {
      illustrationStatus: "failed",
      updatedAt: Date.now(),
    });
  },
});

export const _updateSlotIllustration = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    slot: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return;
    const current = guide.slotIllustrations ?? {};
    await ctx.db.patch(args.guideId, {
      slotIllustrations: {
        ...current,
        [args.slot]: { storageId: args.storageId, status: "complete" as const },
      },
      updatedAt: Date.now(),
    });
  },
});

export const _markSlotIllustrationFailed = internalMutation({
  args: { guideId: v.id("career_guides"), slot: v.string() },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return;
    const current = guide.slotIllustrations ?? {};
    await ctx.db.patch(args.guideId, {
      slotIllustrations: {
        ...current,
        [args.slot]: {
          ...(current[args.slot] ?? {}),
          status: "failed" as const,
        },
      },
      updatedAt: Date.now(),
    });
  },
});

export const _resetSlotsForRetry = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    slots: v.array(sectionSlotValidator),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return;
    const current = guide.slotIllustrations ?? {};
    const next = { ...current };
    for (const slot of args.slots) {
      next[slot] = { status: "generating" as const };
    }
    await ctx.db.patch(args.guideId, {
      slotIllustrations: next,
      updatedAt: Date.now(),
    });
  },
});

export const _purgeValidation = internalMutation({
  args: { careerNormalized: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("career_validations")
      .withIndex("by_career_normalized", (q) =>
        q.eq("careerNormalized", args.careerNormalized),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

// Ops trigger: enrich (or re-enrich) any existing guide by slug.
// Safe to call repeatedly — `_beginEnrichment` short-circuits on
// running/complete states.
export const triggerEnrichmentBySlug = mutation({
  args: { slug: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), guideId: v.id("career_guides") }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!guide) {
      return { ok: false as const, reason: "not_found" };
    }
    if (guide.contentStatus !== "complete") {
      return { ok: false as const, reason: "content_not_ready" };
    }
    // Reset enrichment to pending so _beginEnrichment will pick it up.
    await ctx.db.patch(guide._id, {
      enrichment: {
        status: "pending",
        progress: { total: ENRICHMENT_TOTAL, done: 0 },
        attempts: guide.enrichment?.attempts ?? 0,
        costCents: guide.enrichment?.costCents ?? 0,
        lastEnrichedAt: guide.enrichment?.lastEnrichedAt,
      },
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.careerGuides.enrichGuide, {
      guideId: guide._id,
    });
    return { ok: true as const, guideId: guide._id };
  },
});

/**
 * Admin reset: deletes every `career_guides` row plus its illustration
 * and slot-illustration storage. Used as a hard reset before bulk
 * regeneration in dev / staging.
 *
 * NOTE on discover-canvas data integrity: this mutation does NOT
 * proactively clean up `discover_canvases.lanes[*].cards[*].guideId`
 * references, `discover_snapshot_guides` junction rows, or
 * `discover_match_reasons` cache rows pointing at the deleted guides.
 * Orphans are self-healing: the next per-user `generateSnapshot` rewrites
 * the snapshot from scratch (excluding the now-missing guides), and the
 * fan-out from `guideEmbeddings.upsert` after regeneration triggers that
 * regen for every active user. Between deletion and the next regen,
 * `getSnapshot` returns lane slots with missing-guide fallbacks
 * (`title: "(missing)"`); the canvas reader UI must handle this gracefully.
 */
export const _purgeAllGuides = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("career_guides").collect();
    for (const r of rows) {
      if (r.illustrationStorageId) {
        try {
          await ctx.storage.delete(r.illustrationStorageId);
        } catch {
          // storage may already be gone
        }
      }
      for (const val of Object.values(r.slotIllustrations ?? {})) {
        if (val.storageId) {
          try {
            await ctx.storage.delete(val.storageId);
          } catch {
            // storage may already be gone
          }
        }
      }
      await ctx.db.delete(r._id);
    }
    return { deleted: rows.length };
  },
});

// Destructive ops trigger: deletes all branches, all guides (including
// illustration + podcast storage), then schedules regeneration of each
// captured title via the new grounded-first pipeline. Requires an explicit
// confirmation literal to prevent accidental runs. Validation rows are
// left in place — getValidation self-heals stale slugs.
//
// NOTE on discover-canvas data integrity: this mutation does NOT
// proactively clean up `discover_canvases.lanes[*].cards[*].guideId`
// references, `discover_snapshot_guides` junction rows, or
// `discover_match_reasons` cache rows pointing at the deleted guides.
// Orphans are self-healing: the next per-user `generateSnapshot` rewrites
// the snapshot from scratch (excluding the now-missing guides), and the
// fan-out from `guideEmbeddings.upsert` after `purgeAndRegenerateAll`
// triggers that regen for every active user. Between deletion and the
// next regen, `getSnapshot` returns lane slots with missing-guide
// fallbacks (`title: "(missing)"`); the canvas reader UI must handle
// this gracefully.
export const purgeAndRegenerateAll = mutation({
  args: { confirm: v.literal("purge-and-regenerate") },
  returns: v.object({
    purged: v.number(),
    scheduled: v.number(),
    titles: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const guides = await ctx.db.query("career_guides").collect();
    const titles = guides.map((g) => g.title);

    // Delete branches first (FK to guides).
    const branches = await ctx.db.query("career_guide_branches").collect();
    for (const b of branches) {
      await ctx.db.delete(b._id);
    }

    // Delete guides + their stored illustration, slot illustrations, and podcast audio.
    for (const g of guides) {
      if (g.illustrationStorageId) {
        try {
          await ctx.storage.delete(g.illustrationStorageId);
        } catch {
          // storage may already be gone
        }
      }
      for (const val of Object.values(g.slotIllustrations ?? {})) {
        if (val.storageId) {
          try {
            await ctx.storage.delete(val.storageId);
          } catch {
            // storage may already be gone
          }
        }
      }
      if (g.podcast?.audioStorageId) {
        try {
          await ctx.storage.delete(g.podcast.audioStorageId);
        } catch {
          // storage may already be gone
        }
      }
      await ctx.db.delete(g._id);
    }

    // Schedule regeneration: each title gets its own clientIp bucket so the
    // generate-rate limit (3 per 5 min) doesn't gate the backfill, and a
    // 10s stagger keeps Exa + LLM concurrency bounded.
    let i = 0;
    for (const title of titles) {
      await ctx.scheduler.runAfter(
        i * 10_000,
        internal.careerGuides.requestGuideFromSearch,
        { title, clientIp: `backfill-${i}` },
      );
      i++;
    }

    return {
      purged: guides.length,
      scheduled: titles.length,
      titles,
    };
  },
});

// ── Meta backfill ──────────────────────────────────────────────────────────
//
// Retroactively produces content.meta for guides created before SEO meta
// fields existed in the content schema. One small LLM call per guide,
// driven by existing content as input. Idempotent: skips guides that
// already have meta.

export const _setContentMeta = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    meta: metaValidator,
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide?.content) return;
    await ctx.db.patch(args.guideId, {
      content: {
        ...guide.content,
        meta: args.meta,
      },
      updatedAt: Date.now(),
    });
  },
});

export const _backfillMeta = internalAction({
  args: { guideId: v.id("career_guides") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const guide = await ctx.runQuery(internal.careerGuides._getById, {
      guideId: args.guideId,
    });
    if (!guide?.content || guide.contentStatus !== "complete") return null;
    if (guide.content.meta) return null;

    try {
      const { output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: MetaOnlySchema }),
        prompt: buildMetaPrompt({
          title: guide.title,
          overview: guide.content.overview,
          typicalSkills: guide.content.typicalSkills,
          riskFactors: guide.content.riskFactors,
          usSalary: guide.content.regional.us.salary,
          ukSalary: guide.content.regional.uk.salary,
          usOutlook: guide.content.regional.us.careerOutlook,
          ukOutlook: guide.content.regional.uk.careerOutlook,
          relatedRolesUs: guide.content.regional.us.relatedRoles,
        }),
      });
      await ctx.runMutation(internal.careerGuides._setContentMeta, {
        guideId: args.guideId,
        meta: output.meta,
      });
    } catch (err) {
      console.error("careerGuides:backfill-meta-failed", {
        guideId: args.guideId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  },
});

// Ops trigger: schedule meta backfill across every complete guide.
// 5s stagger keeps Gemini concurrency bounded.
export const triggerMetaBackfill = mutation({
  args: {},
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx) => {
    const guides = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .collect();

    let i = 0;
    for (const guide of guides) {
      await ctx.scheduler.runAfter(
        i * 5000,
        internal.careerGuides._backfillMeta,
        { guideId: guide._id },
      );
      i++;
    }

    return { scheduled: guides.length };
  },
});

// ── Skills-detail backfill ────────────────────────────────────────────────
//
// Retroactively produces content.typicalSkillsDetail for guides created
// before the rich tiered-skills shape existed. Takes the existing
// typicalSkills array as input and returns a same-length, same-order array
// enriched with rationale + tier. Idempotent: skips guides that already
// have a non-empty typicalSkillsDetail.

export const _setSkillsDetail = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    typicalSkillsDetail: v.array(
      v.object({
        name: v.string(),
        rationale: v.string(),
        tier: v.union(v.literal("must"), v.literal("nice")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide?.content) return;
    await ctx.db.patch(args.guideId, {
      content: {
        ...guide.content,
        typicalSkillsDetail: args.typicalSkillsDetail,
      },
      updatedAt: Date.now(),
    });
  },
});

export const _backfillSkillsDetail = internalAction({
  args: { guideId: v.id("career_guides") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const guide = await ctx.runQuery(internal.careerGuides._getById, {
      guideId: args.guideId,
    });
    if (!guide?.content || guide.contentStatus !== "complete") return null;
    if (
      guide.content.typicalSkillsDetail &&
      guide.content.typicalSkillsDetail.length > 0
    ) {
      return null;
    }
    if (guide.content.typicalSkills.length === 0) return null;

    try {
      const { output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: SkillsDetailOnlySchema }),
        prompt: buildSkillsDetailPrompt({
          title: guide.title,
          typicalSkills: guide.content.typicalSkills,
        }),
      });
      await ctx.runMutation(internal.careerGuides._setSkillsDetail, {
        guideId: args.guideId,
        typicalSkillsDetail: output.typicalSkillsDetail,
      });
    } catch (err) {
      console.error("careerGuides:backfill-skills-detail-failed", {
        guideId: args.guideId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  },
});

// Ops read: count complete guides that have / don't have typicalSkillsDetail.
// Used to monitor backfill progress without scraping the full dataset.
export const countSkillsDetailStatus = query({
  args: {},
  returns: v.object({
    total: v.number(),
    withDetail: v.number(),
    missingDetail: v.number(),
    pendingTitles: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const guides = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .collect();
    let withDetail = 0;
    const pendingTitles: string[] = [];
    for (const g of guides) {
      const detail = g.content?.typicalSkillsDetail;
      if (detail && detail.length > 0) withDetail++;
      else pendingTitles.push(g.title);
    }
    return {
      total: guides.length,
      withDetail,
      missingDetail: guides.length - withDetail,
      pendingTitles,
    };
  },
});

// Ops trigger: schedule skills-detail backfill across every complete guide.
// 5s stagger keeps the chat-model concurrency bounded, mirroring the meta
// backfill cadence.
export const triggerSkillsDetailBackfill = mutation({
  args: {},
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx) => {
    const guides = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .collect();

    let i = 0;
    for (const guide of guides) {
      await ctx.scheduler.runAfter(
        i * 5000,
        internal.careerGuides._backfillSkillsDetail,
        { guideId: guide._id },
      );
      i++;
    }

    return { scheduled: guides.length };
  },
});

// ── Enrichment state mutations ─────────────────────────────────────────────

export const _beginEnrichment = internalMutation({
  args: { guideId: v.id("career_guides") },
  returns: v.union(
    v.object({ ok: v.literal(true), title: v.string(), attempts: v.number() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return { ok: false as const, reason: "not_found" };
    const prev = guide.enrichment;
    if (prev?.status === "running") {
      return { ok: false as const, reason: "already_running" };
    }
    if (prev?.status === "complete") {
      return { ok: false as const, reason: "already_complete" };
    }
    const attempts = (prev?.attempts ?? 0) + 1;
    await ctx.db.patch(args.guideId, {
      enrichment: {
        status: "running",
        progress: { total: ENRICHMENT_TOTAL, done: 0 },
        attempts,
        costCents: 0,
        lastEnrichedAt: prev?.lastEnrichedAt,
      },
      updatedAt: Date.now(),
    });
    return { ok: true as const, title: guide.title, attempts };
  },
});

export const _recordFieldEnrichment = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    fieldPath: v.string(),
    citations: v.array(citationValidator),
    costCents: v.number(),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return;
    const citations = { ...(guide.citations ?? {}) };
    citations[args.fieldPath] = args.citations;
    const enrichment = guide.enrichment ?? {
      status: "running" as const,
      progress: { total: ENRICHMENT_TOTAL, done: 0 },
      attempts: 1,
      costCents: 0,
    };
    await ctx.db.patch(args.guideId, {
      citations,
      enrichment: {
        ...enrichment,
        progress: {
          total: enrichment.progress.total,
          done: Math.min(
            enrichment.progress.total,
            enrichment.progress.done + 1,
          ),
        },
        costCents:
          Math.round((enrichment.costCents + args.costCents) * 100) / 100,
      },
      updatedAt: Date.now(),
    });
  },
});

export const _patchSalary = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    region: v.union(v.literal("us"), v.literal("uk")),
    salary: salaryValidator,
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide?.content) return;
    const next = {
      ...guide.content,
      regional: {
        ...guide.content.regional,
        [args.region]: {
          ...guide.content.regional[args.region],
          salary: args.salary,
        },
      },
    };
    await ctx.db.patch(args.guideId, {
      content: next,
      updatedAt: Date.now(),
    });
  },
});

export const _completeEnrichment = internalMutation({
  args: { guideId: v.id("career_guides"), addedCostCents: v.number() },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return;
    const enrichment = guide.enrichment;
    if (!enrichment) return;
    const now = Date.now();
    await ctx.db.patch(args.guideId, {
      enrichment: {
        status: "complete",
        progress: {
          total: enrichment.progress.total,
          done: enrichment.progress.total,
        },
        attempts: enrichment.attempts,
        costCents:
          Math.round((enrichment.costCents + args.addedCostCents) * 100) / 100,
        lastEnrichedAt: now,
      },
      updatedAt: now,
    });
    // Re-embed: enrichment may have patched salaries, learning paths, and
    // related-roles, all of which feed the arc / domain / currentState
    // facets. Stale embeddings would surface guides under the wrong lens.
    await ctx.scheduler.runAfter(0, internal.guideEmbeddings.generate, {
      guideId: args.guideId,
    });
  },
});

export const _failEnrichment = internalMutation({
  args: { guideId: v.id("career_guides"), error: v.string() },
  returns: v.object({ attempts: v.number() }),
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return { attempts: ENRICHMENT_MAX_ATTEMPTS };
    const enrichment = guide.enrichment ?? {
      status: "failed" as const,
      progress: { total: ENRICHMENT_TOTAL, done: 0 },
      attempts: 1,
      costCents: 0,
    };
    await ctx.db.patch(args.guideId, {
      enrichment: {
        status: "failed",
        progress: enrichment.progress,
        attempts: enrichment.attempts,
        costCents: enrichment.costCents,
        lastEnrichedAt: enrichment.lastEnrichedAt,
        error: args.error.slice(0, 500),
      },
      updatedAt: Date.now(),
    });
    return { attempts: enrichment.attempts };
  },
});

// ── Internal actions (LLM + image) ──────────────────────────────────────────

export const validateCareer = internalAction({
  args: {
    validationId: v.id("career_validations"),
    career: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const { output } = await generateText({
        model: chatModel(VALIDATION_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: ValidationResponseSchema }),
        prompt: buildValidationPrompt(args.career),
      });

      // Only return a slug if a real guide already exists for the normalized
      // title. Otherwise the frontend would navigate to a non-existent page
      // before /generate has a chance to create the guide.
      let slug: string | undefined;
      if (output.valid && output.normalizedTitle) {
        const existing = await ctx.runQuery(
          internal.careerGuides._findByExactTitle,
          { rawQuery: output.normalizedTitle },
        );
        if (existing) slug = existing.slug;
      }

      await ctx.runMutation(internal.careerGuides._updateValidation, {
        validationId: args.validationId,
        status: output.valid ? "valid" : "invalid",
        normalizedTitle: output.normalizedTitle ?? undefined,
        slug,
        reason: output.reason,
      });
    } catch (err) {
      console.error("validateCareer:failed", { err });
      await ctx.runMutation(internal.careerGuides._updateValidation, {
        validationId: args.validationId,
        status: "invalid",
        reason: "Validation service temporarily unavailable.",
      });
    }
    return null;
  },
});

export const requestGuideFromSearch = internalAction({
  args: { title: v.string(), clientIp: v.string() },
  returns: v.union(
    v.object({ slug: v.string() }),
    v.object({ error: v.string() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{ slug: string } | { error: string }> => {
    // Tier-1 lexical: exact title match (cheap, free, common case).
    const lex = await ctx.runQuery(internal.careerGuides._findByExactTitle, {
      rawQuery: args.title,
    });
    if (lex) return { slug: lex.slug };

    // Tier-4 LLM dedup against top search candidates.
    const candidates: { slug: string; title: string }[] = await ctx.runQuery(
      internal.careerGuides._searchCandidates,
      { rawQuery: args.title, limit: 10 },
    );
    if (candidates.length > 0) {
      try {
        const { output } = await generateText({
          model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
          output: Output.object({ schema: DedupResponseSchema }),
          prompt: buildDedupPrompt(args.title, candidates),
        });
        if (output.isDuplicate && output.matchedSlug) {
          return { slug: output.matchedSlug };
        }
      } catch (err) {
        // Dedup is best-effort; fall through and create a new guide.
        console.error("dedup:failed", { err });
      }
    }

    return await ctx.runMutation(internal.careerGuides._requestGeneration, {
      title: args.title,
      clientIp: args.clientIp,
    });
  },
});

export const generateContent = internalAction({
  args: {
    guideId: v.id("career_guides"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    const stripSalaryNullNote = (s: {
      entry: string;
      mid: string;
      senior: string;
      note: string | null;
    }) => ({
      entry: s.entry,
      mid: s.mid,
      senior: s.senior,
      ...(s.note ? { note: s.note } : {}),
    });

    try {
      // Phase A — Best-effort Exa fan-out across all 8 enrichment tasks.
      // We do this BEFORE the LLM call so the model can ground its prose
      // in fresh sources rather than parametric memory. EXA_API_KEY missing
      // skips straight to the deferred fallback.
      const exaByField = new Map<string, GroundedResearch>();
      let groundingCostCents = 0;

      if (process.env.EXA_API_KEY) {
        const tasks = ENRICHMENT_TASKS.map((task) => async () => {
          try {
            const { query, systemPrompt } = buildEnrichmentQuery(
              task,
              args.title,
            );
            const res = await exaAnswer(query, {
              systemPrompt,
              signal: controller.signal,
            });
            return {
              fieldPath: task.fieldPath,
              ok: true as const,
              answer: res.answer,
              sources: res.citations,
              costCents: res.costCents,
            };
          } catch (err) {
            console.error("generateContent:exa-task-failed", {
              guideId: args.guideId,
              fieldPath: task.fieldPath,
              err: err instanceof Error ? err.message : String(err),
            });
            return { fieldPath: task.fieldPath, ok: false as const };
          }
        });

        const outcomes = await runWithConcurrency(
          tasks,
          ENRICHMENT_CONCURRENCY,
        );
        for (const o of outcomes) {
          if (o.ok) {
            exaByField.set(o.fieldPath, {
              answer: o.answer,
              sources: o.sources,
            });
            groundingCostCents += o.costCents;
          }
        }
      } else {
        console.warn("generateContent:exa-key-missing", {
          guideId: args.guideId,
        });
      }

      const groundedCount = exaByField.size;

      if (groundedCount >= MIN_GROUNDED_TASKS) {
        // Phase B (grounded): LLM writes prose grounded in fresh research,
        // returns per-field source indexes we materialise into citations.
        const { output } = await generateText({
          model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
          output: Output.object({ schema: ContentResponseGroundedSchema }),
          prompt: buildGroundedContentPrompt(args.title, exaByField),
          abortSignal: controller.signal,
        });

        const citations: Record<string, Citation[]> = {};
        for (const task of ENRICHMENT_TASKS) {
          const usedKey = FIELD_PATH_TO_USED_KEY[task.fieldPath];
          const indexes =
            output.usedSources[usedKey as keyof typeof output.usedSources] ??
            [];
          const research = exaByField.get(task.fieldPath);
          if (!research || indexes.length === 0) continue;
          const fieldCitations: Citation[] = [];
          for (const i of indexes) {
            if (
              Number.isInteger(i) &&
              i >= 0 &&
              i < research.sources.length
            ) {
              fieldCitations.push(research.sources[i]);
            }
          }
          if (fieldCitations.length > 0) {
            citations[task.fieldPath] = fieldCitations;
          }
        }

        await ctx.runMutation(
          internal.careerGuides._updateContentGrounded,
          {
            guideId: args.guideId,
            content: {
              overview: output.overview,
              typicalSkills: output.typicalSkills,
              typicalSkillsDetail: output.typicalSkillsDetail,
              dayToDay: output.dayToDay,
              riskFactors: output.riskFactors,
              whyConsider: output.whyConsider,
              meta: output.meta,
              regional: {
                us: {
                  ...output.regional.us,
                  salary: stripSalaryNullNote(output.regional.us.salary),
                },
                uk: {
                  ...output.regional.uk,
                  salary: stripSalaryNullNote(output.regional.uk.salary),
                },
              },
            },
            followUps: output.followUps,
            citations,
            costCents: groundingCostCents,
          },
        );
        return null;
      }

      // Phase B fallback (deferred): Exa is unhealthy. Publish ungrounded
      // content from parametric memory and schedule full enrichment in 1h.
      console.warn("generateContent:falling-back-to-deferred", {
        guideId: args.guideId,
        groundedCount,
        threshold: MIN_GROUNDED_TASKS,
      });

      const { output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: ContentResponseSchema }),
        prompt: buildContentPrompt(args.title),
        abortSignal: controller.signal,
      });

      await ctx.runMutation(internal.careerGuides._updateContentDeferred, {
        guideId: args.guideId,
        content: {
          overview: output.overview,
          typicalSkills: output.typicalSkills,
          typicalSkillsDetail: output.typicalSkillsDetail,
          dayToDay: output.dayToDay,
          riskFactors: output.riskFactors,
          whyConsider: output.whyConsider,
          meta: output.meta,
          regional: {
            us: {
              ...output.regional.us,
              salary: stripSalaryNullNote(output.regional.us.salary),
            },
            uk: {
              ...output.regional.uk,
              salary: stripSalaryNullNote(output.regional.uk.salary),
            },
          },
        },
        followUps: output.followUps,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("generateContent:failed", {
        guideId: args.guideId,
        err: message,
      });
      await ctx.runMutation(internal.careerGuides._markContentFailed, {
        guideId: args.guideId,
        error: message,
      });
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

async function generateAndStoreImage(
  ctx: { storage: { store: (blob: Blob) => Promise<Id<"_storage">> } },
  prompt: string,
): Promise<Id<"_storage">> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL_ID,
      modalities: ["image", "text"],
      messages: buildImageMessages(prompt),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter image ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: { images?: Array<{ image_url: { url: string } }> };
    }>;
  };
  const dataUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl) throw new Error("No image in OpenRouter response");

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Unexpected image URL format");

  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: match[1] });
  return ctx.storage.store(blob);
}

export const generateIllustration = internalAction({
  args: {
    guideId: v.id("career_guides"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const prompt = constructImagePrompt({
        title: args.title,
        description: `A career guide page for ${args.title}.`,
      });
      const storageId = await generateAndStoreImage(ctx, prompt);
      await ctx.runMutation(internal.careerGuides._updateIllustration, {
        guideId: args.guideId,
        storageId,
      });
    } catch (err) {
      console.error("generateIllustration:failed", {
        guideId: args.guideId,
        err,
      });
      await ctx.runMutation(internal.careerGuides._markIllustrationFailed, {
        guideId: args.guideId,
      });
    }
    return null;
  },
});

export const generateSlotIllustration = internalAction({
  args: {
    guideId: v.id("career_guides"),
    title: v.string(),
    slot: sectionSlotValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const prompt = constructImagePrompt({
        title: args.title,
        description: `A career guide page for ${args.title}.`,
        slot: args.slot,
      });
      const storageId = await generateAndStoreImage(ctx, prompt);
      await ctx.runMutation(internal.careerGuides._updateSlotIllustration, {
        guideId: args.guideId,
        slot: args.slot,
        storageId,
      });
    } catch (err) {
      console.error("generateSlotIllustration:failed", {
        guideId: args.guideId,
        slot: args.slot,
        err,
      });
      await ctx.runMutation(
        internal.careerGuides._markSlotIllustrationFailed,
        { guideId: args.guideId, slot: args.slot },
      );
    }
    return null;
  },
});

// ── Enrichment ─────────────────────────────────────────────────────────────

const runWithConcurrency = async <T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> => {
  const results = new Array<T>(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
};

type EnrichmentOutcome =
  | {
      task: EnrichmentTask;
      ok: true;
      answer: string;
      citations: Citation[];
      costCents: number;
    }
  | { task: EnrichmentTask; ok: false; error: string };

export const enrichGuide = internalAction({
  args: { guideId: v.id("career_guides") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const begin = await ctx.runMutation(
      internal.careerGuides._beginEnrichment,
      { guideId: args.guideId },
    );
    if (!begin.ok) return null;

    if (!process.env.EXA_API_KEY) {
      await ctx.runMutation(internal.careerGuides._failEnrichment, {
        guideId: args.guideId,
        error: "EXA_API_KEY is not set",
      });
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      ENRICHMENT_TIMEOUT_MS,
    );

    try {
      const tasks = ENRICHMENT_TASKS.map(
        (task) => async (): Promise<EnrichmentOutcome> => {
          try {
            const { query, systemPrompt } = buildEnrichmentQuery(
              task,
              begin.title,
            );
            const res = await exaAnswer(query, {
              systemPrompt,
              signal: controller.signal,
            });
            await ctx.runMutation(
              internal.careerGuides._recordFieldEnrichment,
              {
                guideId: args.guideId,
                fieldPath: task.fieldPath,
                citations: res.citations,
                costCents: res.costCents,
              },
            );
            return {
              task,
              ok: true,
              answer: res.answer,
              citations: res.citations,
              costCents: res.costCents,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("enrichGuide:field-failed", {
              guideId: args.guideId,
              fieldPath: task.fieldPath,
              err: message,
            });
            return { task, ok: false, error: message };
          }
        },
      );

      const outcomes = await runWithConcurrency(
        tasks,
        ENRICHMENT_CONCURRENCY,
      );

      // Hard-fail if every Exa call errored — likely a key/auth/credits issue,
      // not a one-off. Schedule a retry.
      const okCount = outcomes.filter((o) => o.ok).length;
      if (okCount === 0) {
        throw new Error("All Exa calls failed");
      }

      // Salary judge — runs only when both regional salary calls succeeded.
      const salaryUs = outcomes.find(
        (o): o is Extract<EnrichmentOutcome, { ok: true }> =>
          o.ok && o.task.fieldPath === "regional.us.salary",
      );
      const salaryUk = outcomes.find(
        (o): o is Extract<EnrichmentOutcome, { ok: true }> =>
          o.ok && o.task.fieldPath === "regional.uk.salary",
      );

      let judgeCostCents = 0;
      if (salaryUs && salaryUk) {
        const guide = await ctx.runQuery(internal.careerGuides._getById, {
          guideId: args.guideId,
        });
        if (guide?.content) {
          try {
            const { output } = await generateText({
              model: chatModel(JUDGE_MODEL_ID, { zdr: true }),
              output: Output.object({ schema: SalaryJudgeSchema }),
              prompt: buildSalaryJudgePrompt({
                title: begin.title,
                us: {
                  stored: guide.content.regional.us.salary,
                  exaAnswer: salaryUs.answer,
                  sources: salaryUs.citations.map((c) => c.url),
                },
                uk: {
                  stored: guide.content.regional.uk.salary,
                  exaAnswer: salaryUk.answer,
                  sources: salaryUk.citations.map((c) => c.url),
                },
              }),
              abortSignal: controller.signal,
            });
            judgeCostCents = 0.2;

            for (const region of ["us", "uk"] as const) {
              const verdict = output[region];
              if (verdict.verdict === "material" && verdict.proposed) {
                const proposed = verdict.proposed;
                await ctx.runMutation(internal.careerGuides._patchSalary, {
                  guideId: args.guideId,
                  region,
                  salary: {
                    entry: proposed.entry,
                    mid: proposed.mid,
                    senior: proposed.senior,
                    ...(proposed.note ? { note: proposed.note } : {}),
                  },
                });
              }
            }
          } catch (err) {
            // Judge failures don't fail the whole enrichment — citations
            // are already attached. Just log and continue.
            console.error("enrichGuide:judge-failed", {
              guideId: args.guideId,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      await ctx.runMutation(internal.careerGuides._completeEnrichment, {
        guideId: args.guideId,
        addedCostCents: judgeCostCents,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("enrichGuide:orchestrator-failed", {
        guideId: args.guideId,
        err: message,
      });
      const result = await ctx.runMutation(
        internal.careerGuides._failEnrichment,
        { guideId: args.guideId, error: message },
      );
      if (result.attempts < ENRICHMENT_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          ENRICHMENT_RETRY_DELAY_MS,
          internal.careerGuides.enrichGuide,
          { guideId: args.guideId },
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    return null;
  },
});

// Atomic guard for content regeneration. Mirrors _beginEnrichment: refuses
// if the guide is already generating or already complete, and (unless the
// caller passes bypassAttemptCap) refuses once contentAttempts >= cap.
// Sets contentStatus to "generating" in the same transaction so a second
// caller arriving moments later sees "already_generating" and bails.
export const _beginContentRetry = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    bypassAttemptCap: v.boolean(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), title: v.string() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return { ok: false as const, reason: "not_found" };
    if (guide.contentStatus === "complete") {
      return { ok: false as const, reason: "already_complete" };
    }
    if (guide.contentStatus === "generating") {
      return { ok: false as const, reason: "already_generating" };
    }
    if (
      !args.bypassAttemptCap &&
      (guide.contentAttempts ?? 0) >= CONTENT_MAX_ATTEMPTS
    ) {
      return { ok: false as const, reason: "max_attempts" };
    }
    await ctx.db.patch(args.guideId, {
      contentStatus: "generating",
      content: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true as const, title: guide.title };
  },
});

// Public mutation called by the failed-state UI: once on mount (force=false,
// honours the auto-cap) and on the manual "Try again" click (force=true,
// bypasses the cap so users always have a recovery option). Rate-limited per
// slug+IP so a hammer-refresh can't queue N concurrent regenerations.
export const retryFailedGuide = mutation({
  args: {
    slug: v.string(),
    clientIp: v.string(),
    force: v.boolean(),
  },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; reason?: string }> => {
    const limit = await tryConsumeRateLimit(ctx, {
      key: `retryGuide:${args.slug}:${args.clientIp}`,
      ...RETRY_RATE,
    });
    if (!limit.ok) return { ok: false, reason: "rate_limited" };

    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!guide) return { ok: false, reason: "not_found" };

    const begin: { ok: true; title: string } | { ok: false; reason: string } =
      await ctx.runMutation(internal.careerGuides._beginContentRetry, {
        guideId: guide._id,
        bypassAttemptCap: args.force,
      });
    if (!begin.ok) return { ok: false, reason: begin.reason };

    await ctx.scheduler.runAfter(0, internal.careerGuides.generateContent, {
      guideId: guide._id,
      title: begin.title,
    });
    if (
      guide.illustrationStatus === "failed" ||
      !guide.illustrationStorageId
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.careerGuides.generateIllustration,
        { guideId: guide._id, title: begin.title },
      );
    }

    const slotsToRedo = pickSlotsNeedingRetry(guide.slotIllustrations);
    if (slotsToRedo.length > 0) {
      const next = { ...(guide.slotIllustrations ?? {}) };
      for (const slot of slotsToRedo) {
        next[slot] = { status: "generating" as const };
      }
      await ctx.db.patch(guide._id, {
        slotIllustrations: next,
        updatedAt: Date.now(),
      });
      for (const slot of slotsToRedo) {
        await ctx.scheduler.runAfter(
          0,
          internal.careerGuides.generateSlotIllustration,
          { guideId: guide._id, title: begin.title, slot },
        );
      }
    }
    return { ok: true };
  },
});

function pickSlotsNeedingRetry(
  current: Record<string, { storageId?: Id<"_storage">; status: string }> | undefined,
): SectionSlot[] {
  const slots: SectionSlot[] = [];
  for (const slot of SECTION_SLOTS) {
    const cur = current?.[slot];
    if (!cur || cur.status === "failed" || !cur.storageId) {
      slots.push(slot);
    }
  }
  return slots;
}

// Cron worker: scans failed guides eligible for auto-retry and schedules
// regenerations, staggered to avoid Exa rate-limit thundering herd.
export const _retryFailedGuides = internalAction({
  args: {},
  returns: v.object({ scanned: v.number(), scheduled: v.number() }),
  handler: async (
    ctx,
  ): Promise<{ scanned: number; scheduled: number }> => {
    const candidates = await ctx.runQuery(
      internal.careerGuides._listFailedGuidesForRetry,
      {},
    );
    let scheduled = 0;
    for (const c of candidates) {
      const begin = await ctx.runMutation(
        internal.careerGuides._beginContentRetry,
        { guideId: c._id, bypassAttemptCap: false },
      );
      if (!begin.ok) continue;
      const delay = scheduled * CONTENT_RETRY_STAGGER_MS;
      await ctx.scheduler.runAfter(
        delay,
        internal.careerGuides.generateContent,
        { guideId: c._id, title: begin.title },
      );
      if (c.illustrationStatus === "failed") {
        await ctx.scheduler.runAfter(
          delay,
          internal.careerGuides.generateIllustration,
          { guideId: c._id, title: begin.title },
        );
      }
      const slotsToRedo = pickSlotsNeedingRetry(c.slotIllustrations);
      if (slotsToRedo.length > 0) {
        await ctx.runMutation(internal.careerGuides._resetSlotsForRetry, {
          guideId: c._id,
          slots: slotsToRedo,
        });
        for (const slot of slotsToRedo) {
          await ctx.scheduler.runAfter(
            delay,
            internal.careerGuides.generateSlotIllustration,
            { guideId: c._id, title: begin.title, slot },
          );
        }
      }
      scheduled++;
    }
    return { scanned: candidates.length, scheduled };
  },
});

// Returns failed guides that are (a) under the attempt cap and (b) past the
// cooldown since their last failure. Cooldown gives a transient upstream
// outage time to recover before the cron retries en-masse.
export const _listFailedGuidesForRetry = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - CONTENT_RETRY_COOLDOWN_MS;
    const rows = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "failed"))
      .take(50);
    return rows
      .filter((r) => (r.contentAttempts ?? 0) < CONTENT_MAX_ATTEMPTS)
      .filter((r) => (r.contentLastFailureAt ?? 0) < cutoff)
      .slice(0, CONTENT_RETRY_BATCH_SIZE);
  },
});

// ── Career-stage backfill ─────────────────────────────────────────────────
//
// Tags every existing complete guide with a `typicalCareerStage` so the
// discover canvas can bucket cards by seniority (next-step / sideways /
// earlier-chapters / different-chapter). New guides include the field
// natively via `ContentResponseSchema`; this backfill covers the legacy
// library that pre-dates the field. Idempotent: skips guides that already
// carry the field. Per memory `feedback_check_infra_before_model`, the LLM
// call is cheap (flash tier, single-field schema) so we don't gate on rate
// limits — the only failure mode is OpenRouter being out of credits.

export const _setCareerStage = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    typicalCareerStage: v.union(
      v.literal("early-career"),
      v.literal("mid-career"),
      v.literal("senior-IC"),
      v.literal("manager"),
      v.literal("director"),
      v.literal("exec"),
    ),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide?.content) return;
    await ctx.db.patch(args.guideId, {
      content: {
        ...guide.content,
        typicalCareerStage: args.typicalCareerStage,
      },
      updatedAt: Date.now(),
    });
  },
});

// List complete guides missing a typicalCareerStage. Bounded scan via
// `by_content_status`; the JS-side filter on the optional content field is
// a transformation, not a narrowing operation (still index-bounded).
export const _listGuidesMissingCareerStage = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .take(1000);
    return all
      .filter((g) => g.content && !g.content.typicalCareerStage)
      .slice(0, args.limit);
  },
});

// Per-guide single-classification action. Mirrors `_backfillSkillsDetail`
// in shape (idempotent skip on already-tagged, single try/catch around the
// LLM call so a transient failure on one guide doesn't cancel the batch).
// Used both directly (per-guide retry) and as the staggered unit of
// `triggerCareerStageBackfill`.
export const _backfillCareerStageOne = internalAction({
  args: { guideId: v.id("career_guides") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const guide = await ctx.runQuery(internal.careerGuides._getById, {
      guideId: args.guideId,
    });
    if (!guide?.content || guide.contentStatus !== "complete") return null;
    if (guide.content.typicalCareerStage) return null;

    try {
      const { output } = await generateText({
        model: chatModel(CAREER_STAGE_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: CareerStageSchema }),
        prompt: buildCareerStagePrompt({
          title: guide.title,
          dayToDay: guide.content.dayToDay,
          entrySalary: guide.content.regional.us.salary.entry,
          midSalary: guide.content.regional.us.salary.mid,
          seniorSalary: guide.content.regional.us.salary.senior,
        }),
      });
      await ctx.runMutation(internal.careerGuides._setCareerStage, {
        guideId: args.guideId,
        typicalCareerStage: output.typicalCareerStage,
      });
    } catch (err) {
      console.error("careerGuides:backfill-career-stage-failed", {
        guideId: args.guideId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  },
});

// Batched backfill action. Pulls up to `batchSize` (default 20) untagged
// guides and runs the per-guide classifier serially within the action so
// the rate of OpenRouter calls stays bounded. Returns counts so a script
// can loop until `processed === 0` and know it's done.
export const _backfillCareerStage = internalAction({
  args: { batchSize: v.optional(v.number()) },
  returns: v.object({ processed: v.number(), requested: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ processed: number; requested: number }> => {
    const batch = args.batchSize ?? 20;
    const guides: Array<Doc<"career_guides">> = await ctx.runQuery(
      internal.careerGuides._listGuidesMissingCareerStage,
      { limit: batch },
    );
    let processed = 0;
    for (const g of guides) {
      try {
        const { output } = await generateText({
          model: chatModel(CAREER_STAGE_MODEL_ID, { zdr: true }),
          output: Output.object({ schema: CareerStageSchema }),
          prompt: buildCareerStagePrompt({
            title: g.title,
            dayToDay: g.content?.dayToDay ?? "",
            entrySalary: g.content?.regional.us.salary.entry,
            midSalary: g.content?.regional.us.salary.mid,
            seniorSalary: g.content?.regional.us.salary.senior,
          }),
        });
        await ctx.runMutation(internal.careerGuides._setCareerStage, {
          guideId: g._id,
          typicalCareerStage: output.typicalCareerStage,
        });
        processed++;
      } catch (err) {
        console.warn("careerGuides.backfillCareerStage:failed", {
          guideId: g._id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { processed, requested: guides.length };
  },
});

// Ops trigger: schedule the batched backfill in one shot. Used either via
// admin UI or `npx convex run careerGuides:triggerCareerStageBackfill`.
export const triggerCareerStageBackfill = mutation({
  args: { batchSize: v.optional(v.number()) },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    await ctx.scheduler.runAfter(
      0,
      internal.careerGuides._backfillCareerStage,
      { batchSize: args.batchSize },
    );
    return { scheduled: true };
  },
});

// Ops read: count complete guides that have / don't have typicalCareerStage.
// Mirrors `countSkillsDetailStatus` so a single dashboard can show backfill
// progress at a glance.
export const countCareerStageStatus = query({
  args: {},
  returns: v.object({
    total: v.number(),
    withStage: v.number(),
    missingStage: v.number(),
    pendingTitles: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const guides = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .collect();
    let withStage = 0;
    const pendingTitles: string[] = [];
    for (const g of guides) {
      if (g.content?.typicalCareerStage) withStage++;
      else pendingTitles.push(g.title);
    }
    return {
      total: guides.length,
      withStage,
      missingStage: guides.length - withStage,
      pendingTitles,
    };
  },
});
