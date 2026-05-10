import { query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const MAX_QUERY_LEN = 80;
const MIN_QUERY_LEN = 2;
const RESULT_LIMIT = 8;
// Hard cap on prefix-range scan. Even ambiguous 2-letter prefixes ("Sa",
// "Ne", "Lo") top out around 1-2k matches in 47k cities; we read all of
// them so the popularity rerank picks the canonical big city.
const SCAN_CAP = 4000;

// Public typeahead for the profile location field. Filtered to
// targetType: "City", the broader locations table also holds countries,
// provinces, neighborhoods, etc., but profile location is a city.
//
// Strategy: range query on the lowercased name via `by_target_nameLower`.
// Treat the trimmed query as a prefix and pull every City row whose
// nameLower starts with it, then sort by `reach` desc (population proxy)
// and return the top N. The BM25 search index has no popularity signal,
// so for ambiguous 3-char prefixes (Par, Ber, Mad) it drops the canonical
// big city outside its top-N, the range index avoids that entirely.
export const searchCities = query({
  args: { query: v.string() },
  handler: async (ctx, { query: q }) => {
    const trimmed = q.trim().slice(0, MAX_QUERY_LEN);
    if (trimmed.length < MIN_QUERY_LEN) return [];
    const lower = trimmed.toLowerCase();

    // Convex range-query upper bound: any char above the prefix in BMP.
    // U+FFFD beats every plausible city-name codepoint.
    const upper = lower + "�";

    const candidates = await ctx.db
      .query("locations")
      .withIndex("by_target_nameLower", (i) =>
        i
          .eq("targetType", "City")
          .gte("nameLower", lower)
          .lt("nameLower", upper),
      )
      .take(SCAN_CAP);

    return candidates
      .slice()
      .sort((a, b) => b.reach - a.reach)
      .slice(0, RESULT_LIMIT)
      .map((row) => ({
        id: row._id,
        canonicalName: row.canonicalName,
        countryCode: row.countryCode,
      }));
  },
});

// Dev-only: confirms the `nameLower` backfill has drained. Returns a
// rough missing-count over a sample. Delete with `backfillNameLower`
// after dev seed is settled.
export const backfillStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sample = await ctx.db.query("locations").take(2000);
    const missing = sample.filter((r) => r.nameLower === undefined).length;
    return { sampled: sample.length, missing };
  },
});

// One-shot dev backfill: write `nameLower` for every row in `locations`.
// Self-reschedules until the table is drained. Invoke once with no args:
//   npx convex run --no-push 'locations:backfillNameLower' '{}'
const BACKFILL_BATCH = 1000;
export const backfillNameLower = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("locations")
      .paginate({ cursor: cursor ?? null, numItems: BACKFILL_BATCH });

    let patched = 0;
    for (const doc of result.page) {
      if (doc.nameLower === undefined) {
        await ctx.db.patch(doc._id, { nameLower: doc.name.toLowerCase() });
        patched++;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.locations.backfillNameLower, {
        cursor: result.continueCursor,
      });
    }
    return { patched, isDone: result.isDone };
  },
});
