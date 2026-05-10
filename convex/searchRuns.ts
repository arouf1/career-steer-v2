// Per-query SearchAPI cache marker. The action `convex/jobSearch.ts:search`
// consults `lookup` before fanning out to SearchAPI, if a row exists for
// (queryNormalized, citySlug, countryCode) within the freshness window, we
// skip the paid API call entirely and serve the existing job_postings rows
// for that query.
//
// Why a separate table: relying on per-posting `searchQueries.includes()`
// alone is brittle. A first-time search that returns 9 jobs leaves the
// cache below the searchCache threshold (10) and the next identical search
// re-hits the API. A deterministic per-query timestamp avoids that and
// works for niche queries with few results.

import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

// Public single-row lookup. Keyed by the normalized query + slugged city +
// lowercased country code. citySlug/countryCode default to empty string so
// the index keys are total (Convex indexes don't allow nulls in middle
// positions of a composite key).
export const lookup = query({
  args: {
    queryNormalized: v.string(),
    citySlug: v.string(),
    countryCode: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      lastRunAt: v.number(),
      resultCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("search_runs")
      .withIndex("by_query_city_country", (q) =>
        q
          .eq("queryNormalized", args.queryNormalized)
          .eq("citySlug", args.citySlug)
          .eq("countryCode", args.countryCode),
      )
      .unique();
    if (!row) return null;
    return {
      lastRunAt: row.lastRunAt,
      resultCount: row.resultCount,
    };
  },
});

// Internal upsert. Called by jobSearch.search after a successful SearchAPI
// run. Stamps lastRunAt = now and updates resultCount so the lookup can
// surface stats in the future (e.g. "we have 8 cached, last refreshed 12m
// ago"). Treated as fire-and-forget by the caller, failures here would
// just mean the next identical search re-hits the API, not data loss.
export const record = internalMutation({
  args: {
    queryNormalized: v.string(),
    citySlug: v.string(),
    countryCode: v.string(),
    resultCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("search_runs")
      .withIndex("by_query_city_country", (q) =>
        q
          .eq("queryNormalized", args.queryNormalized)
          .eq("citySlug", args.citySlug)
          .eq("countryCode", args.countryCode),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastRunAt: now,
        resultCount: args.resultCount,
      });
    } else {
      await ctx.db.insert("search_runs", {
        queryNormalized: args.queryNormalized,
        citySlug: args.citySlug,
        countryCode: args.countryCode,
        lastRunAt: now,
        resultCount: args.resultCount,
      });
    }
    return null;
  },
});
