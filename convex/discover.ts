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
  ASPIRATIONAL_RERANK_TOP_N,
  CANDIDATE_POOL_K,
  LANE_BUDGET,
  REGEN_DEBOUNCE_MS,
  SNAPSHOT_MAX_ATTEMPTS,
} from "./lib/discoverThresholds";
import { cosineSim, assignLane } from "./lib/discoverScoring";
import { rerank as openRouterRerank } from "../lib/ai/providers";

/**
 * Test-injectable rerank seam. Production binding is the real OpenRouter
 * call; tests overwrite via `globalThis.__testRerank__` so the deterministic
 * suite never touches the network. Tests should clean up with
 * `delete (globalThis as any).__testRerank__` (preferably in a finally
 * block) so the stub can't leak between tests.
 */
async function callRerank(args: {
  query: string;
  documents: string[];
  topN: number;
}): Promise<Array<{ index: number; relevanceScore: number }>> {
  const injected = (globalThis as any).__testRerank__;
  if (injected) return injected(args);
  return openRouterRerank({
    query: args.query,
    documents: args.documents,
    topN: args.topN,
    model: "cohere/rerank-4-pro",
  });
}

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

/** Slot kinds populated across Steps 6a–6c + Step 7 (extras). */
type Slot = "strong" | "bridge" | "aspirational" | "extra";

type CardStub = {
  guideId: Id<"career_guides">;
  slotKind: Slot;
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

/**
 * Step 6a — strong-fit picks: top-N by arcSim. These are the cards that
 * most resemble the user's narrative arc; they anchor the lane.
 */
function pickStrong(pool: ScoredCandidate[]): ScoredCandidate[] {
  return [...pool]
    .sort((a, b) => b.arcSim - a.arcSim)
    .slice(0, LANE_BUDGET.STRONG);
}

/**
 * Step 6b — bridge picks: top-N by domainSim, with arcSim as tiebreaker.
 * Excludes guides already taken by `pickStrong` so the same card never
 * appears in two slots within a lane.
 */
function pickBridge(
  pool: ScoredCandidate[],
  excluded: Set<string>,
): ScoredCandidate[] {
  return [...pool]
    .filter((c) => !excluded.has(c.guideId as string))
    .sort((a, b) => b.domainSim - a.domainSim || b.arcSim - a.arcSim)
    .slice(0, LANE_BUDGET.BRIDGE);
}

/**
 * Step 6c — aspirational pick. Pulls the top ASPIRATIONAL_RERANK_TOP_N
 * remaining candidates by arcSim, fetches their overview text, and asks
 * Cohere rerank (via the `callRerank` test seam) to pick the single
 * most-resonant guide for the user's `arcSourceText`. If rerank throws
 * (network down, provider hiccup) or returns nothing, falls back to the
 * deterministic formula `max(arcSim - currentStateSim)` over the same
 * remaining set so a snapshot still ships.
 *
 * `excluded` carries the strong + bridge guideIds for this lane so the
 * aspirational slot never duplicates a card already on the lane.
 */
async function pickAspirational(
  ctx: any,
  pool: ScoredCandidate[],
  excluded: Set<string>,
  arcSourceText: string,
): Promise<ScoredCandidate | undefined> {
  const remaining = pool
    .filter((c) => !excluded.has(c.guideId as string))
    .sort((a, b) => b.arcSim - a.arcSim)
    .slice(0, ASPIRATIONAL_RERANK_TOP_N);
  if (remaining.length === 0) return undefined;

  // Pull each candidate's overview text for rerank. `content` is optional
  // on the schema; fall back to `title` so the rerank query always sees
  // *some* text per candidate.
  const guides = await ctx.runQuery(internal.discover._readGuideOverviews, {
    guideIds: remaining.map((c) => c.guideId),
  });
  const docs = remaining.map((c) => {
    const g = guides.find((x: any) => x._id === c.guideId);
    return g?.content?.overview ?? g?.title ?? "";
  });

  try {
    const ranked = await callRerank({
      query: arcSourceText,
      documents: docs,
      topN: 1,
    });
    if (ranked.length > 0) {
      const idx = ranked[0].index;
      if (idx >= 0 && idx < remaining.length) return remaining[idx];
    }
  } catch (err) {
    console.warn("discover.rerank_failed", { err: String(err) });
  }

  // Formula fallback: highest stretch (arcSim - currentStateSim) wins.
  return remaining
    .slice()
    .sort(
      (a, b) =>
        b.arcSim - b.currentStateSim - (a.arcSim - a.currentStateSim),
    )[0];
}

/**
 * Canonical card-shape factory. Tasks 2.5/2.6/2.7 build their own slot
 * pickers on top of this helper so the persisted shape stays consistent.
 */
function withSlot(
  c: ScoredCandidate,
  slotKind: Slot,
  whyMatchReason: string,
): CardStub {
  return {
    guideId: c.guideId,
    slotKind,
    arcScore: c.arcSim,
    currentStateScore: c.currentStateSim,
    domainScore: c.domainSim,
    wholeScore: c.wholeSim,
    whyMatchReason,
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

    // Step 6a + 6b + 6c: pick strong-fit + bridge + aspirational cards per
    // lane. Extras for the slider land in Task 2.6.
    const lanes: LaneStub[] = await Promise.all(
      (["linear", "adjacent", "transformational"] as const).map(async (kind) => {
        const pool = byLane[kind];
        const strong = pickStrong(pool);
        const strongIds = new Set(strong.map((c) => c.guideId as string));
        const bridge = pickBridge(pool, strongIds);
        const usedIds = new Set([
          ...strongIds,
          ...bridge.map((c) => c.guideId as string),
        ]);
        const aspirational = await pickAspirational(
          ctx,
          pool,
          usedIds,
          profileEmbedding.arcSourceText ?? "",
        );
        return {
          kind,
          cards: [
            ...strong.map((c) => withSlot(c, "strong", "(stub)")),
            ...bridge.map((c) => withSlot(c, "bridge", "(stub)")),
            ...(aspirational
              ? [withSlot(aspirational, "aspirational", "(stub)")]
              : []),
          ],
        };
      }),
    );

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

/**
 * Reads guides by id for the Step 6c rerank prompt. Returns the full guide
 * docs so the caller can pull `content?.overview` (preferred) or fall back
 * to `title` when overviews are missing. Order is not guaranteed — callers
 * resolve by id.
 */
export const _readGuideOverviews = internalQuery({
  args: { guideIds: v.array(v.id("career_guides")) },
  handler: async (ctx, args) => {
    const out: Array<Doc<"career_guides">> = [];
    for (const id of args.guideIds) {
      const g = await ctx.db.get(id);
      if (g) out.push(g);
    }
    return out;
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
