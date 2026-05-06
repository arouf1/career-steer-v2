// One-shot backfill: stamp `gps` on every active job_posting that has a
// citySlug but no gps yet. Resolves citySlug → locations row (targetType
// "City"), preferring the matching countryCode when available, then copies
// gps onto the posting. Self-reschedules until the table is drained.
//
// Invoke once with no args:
//   npx convex run --no-push 'migrations/2026_05_06_jobPostings_gps:backfillGps' '{}'
//
// The corresponding write-path stamp (in convex/jobPostings.ts:upsertFromSearch)
// keeps new rows populated, so this migration only needs to run on the
// historical tail. After coverage stabilises (≥ 99 %) the schema can tighten
// gps to required in a follow-up commit.

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

const BACKFILL_BATCH = 200;

export const backfillGps = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({
    patched: v.number(),
    skipped: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("job_postings")
      .paginate({ cursor: cursor ?? null, numItems: BACKFILL_BATCH });

    let patched = 0;
    let skipped = 0;

    for (const job of result.page) {
      if (job.gps) {
        skipped++;
        continue;
      }
      if (!job.city) {
        skipped++;
        continue;
      }

      const cityName = job.city.toLowerCase();
      const candidates = await ctx.db
        .query("locations")
        .withIndex("by_target_nameLower", (q) =>
          q.eq("targetType", "City").eq("nameLower", cityName),
        )
        .take(20);

      const match = job.countryCode
        ? candidates.find(
            (l) => l.countryCode.toLowerCase() === job.countryCode!.toLowerCase(),
          )
        : candidates[0];

      if (!match) {
        skipped++;
        continue;
      }

      await ctx.db.patch(job._id, {
        gps: { lat: match.gps.lat, lon: match.gps.lon },
      });
      patched++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations["2026_05_06_jobPostings_gps"].backfillGps,
        { cursor: result.continueCursor },
      );
    }

    return { patched, skipped, isDone: result.isDone };
  },
});
