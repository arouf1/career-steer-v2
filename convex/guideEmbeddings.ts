import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { embedBatch } from "../lib/ai/providers";
import { buildGuideEmbeddingTexts } from "../lib/ai/prompts/guide-embedding-text";

const EMBED_DIM = 1536;
const EMBED_MODEL = "google/gemini-embedding-2-preview";

const BACKFILL_BATCH_SIZE = 5;
const BACKFILL_STAGGER_MS = 2_000;

export const byGuide = internalQuery({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args): Promise<Doc<"career_guide_embeddings"> | null> => {
    return await ctx.db
      .query("career_guide_embeddings")
      .withIndex("by_guideId", (q) => q.eq("guideId", args.guideId))
      .unique();
  },
});

export const upsert = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    wholeVector: v.array(v.float64()),
    arcVector: v.array(v.float64()),
    currentStateVector: v.array(v.float64()),
    domainVector: v.array(v.float64()),
    dimensions: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("career_guide_embeddings")
      .withIndex("by_guideId", (q) => q.eq("guideId", args.guideId))
      .unique();

    const doc = {
      guideId: args.guideId,
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
      await ctx.db.insert("career_guide_embeddings", doc);
    }

    // Phase 4.2 — fan-out: when a guide's embeddings change, every user
    // whose current snapshot includes the guide should regenerate against
    // the fresh vectors. Hook lives ONLY at the upsert (not at
    // careerGuides content-update mutations) because the matching-relevant
    // signal is the vectors, not the content text. Hooking earlier would
    // race the regen against stale embeddings while the embedding job is
    // still in flight, and the per-user 30s debounce would suppress the
    // useful second fire. See `discover.fanOutGuideUpdate` for the
    // affected-user lookup (indexed via `discover_snapshot_guides.by_guideId`)
    // + cached-reason invalidation.
    await ctx.scheduler.runAfter(0, internal.discover.fanOutGuideUpdate, {
      guideId: args.guideId,
    });
  },
});

export const generate = internalAction({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    const guide: Doc<"career_guides"> | null = await ctx.runQuery(
      internal.careerGuides._getById,
      { guideId: args.guideId },
    );
    if (!guide) {
      console.error("guideEmbeddings.generate:guide_missing", {
        guideId: args.guideId,
      });
      return;
    }
    if (guide.contentStatus !== "complete" || !guide.content) {
      console.error("guideEmbeddings.generate:content_not_ready", {
        guideId: args.guideId,
        contentStatus: guide.contentStatus,
      });
      return;
    }

    const texts = buildGuideEmbeddingTexts(guide.title, guide.content);

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

      await ctx.runMutation(internal.guideEmbeddings.upsert, {
        guideId: args.guideId,
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
      console.error("guideEmbeddings.generate:failed", {
        guideId: args.guideId,
        reason,
      });
    }
  },
});

// Returns ids of complete guides that don't yet have an embedding row.
// Used by the backfill action; capped to keep the query under Convex limits
// (hundreds of guides today, well below the document scan cap).
export const _missingEmbeddingIds = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<Id<"career_guides">[]> => {
    const guides = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .collect();

    const missing: Id<"career_guides">[] = [];
    for (const g of guides) {
      if (missing.length >= args.limit) break;
      const existing = await ctx.db
        .query("career_guide_embeddings")
        .withIndex("by_guideId", (q) => q.eq("guideId", g._id))
        .unique();
      if (!existing) missing.push(g._id);
    }
    return missing;
  },
});

export const backfillBatch = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const limit = args.limit ?? BACKFILL_BATCH_SIZE;
    const ids: Id<"career_guides">[] = await ctx.runQuery(
      internal.guideEmbeddings._missingEmbeddingIds,
      { limit },
    );

    for (let i = 0; i < ids.length; i += 1) {
      await ctx.scheduler.runAfter(
        i * BACKFILL_STAGGER_MS,
        internal.guideEmbeddings.generate,
        { guideId: ids[i] },
      );
    }

    return { scheduled: ids.length };
  },
});
