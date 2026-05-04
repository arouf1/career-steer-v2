/**
 * Career Compass voice assistant — non-Node Convex surface.
 *
 * Parallel to convex/voiceCalls.ts (per-guide call). The compass surface
 * shares the persistence + analysis pipeline (appendMessage, finalize,
 * processCallAnalysis) but needs its own context-loader internalQuery and
 * its own row creator that writes `surface: "compass"` instead of
 * `surface: "guide"`.
 *
 * The action that actually mints the Gemini Live ephemeral token lives in
 * compassVoiceNode.ts (Node runtime) — same split as voiceCalls.ts vs
 * voiceCallsNode.ts.
 */

import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

// ── Internal: row creator (called from the Node action after token mint) ──

export const _createCompassSession = internalMutation({
  args: {
    userId: v.id("users"),
    canvasSnapshotId: v.id("discover_canvases"),
    sessionId: v.string(),
    title: v.string(),
    voiceId: v.string(),
    model: v.string(),
    authMode: v.union(v.literal("ephemeral"), v.literal("apiKey")),
  },
  returns: v.id("voice_calls"),
  handler: async (ctx, args): Promise<Id<"voice_calls">> => {
    const now = Date.now();
    return await ctx.db.insert("voice_calls", {
      userId: args.userId,
      surface: "compass",
      canvasSnapshotId: args.canvasSnapshotId,
      // guideId deliberately omitted — compass calls aren't anchored to a
      // single guide. The schema makes guideId optional for exactly this case.
      sessionId: args.sessionId,
      title: args.title,
      voiceProvider: "gemini",
      voiceId: args.voiceId,
      model: args.model,
      authMode: args.authMode,
      status: "active",
      messages: [],
      totalDurationSeconds: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ── Internal query: gather everything mintCompassSession needs in one trip.

/**
 * Single round-trip context loader for compassVoiceNode.mintCompassSession.
 *
 * Loads:
 *   - user identity
 *   - latest profile + enrichment (covers narrative, pivots, work style)
 *   - latest discover_canvases row (status: "ready"; only the user's canvas)
 *   - hydrated guide docs for every card on the canvas (so the prompt has
 *     real titles + citations, not just IDs)
 *   - saved/dismissed reactions (so the model can say "you already saved X")
 *
 * Read-only — the action follows up with _createCompassSession to insert.
 */
export const _gatherCompassContext = internalQuery({
  args: { tokenIdentifier: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      user: v.any(),
      profile: v.any(),
      enrichment: v.any(),
      canvas: v.any(),
      guides: v.any(),
      reactions: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx, args.tokenIdentifier);
    if (!user) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    const enrichment = profile
      ? await ctx.db
          .query("profile_enrichments")
          .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
          .first()
      : null;

    const canvas = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    if (!canvas || canvas.status !== "ready") {
      return {
        user,
        profile,
        enrichment,
        canvas: null,
        guides: [],
        reactions: [],
      };
    }

    // Fan-out load every card's guide doc — bounded by lanes × cards (≤80
    // per snapshot, typically 24 once we filter "extra" downstream). De-dupe
    // by guideId in case the same guide appears in multiple lanes (rare but
    // possible during regen).
    const guideIds = new Set<Id<"career_guides">>();
    for (const lane of canvas.lanes) {
      for (const card of lane.cards) {
        guideIds.add(card.guideId);
      }
    }
    const guides: Doc<"career_guides">[] = [];
    for (const guideId of guideIds) {
      const g = await ctx.db.get(guideId);
      if (g) guides.push(g);
    }

    // Saved + dismissed reactions for this user. Used by the prompt builder
    // to mark cards as "[SAVED]" so the AI can refer back to them naturally.
    const reactions = await ctx.db
      .query("discover_reactions")
      .withIndex("by_user_and_reaction", (q) => q.eq("userId", user._id))
      .collect();

    return { user, profile, enrichment, canvas, guides, reactions };
  },
});

async function resolveUser(
  ctx: QueryCtx,
  tokenIdentifier: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
}
