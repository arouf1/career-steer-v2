// One-shot fix-up: re-detect each job_posting's countryCode from its
// `location` string (rather than the per-search action arg that was being
// stamped blindly). Re-resolves gps using the corrected countryCode so the
// locations lookup picks the right City row.
//
// Background: SearchAPI's `gl` parameter is a soft hint. Google Jobs may
// return out-of-region results when local matches are thin. The original
// upsertFromSearch trusted args.countryCode for every result, producing
// rows where city="Everett" + countryCode="gb" (US-located postings tagged
// as UK). Those broke the location ladder for UK viewers.
//
// Run once after deploy:
//   npx convex run --no-push 'migrations/2026_05_07_jobPostings_countryCode:backfill' '{}'

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { extractCountryCode } from "../../lib/jobs/normalize";

const PAGE_SIZE = 200;

export const backfill = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({
    countryFixed: v.number(),
    gpsFixed: v.number(),
    skipped: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("job_postings")
      .paginate({ cursor: cursor ?? null, numItems: PAGE_SIZE });

    let countryFixed = 0;
    let gpsFixed = 0;
    let skipped = 0;

    for (const job of result.page) {
      const detected = extractCountryCode(job.location ?? "");
      // Only patch when we have a confident detection AND it disagrees
      // with the stored value. Untouched rows whose location is just a
      // city ("Warrington") keep their existing countryCode.
      const needsCountryFix =
        detected !== undefined && detected !== job.countryCode;
      if (!needsCountryFix && job.gps !== undefined) {
        skipped++;
        continue;
      }

      const newCountryCode = detected ?? job.countryCode;

      // Re-resolve gps with the corrected country code.
      let newGps: { lat: number; lon: number } | undefined = job.gps;
      if (job.city && newCountryCode) {
        const lower = job.city.toLowerCase();
        const candidates = await ctx.db
          .query("locations")
          .withIndex("by_target_nameLower", (q) =>
            q.eq("targetType", "City").eq("nameLower", lower),
          )
          .take(20);
        const match = candidates.find(
          (l) => l.countryCode.toLowerCase() === newCountryCode.toLowerCase(),
        );
        if (match) {
          newGps = { lat: match.gps.lat, lon: match.gps.lon };
        }
      }

      const patch: { countryCode?: string; gps?: { lat: number; lon: number } } = {};
      if (needsCountryFix) {
        patch.countryCode = newCountryCode;
        countryFixed++;
      }
      if (newGps && job.gps === undefined) {
        patch.gps = newGps;
        gpsFixed++;
      } else if (
        newGps &&
        job.gps &&
        (newGps.lat !== job.gps.lat || newGps.lon !== job.gps.lon)
      ) {
        patch.gps = newGps;
        gpsFixed++;
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(job._id, patch);
      } else {
        skipped++;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations["2026_05_07_jobPostings_countryCode"].backfill,
        { cursor: result.continueCursor },
      );
    }

    return {
      countryFixed,
      gpsFixed,
      skipped,
      isDone: result.isDone,
    };
  },
});
