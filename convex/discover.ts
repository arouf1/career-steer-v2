// convex/discover.ts
import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import {
  ARC_SIM_FLOOR,
  CANDIDATE_POOL_K,
  LANE_BUDGET,
  REGEN_DEBOUNCE_MS,
  SNAPSHOT_MAX_ATTEMPTS,
} from "./lib/discoverThresholds";
import { cosineSim, assignLane } from "./lib/discoverScoring";

/**
 * Resolve the calling user's userId. Throws if unauthenticated.
 *
 * NOTE: this project's `users` table is keyed by Clerk's `tokenIdentifier`
 * (not `subject` / `clerkId`), so we look up by the `by_tokenIdentifier`
 * index — matching the pattern in `convex/users.ts`.
 */
async function requireUserId(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
  db: any;
}): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q: any) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) throw new Error("user-not-provisioned");
  return user._id as Id<"users">;
}

/**
 * Single entry-point for all snapshot regeneration triggers. Debounces
 * within REGEN_DEBOUNCE_MS per userId so a flurry of writes doesn't fire
 * ten generations. `dedupKey` is currently informational only (logged on
 * debounce-skip for traceability); we may partition the debounce window
 * per (userId, dedupKey) if we observe legitimate concurrent triggers
 * needing independent regen.
 *
 * `dedupKey` examples:
 *   "init"          — first eager generation on profile completion
 *   "embedding"     — profile embedding regenerated
 *   "guide:<id>"    — guide content/embedding changed (fan-out)
 *   "manual"        — user-initiated refresh
 */
export const scheduleSnapshotRegeneration = internalMutation({
  args: {
    userId: v.id("users"),
    dedupKey: v.string(),
    /** When true, bypasses the discover_match_reasons cache for fresh LLM calls. */
    forceFreshReasons: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!profile) {
      console.warn("discover.schedule:no-profile", { userId: args.userId });
      return;
    }
    const embedding = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (!embedding) {
      console.warn("discover.schedule:no-embedding", { profileId: profile._id });
      return;
    }

    // Dedup: if a snapshot exists with status "generating" started within
    // the debounce window for this user, skip enqueueing.
    const existing = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (
      existing &&
      existing.status === "generating" &&
      Date.now() - existing.generatedAt < REGEN_DEBOUNCE_MS
    ) {
      console.debug("discover.schedule:debounced", {
        userId: args.userId,
        dedupKey: args.dedupKey,
        ageMs: Date.now() - existing.generatedAt,
      });
      return;
    }

    // Mark a generating row (insert or replace) so subsequent triggers
    // within the window dedup. The action will replace it on success.
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "generating",
        generatedAt: Date.now(),
        attempts: 0,
        failureReason: undefined,
      });
    } else {
      await ctx.db.insert("discover_canvases", {
        userId: args.userId,
        profileId: profile._id,
        profileEmbeddingId: embedding._id,
        generatedAt: Date.now(),
        status: "generating",
        lanes: [],
        attempts: 0,
      });
    }

    await ctx.scheduler.runAfter(0, internal.discover.generateSnapshot, {
      userId: args.userId,
      profileId: profile._id,
      expectedProfileEmbeddingId: embedding._id,
      forceFreshReasons: args.forceFreshReasons ?? false,
    });
  },
});

// ─── generateSnapshot action ────────────────────────────────────────────
//
// Pipeline (built up across Tasks 2.2 – 2.9):
//
//   Step 1  Read profile_embedding + all guide embeddings           [2.2]
//   Step 2  Score each guide on arc/currentState/domain/whole        [2.2]
//   Step 3  Top-K by wholeSim, filter by ARC_SIM_FLOOR               [2.2]
//   Step 4  Drop dismissed guides (with saved-override pin)          [2.3]
//   Step 5  Bucket into linear/adjacent/transformational lanes       [2.3]
//   Step 6  Curate strong/bridge/aspirational slots per lane         [2.4-2.5]
//   Step 7  Top up extras for the slider                             [2.6]
//   Step 8  Generate why-match reasons (cached)                      [2.7]
//   Step 9  Persist snapshot + junction rows                         [this file]
//
// This task implements 1–3; later tasks layer on top, replacing the
// degenerate "everything strong in linear" stub below.

type ScoredCandidate = {
  guideId: Id<"career_guides">;
  arcSim: number;
  currentStateSim: number;
  domainSim: number;
  wholeSim: number;
};

type CardStub = {
  guideId: Id<"career_guides">;
  slotKind: "strong" | "bridge" | "aspirational" | "extra";
  arcScore: number;
  currentStateScore: number;
  domainScore: number;
  wholeScore: number;
  whyMatchReason: string;
};

type LaneStub = {
  kind: "linear" | "adjacent" | "transformational";
  cards: CardStub[];
};

function toCardStub(c: ScoredCandidate): CardStub {
  return {
    guideId: c.guideId,
    slotKind: "strong",
    arcScore: c.arcSim,
    currentStateScore: c.currentStateSim,
    domainScore: c.domainSim,
    wholeScore: c.wholeSim,
    whyMatchReason: "(stub)",
  };
}

export const generateSnapshot = internalAction({
  args: {
    userId: v.id("users"),
    profileId: v.id("profiles"),
    expectedProfileEmbeddingId: v.id("profile_embeddings"),
    forceFreshReasons: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Step 0: Read the user's profile embedding. If it's gone, the embedding
    // was regenerated or deleted between scheduling and execution; abort.
    const profileEmbedding = await ctx.runQuery(
      internal.discover._readProfileEmbedding,
      { profileEmbeddingId: args.expectedProfileEmbeddingId },
    );
    if (!profileEmbedding) {
      throw new ConvexError("profile-not-ready");
    }

    // Step 1: Pull all guide embeddings.
    const guideEmbeddings = await ctx.runQuery(
      internal.discover._readAllGuideEmbeddings,
      {},
    );

    // Step 2: Compute facet sims per guide.
    const scoredAll: ScoredCandidate[] = [];
    for (const ge of guideEmbeddings) {
      scoredAll.push({
        guideId: ge.guideId,
        arcSim: cosineSim(profileEmbedding.arcVector, ge.arcVector),
        currentStateSim: cosineSim(
          profileEmbedding.currentStateVector,
          ge.currentStateVector,
        ),
        domainSim: cosineSim(profileEmbedding.domainVector, ge.domainVector),
        wholeSim: cosineSim(profileEmbedding.wholeVector, ge.wholeVector),
      });
    }

    // Step 3: Top-K by wholeSim, then quality floor on arcSim.
    const candidates: ScoredCandidate[] = scoredAll
      .slice()
      .sort((a, b) => b.wholeSim - a.wholeSim)
      .slice(0, CANDIDATE_POOL_K)
      .filter((c) => c.arcSim >= ARC_SIM_FLOOR);

    // Step 4: Drop dismissed guides for this user. We also collect the saved
    // set up front since Step 5's saved-override needs it.
    const reactions = await ctx.runQuery(internal.discover._readReactions, {
      userId: args.userId,
    });
    const dismissed = new Set<string>(
      reactions
        .filter((r) => r.reaction === "dismissed")
        .map((r) => r.guideId as string),
    );
    const savedSet = new Set<string>(
      reactions
        .filter((r) => r.reaction === "saved")
        .map((r) => r.guideId as string),
    );

    const surviving = candidates.filter(
      (c) => !dismissed.has(c.guideId as string),
    );

    // Step 5: Lane assignment by currentStateSim.
    const byLane: Record<
      "linear" | "adjacent" | "transformational",
      ScoredCandidate[]
    > = {
      linear: [],
      adjacent: [],
      transformational: [],
    };
    for (const c of surviving) {
      byLane[assignLane(c.currentStateSim)].push(c);
    }

    // Saved-guide override: if a lane is empty, pull the highest-arcSim saved
    // guide that didn't naturally land there into it. Remove the picked guide
    // from its natural lane to avoid duplication across lanes.
    //
    // Snapshot of empty lanes is taken once: only originally-empty lanes get
    // backfilled from the saved set. We don't cascade — a pick that empties
    // its natural lane mid-loop is not re-treated as eligible for backfill.
    const emptyLanes = (
      Object.keys(byLane) as Array<keyof typeof byLane>
    ).filter((k) => byLane[k].length === 0);
    if (emptyLanes.length > 0) {
      const savedCandidates = surviving
        .filter((c) => savedSet.has(c.guideId as string))
        .sort((a, b) => b.arcSim - a.arcSim);
      for (const emptyLane of emptyLanes) {
        const pick = savedCandidates.find(
          (c) => assignLane(c.currentStateSim) !== emptyLane,
        );
        if (pick) {
          byLane[emptyLane].push(pick);
          // Remove from its natural lane so a later iteration doesn't re-pick
          // it and end up with the same guide in two lanes.
          const natural = assignLane(pick.currentStateSim);
          byLane[natural] = byLane[natural].filter((x) => x !== pick);
        }
      }
    }

    // Temp cap matches the curated-slot budget (strong + bridge + aspirational
    // = 6). Task 2.4 replaces this slice with proper per-slot picking; Task
    // 2.6 then layers extras on top up to LANE_BUDGET.TOTAL_MAX.
    const CURATED_BUDGET =
      LANE_BUDGET.STRONG + LANE_BUDGET.BRIDGE + LANE_BUDGET.ASPIRATIONAL;
    const lanes: LaneStub[] = (
      ["linear", "adjacent", "transformational"] as const
    ).map((kind) => ({
      kind,
      cards: byLane[kind].slice(0, CURATED_BUDGET).map(toCardStub),
    }));

    await ctx.runMutation(internal.discover._writeSnapshot, {
      userId: args.userId,
      profileId: args.profileId,
      profileEmbeddingId: args.expectedProfileEmbeddingId,
      lanes,
    });
  },
});

// ─── Internal helpers ────────────────────────────────────────────────────

export const _readProfileEmbedding = internalQuery({
  args: { profileEmbeddingId: v.id("profile_embeddings") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.profileEmbeddingId);
  },
});

export const _readAllGuideEmbeddings = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("career_guide_embeddings").collect();
  },
});

export const _readReactions = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("discover_reactions")
      .withIndex("by_user_and_guide", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

const cardValidator = v.object({
  guideId: v.id("career_guides"),
  slotKind: v.union(
    v.literal("strong"),
    v.literal("bridge"),
    v.literal("aspirational"),
    v.literal("extra"),
  ),
  arcScore: v.number(),
  currentStateScore: v.number(),
  domainScore: v.number(),
  wholeScore: v.number(),
  whyMatchReason: v.string(),
});

const laneValidator = v.object({
  kind: v.union(
    v.literal("linear"),
    v.literal("adjacent"),
    v.literal("transformational"),
  ),
  cards: v.array(cardValidator),
});

export const _writeSnapshot = internalMutation({
  args: {
    userId: v.id("users"),
    profileId: v.id("profiles"),
    profileEmbeddingId: v.id("profile_embeddings"),
    lanes: v.array(laneValidator),
  },
  handler: async (ctx, args) => {
    // Concurrency abort: if the live profile_embeddings row for this profile
    // has moved past the embedding we computed against, the snapshot is
    // already stale before we write. Bail out so a fresher in-flight
    // generation wins.
    const liveEmbedding = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();
    if (liveEmbedding && liveEmbedding._id !== args.profileEmbeddingId) {
      throw new ConvexError("profile-embedding-superseded");
    }

    const existing = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const allGuideIds: Id<"career_guides">[] = [];
    for (const lane of args.lanes) {
      for (const card of lane.cards) allGuideIds.push(card.guideId);
    }

    if (existing) {
      // Wipe stale junction rows for this snapshot before re-fanning.
      const stale = await ctx.db
        .query("discover_snapshot_guides")
        .withIndex("by_snapshotId", (q) => q.eq("snapshotId", existing._id))
        .collect();
      for (const row of stale) await ctx.db.delete(row._id);

      await ctx.db.replace(existing._id, {
        userId: args.userId,
        profileId: args.profileId,
        profileEmbeddingId: args.profileEmbeddingId,
        generatedAt: Date.now(),
        status: "ready",
        lanes: args.lanes,
        attempts: 0,
      });

      for (const guideId of allGuideIds) {
        await ctx.db.insert("discover_snapshot_guides", {
          snapshotId: existing._id,
          userId: args.userId,
          guideId,
        });
      }
    } else {
      const snapshotId = await ctx.db.insert("discover_canvases", {
        userId: args.userId,
        profileId: args.profileId,
        profileEmbeddingId: args.profileEmbeddingId,
        generatedAt: Date.now(),
        status: "ready",
        lanes: args.lanes,
        attempts: 0,
      });
      for (const guideId of allGuideIds) {
        await ctx.db.insert("discover_snapshot_guides", {
          snapshotId,
          userId: args.userId,
          guideId,
        });
      }
    }
  },
});
