// Phase 4 of the career-ladders rollout: trigger a fresh discover_canvases
// snapshot for every existing user so they pick up the ladder-aware
// bucketing in `discover.ts`. Idempotent, re-running fans out the same
// regen requests, which the 30s per-user debounce in
// `scheduleSnapshotRegeneration` collapses to one snapshot per user.
//
// Invoke once after Phase 3 ships:
//   npx convex run --no-push 'migrations/2026_05_09_recompute_all_snapshots:recomputeAll' '{}'
//
// Pacing: the debounce window is 30s per userId. Looping at full speed
// inside the action would queue thousands of redundant regen mutations
// (each individually cheap, but wasteful). With ~1 user today this is
// a no-op, but the same script is reusable as the user base grows.

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";

const PAGE_SIZE = 50;

export const _listAllProfileIds = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("profiles")
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
    return {
      page: page.page.map((p) => ({
        profileId: p._id,
        userId: p.userId,
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const recomputeAll = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    queued: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ queued: number; isDone: boolean }> => {
    const result: {
      page: { profileId: any; userId: any }[];
      isDone: boolean;
      continueCursor: string | null;
    } = await ctx.runQuery(
      internal.migrations[
        "2026_05_09_recompute_all_snapshots"
      ]._listAllProfileIds,
      { cursor: args.cursor },
    );

    let queued = 0;
    for (const { userId } of result.page) {
      try {
        await ctx.runMutation(internal.discover.scheduleSnapshotRegeneration, {
          userId,
          dedupKey: "phase-4-ladder-recompute",
          forceFreshReasons: false,
        });
        queued++;
      } catch (err) {
        console.error("recompute: schedule failed", {
          userId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations[
          "2026_05_09_recompute_all_snapshots"
        ].recomputeAll,
        { cursor: result.continueCursor },
      );
    }

    return { queued, isDone: result.isDone };
  },
});
