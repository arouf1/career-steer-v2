import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const _lookup = internalQuery({
  args: { prefilteredKey: v.string() },
  handler: async (ctx, { prefilteredKey }) => {
    return await ctx.db
      .query("title_canonicalizations")
      .withIndex("by_prefiltered_key", (q) =>
        q.eq("prefilteredKey", prefilteredKey),
      )
      .first();
  },
});

// Read-then-insert under Convex's serializable transaction. If a concurrent
// writer commits first, our commit OCC-conflicts and retries; on retry the
// read finds the existing row and we return it instead of inserting a
// duplicate. This is the layer-2 dedup primitive — guarantees one
// canonical title per prefilteredKey forever.
export const _writeThrough = internalMutation({
  args: {
    prefilteredKey: v.string(),
    sourceTitle: v.string(),
    canonicalTitle: v.string(),
    model: v.string(),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("title_canonicalizations")
      .withIndex("by_prefiltered_key", (q) =>
        q.eq("prefilteredKey", args.prefilteredKey),
      )
      .first();
    if (existing) {
      return {
        _id: existing._id,
        canonicalTitle: existing.canonicalTitle,
        confidence: existing.confidence,
        cached: true as const,
      };
    }
    const _id = await ctx.db.insert("title_canonicalizations", {
      prefilteredKey: args.prefilteredKey,
      sourceTitle: args.sourceTitle,
      canonicalTitle: args.canonicalTitle,
      model: args.model,
      confidence: args.confidence,
      createdAt: Date.now(),
    });
    return {
      _id,
      canonicalTitle: args.canonicalTitle,
      confidence: args.confidence,
      cached: false as const,
    };
  },
});
