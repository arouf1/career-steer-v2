import { mutation, query, internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
  },
});

export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const email = identity.email ?? "";
    const name = identity.name;
    const imageUrl = identity.pictureUrl;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (existing) {
      const patch: { email?: string; name?: string; imageUrl?: string } = {};
      if (existing.email !== email) patch.email = email;
      if (name !== undefined && existing.name !== name) patch.name = name;
      if (imageUrl !== undefined && existing.imageUrl !== imageUrl)
        patch.imageUrl = imageUrl;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email,
      name,
      imageUrl,
    });
  },
});

const cascadeDeleteUser = async (
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> => {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  if (profile) {
    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (enrichment) await ctx.db.delete(enrichment._id);

    const embedding = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (embedding) await ctx.db.delete(embedding._id);

    const paths = await ctx.db
      .query("career_paths")
      .withIndex("by_profileId_and_kind", (q) =>
        q.eq("profileId", profile._id),
      )
      .collect();
    for (const row of paths) await ctx.db.delete(row._id);

    await ctx.db.delete(profile._id);
  }

  const personalizations = await ctx.db
    .query("career_guide_personalizations")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  for (const row of personalizations) await ctx.db.delete(row._id);

  // Discover canvas + junction rows (Phase 1+ tables). The snapshot is 1:1
  // per user; junction rows are bounded by N cards in the snapshot
  // (≤ 3 lanes × 20 max). We use by_snapshotId rather than adding a
  // by_userId index on discover_snapshot_guides, keeps the schema lean.
  const canvas = await ctx.db
    .query("discover_canvases")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (canvas) {
    const junctionRows = await ctx.db
      .query("discover_snapshot_guides")
      .withIndex("by_snapshotId", (q) => q.eq("snapshotId", canvas._id))
      .collect();
    for (const r of junctionRows) await ctx.db.delete(r._id);
    await ctx.db.delete(canvas._id);
  }

  // Discover reactions (saved + dismissed). Compound index prefix scan.
  const reactions = await ctx.db
    .query("discover_reactions")
    .withIndex("by_user_and_guide", (q) => q.eq("userId", userId))
    .collect();
  for (const r of reactions) await ctx.db.delete(r._id);

  // Discover match-reason cache. Compound index prefix scan.
  const reasons = await ctx.db
    .query("discover_match_reasons")
    .withIndex("by_user_and_guide", (q) => q.eq("userId", userId))
    .collect();
  for (const r of reasons) await ctx.db.delete(r._id);

  // People search results. LinkedIn profiles found via guide-driven search.
  // by_user_url has userId as prefix, so a direct .eq scan is correct.
  const people = await ctx.db
    .query("key_people")
    .withIndex("by_user_url", (q) => q.eq("userId", userId))
    .collect();
  for (const p of people) await ctx.db.delete(p._id);

  // In-flight people-search runs (state for UI skeletons).
  const runs = await ctx.db
    .query("key_people_runs")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  for (const r of runs) await ctx.db.delete(r._id);

  // Outreach drafts. Each row carries a threadId pointing into the Convex
  // Agent component's tables (private to the component). We schedule the
  // component's own deletion mutation for each thread, it will recursively
  // delete the thread's messages and streams pages off the parent commit.
  const streams = await ctx.db
    .query("outreach_streams")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  for (const s of streams) {
    await ctx.scheduler.runAfter(
      0,
      components.agent.threads.deleteAllForThreadIdAsync,
      { threadId: s.threadId },
    );
    await ctx.db.delete(s._id);
  }

  // Per-user seed rate-limit bucket (set by _requestGenerationForSeeding).
  // Keyed in rate_limits as `seed:${userId}`. Cleaning it ensures a
  // recreated account starts with a fresh seeding budget.
  const seedRateLimit = await ctx.db
    .query("rate_limits")
    .withIndex("by_key", (q) => q.eq("key", `seed:${userId}`))
    .unique();
  if (seedRateLimit) await ctx.db.delete(seedRateLimit._id);

  await ctx.db.delete(userId);
};

export const deleteByTokenIdentifierInternal = internalMutation({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    if (!user) return;

    await cascadeDeleteUser(ctx, user._id);
  },
});
