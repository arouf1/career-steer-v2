import { action, internalQuery, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  searchGoogleJobs,
  type GoogleJobsRawJob,
} from "../lib/server/searchapi";
import { computeDedupKey, extractCity, slugify } from "../lib/jobs/normalize";
import { cosineSim } from "./lib/discoverScoring";

// Cosine bands for the qualitative fit tier surfaced to the user. We
// deliberately do not show a numeric percentage — V1 did and it read as the
// generic AI-product cliché. Editorial tiers ("Strong match" / "Worth
// exploring" / nothing) lean on the brand voice instead. Thresholds are an
// initial guess; tune with real distributions once we have telemetry.
const FIT_TIER_STRONG_MIN = 0.7;
const FIT_TIER_WORTH_MIN = 0.55;

const DESCRIPTION_MAX_CHARS = 400;

// Cache freshness window for the workspace search action. Tunable;
// 1 hour is a starting point that errs toward freshness — frequent
// re-searches inside a session will hit cache, but the next morning
// we'll re-fetch and pick up new postings.
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

// Fallback floor for the legacy "any cached postings will do" path. Only
// used when no `search_runs` row exists for this query (i.e. queries cached
// before search_runs shipped). The deterministic search_runs lookup
// supersedes this — once a query has been recorded, we honour the run
// regardless of count.
const MIN_CACHE_HITS_TO_SKIP_API = 5;

// Normalize a raw query string for cache-key purposes. Lowercased and
// collapsed whitespace; matches the same normalization applied at lookup
// time inside jobPostings.searchCache.
const normalizeQuery = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/g, " ");

export type FitTier = "strong" | "worth" | null;

export type JobResult = {
  position: number | null;
  title: string;
  companyName: string | null;
  location: string | null;
  via: string | null;
  description: string | null;
  applyLink: string | null;
  sharingLink: string | null;
  thumbnail: string | null;
  schedule: string | null;
  postedAt: string | null;
  salary: string | null;
  workFromHome: boolean | null;
  // Identifiers for the cache row backing this result. Populated for both
  // cache hits and SearchAPI hits (post-upsert). Used by the workspace UI as
  // a stable React key and as the link target for the /jobs/listing/ detail
  // page. Null only on pagination pages where we don't round-trip through
  // the cache.
  jobPostingId: Id<"job_postings"> | null;
  dedupKey: string | null;
  // URL slugs for the canonical detail-page path
  // /jobs/listing/[citySlug]/[companySlug]/[titleSlug]/[jobPostingId].
  // Same nullability story as jobPostingId — present iff the row is cached.
  citySlug: string | null;
  companySlug: string | null;
  titleSlug: string | null;
  // Brandfetch enrichment from the joined companies row. Card uses logoUrl
  // when present, falls back to a lettermark when both are null. domain is
  // exposed for an eventual "company.com" caption affordance.
  companyDomain: string | null;
  companyLogoUrl: string | null;
  companyBrandColor: string | null;
  // Qualitative fit tier — populated only when the user is signed in, has a
  // profile embedding, and the posting itself has been embedded. Ranking
  // upstream sorts strong/worth ahead of unscored postings; the UI surfaces
  // a small editorial tag for strong/worth and nothing otherwise.
  fitTier: FitTier;
};

export type SearchOk = {
  ok: true;
  jobs: JobResult[];
  totalResults: number | null;
  detectedLocation: string | null;
  nextPageToken: string | null;
  // Cache provenance.
  fromCache: boolean;        // true if entirely served from cache (no SearchAPI call)
  cachedCount: number;       // how many of jobs[] were already in the cache before this call
  freshCount: number;        // how many were inserted this call
  totalActiveCached: number; // total active postings in the whole cache (system-wide)
  // Typo correction. When the Flash corrector changed the input, originalQuery
  // is what the user typed and correctedQuery is what we actually searched.
  // The UI surfaces "Showing results for X — search instead for Y" and the
  // alternative re-runs with skipCorrection: true.
  originalQuery: string;
  correctedQuery: string | null; // null when no correction was applied
};

export type SearchErr = {
  ok: false;
  error: "empty_query" | "search_failed";
  message?: string;
};

export type SearchResult = SearchOk | SearchErr;

// SearchAPI sometimes returns the description as raw HTML (with <p>, <br>,
// entity escapes, etc). Convert to plain text before we hand it to the
// client — otherwise the workspace card renders "<p>Are you…" verbatim while
// the LLM rewrite is still in flight. Keep it cheap: regex strip, minimal
// entity expansion, whitespace collapse.
const stripHtmlToText = (s: string): string =>
  s
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&hellip;/gi, "…")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const truncate = (s: string | undefined, max: number): string | null => {
  if (!s) return null;
  const cleaned = stripHtmlToText(s);
  if (cleaned.length === 0) return null;
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1).trimEnd() + "…";
};

const projectFromSearchAPI = (raw: GoogleJobsRawJob[]): JobResult[] =>
  raw
    .filter((j): j is GoogleJobsRawJob & { title: string } =>
      typeof j.title === "string" && j.title.length > 0,
    )
    .map((j) => {
      // SearchAPI populates `apply_link` (single) and/or `apply_links` (array
      // of {link, source}). Some listings only carry one. Fall through both.
      const fallbackArrayLink =
        j.apply_links?.find((a) => typeof a.link === "string" && a.link.length > 0)
          ?.link ?? null;
      return {
        position: typeof j.position === "number" ? j.position : null,
        title: j.title,
        companyName: j.company_name ?? null,
        location: j.location ?? null,
        via: j.via ?? null,
        description: truncate(j.description, DESCRIPTION_MAX_CHARS),
        applyLink: j.apply_link ?? fallbackArrayLink ?? null,
        sharingLink: j.sharing_link ?? null,
        thumbnail: j.thumbnail ?? null,
        schedule: j.detected_extensions?.schedule ?? null,
        postedAt: j.detected_extensions?.posted_at ?? null,
        salary: j.detected_extensions?.salary ?? null,
        workFromHome: j.detected_extensions?.work_from_home ?? null,
        jobPostingId: null as Id<"job_postings"> | null,
        dedupKey: null as string | null,
        citySlug: null as string | null,
        companySlug: null as string | null,
        titleSlug: null as string | null,
        // Brand + fit fields — filled in by attachIdsByDedupKey (which joins
        // companies) and applyFitScores (which joins embeddings) downstream.
        // Defaulted to null here so the projection is shape-stable.
        companyDomain: null as string | null,
        companyLogoUrl: null as string | null,
        companyBrandColor: null as string | null,
        fitTier: null as FitTier,
      };
    });

// The mutation upserts and returns per-job mappings (dedupKey → jobPostingId).
// We use the dedupKey to locate each result in our projection and stamp the
// IDs on. Done in a single pass via a Map. The mapping also carries the
// joined Brandfetch fields off the companies row so the workspace card can
// render a logo without a second roundtrip.
type Mapping = {
  dedupKey: string;
  jobPostingId: Id<"job_postings">;
  citySlug: string;
  companySlug: string;
  titleSlug: string;
  companyDomain: string | null;
  companyLogoUrl: string | null;
  companyBrandColor: string | null;
};

// Loads the current user's profile.wholeVector and the wholeVector of every
// supplied job posting, returning a map of jobPostingId → cosine similarity.
// Postings without an embedding are absent from the map (the action below
// reads that as "no fit signal yet"). The query gates on auth + profile
// embedding existence and short-circuits cleanly when the user is signed out
// or hasn't been embedded yet.
export const _loadFitScores = internalQuery({
  args: {
    jobPostingIds: v.array(v.id("job_postings")),
    tokenIdentifier: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      profileVector: v.array(v.float64()),
      jobVectors: v.array(
        v.object({
          jobPostingId: v.id("job_postings"),
          vector: v.array(v.float64()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    if (!user) return null;

    const profileEmbedding = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!profileEmbedding) return null;

    const jobVectors: Array<{
      jobPostingId: Id<"job_postings">;
      vector: number[];
    }> = [];
    for (const jobPostingId of args.jobPostingIds) {
      const e = await ctx.db
        .query("job_posting_embeddings")
        .withIndex("by_jobPostingId", (q) =>
          q.eq("jobPostingId", jobPostingId),
        )
        .unique();
      if (e) {
        jobVectors.push({ jobPostingId, vector: e.wholeVector });
      }
    }

    return {
      profileVector: profileEmbedding.wholeVector,
      jobVectors,
    };
  },
});

// Stamp a fitTier on each result and reorder so strong/worth float to the top
// (within tier, original SearchAPI/cache order is preserved). When the user
// has no profile embedding, no posting embeddings, or both, the input list is
// returned unchanged. This is the "honest absence" UX call: we don't leak
// missing scores as a visible state — the list just falls back to relevance.
async function applyFitAndRank(
  ctx: ActionCtx,
  jobs: JobResult[],
  tokenIdentifier: string,
): Promise<JobResult[]> {
  const ids = jobs
    .map((j) => j.jobPostingId)
    .filter((id): id is Id<"job_postings"> => id !== null);
  if (ids.length === 0) return jobs;

  const fitData = await ctx.runQuery(internal.jobSearch._loadFitScores, {
    jobPostingIds: ids,
    tokenIdentifier,
  });

  if (!fitData || fitData.jobVectors.length === 0) return jobs;

  const tierByJobId = new Map<Id<"job_postings">, FitTier>();
  for (const { jobPostingId, vector } of fitData.jobVectors) {
    let sim: number;
    try {
      sim = cosineSim(fitData.profileVector, vector);
    } catch {
      // Dimension mismatch — happens during a model migration window.
      // Drop fit silently, the rest of the list is still usable.
      continue;
    }
    const tier: FitTier =
      sim >= FIT_TIER_STRONG_MIN
        ? "strong"
        : sim >= FIT_TIER_WORTH_MIN
          ? "worth"
          : null;
    tierByJobId.set(jobPostingId, tier);
  }

  const stamped = jobs.map((j) => ({
    ...j,
    fitTier:
      j.jobPostingId !== null
        ? (tierByJobId.get(j.jobPostingId) ?? null)
        : null,
  }));

  // Stable sort — tier rank desc, original order preserved within tier.
  const tierRank: Record<string, number> = { strong: 2, worth: 1 };
  return stamped
    .map((j, i) => ({ j, i }))
    .sort((a, b) => {
      const ra = a.j.fitTier ? (tierRank[a.j.fitTier] ?? 0) : 0;
      const rb = b.j.fitTier ? (tierRank[b.j.fitTier] ?? 0) : 0;
      if (ra !== rb) return rb - ra;
      return a.i - b.i;
    })
    .map(({ j }) => j);
}

async function attachIdsByDedupKey(
  jobs: JobResult[],
  mappings: ReadonlyArray<Mapping>,
): Promise<JobResult[]> {
  const byKey = new Map<string, Mapping>(mappings.map((m) => [m.dedupKey, m]));
  // Recompute dedup key for each projected job so we can match the mapping.
  return Promise.all(
    jobs.map(async (job) => {
      const company = job.companyName ?? "";
      if (!company || !job.title) return job;
      const dedupKey = await computeDedupKey({
        title: job.title,
        company,
        city: extractCity(job.location ?? ""),
      });
      const m = byKey.get(dedupKey);
      if (!m) return { ...job, dedupKey };
      return {
        ...job,
        dedupKey,
        jobPostingId: m.jobPostingId,
        citySlug: m.citySlug,
        companySlug: m.companySlug,
        titleSlug: m.titleSlug,
        companyDomain: m.companyDomain,
        companyLogoUrl: m.companyLogoUrl,
        companyBrandColor: m.companyBrandColor,
      };
    }),
  );
}

export const search = action({
  args: {
    query: v.string(),
    location: v.optional(v.string()),
    gl: v.optional(v.string()),
    nextPageToken: v.optional(v.string()),
    // Set when the user clicks the "search instead for {original}" link.
    // Bypasses Flash correction so they get exactly what they typed.
    skipCorrection: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SearchResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const originalQuery = args.query.trim();
    if (originalQuery.length === 0) {
      return { ok: false, error: "empty_query" };
    }

    // Typo correction. Cached after first call per inputNormalized; ~1s
    // first-time penalty, free thereafter. Pagination skips correction so
    // page 2+ stays on the same query the page-1 cache row was keyed by.
    let trimmedQuery = originalQuery;
    let correctedQuery: string | null = null;
    if (!args.nextPageToken && !args.skipCorrection) {
      const correction = await ctx.runAction(
        internal.queryCorrection.getOrCreateCorrection,
        { rawQuery: originalQuery },
      );
      if (correction.hadTypo && correction.corrected !== originalQuery) {
        trimmedQuery = correction.corrected;
        correctedQuery = correction.corrected;
      }
    }

    const trimmedLocation = args.location?.trim();
    const trimmedGl = args.gl?.trim().toLowerCase();
    const isPaginated = !!args.nextPageToken;

    // Compute citySlug for cache lookup. extractCity handles the "London,
    // United Kingdom (Hybrid)" case → "London", and slugify lowers/hyphenates.
    const citySlug =
      trimmedLocation && trimmedLocation.length > 0
        ? slugify(extractCity(trimmedLocation))
        : undefined;

    // Pull cache stats once up front so we can include totalActiveCached
    // in the response regardless of code path.
    const stats = await ctx.runQuery(api.jobPostings.cacheStats, {});
    const totalActiveCached = stats.totalActive;

    // Cache lookup — only on the first page of a query. Pagination tokens are
    // session-bound to SearchAPI's continuation state, so paginated requests
    // always go to the API.
    //
    // Decision uses two signals, in order:
    //   1. search_runs row for this exact (queryNormalized, citySlug, gl) —
    //      authoritative "we've already paid SearchAPI for this query within
    //      the freshness window". Honour the run regardless of cache size.
    //   2. Legacy fallback: searchCache returned ≥ MIN_CACHE_HITS_TO_SKIP_API
    //      rows. Covers queries cached before search_runs shipped.
    const queryNormalized = normalizeQuery(trimmedQuery);
    const citySlugForCache = citySlug ?? "";
    const countryCodeForCache = trimmedGl ?? "";

    if (!isPaginated) {
      const recordedRun = await ctx.runQuery(api.searchRuns.lookup, {
        queryNormalized,
        citySlug: citySlugForCache,
        countryCode: countryCodeForCache,
      });
      const runIsFresh =
        recordedRun !== null &&
        Date.now() - recordedRun.lastRunAt <= CACHE_MAX_AGE_MS;

      // When the run is authoritative, drop the per-posting citySlug filter.
      // SearchAPI returns jobs across nearby cities for a single location
      // query (e.g. "London" surfaces Slough, Croydon, Rotherham, …), so
      // filtering the cache by per-posting citySlug throws away the very
      // results we just paid for. The search_runs row already keys the
      // (query, citySlug, countryCode) tuple — that's the cache boundary.
      // The legacy fallback path keeps the citySlug filter so cold queries
      // pre-dating search_runs still scope sensibly.
      const cached = await ctx.runQuery(api.jobPostings.searchCache, {
        query: trimmedQuery,
        citySlug: runIsFresh ? undefined : citySlug,
        maxAgeMs: CACHE_MAX_AGE_MS,
      });

      const shouldServeCache =
        runIsFresh || cached.length >= MIN_CACHE_HITS_TO_SKIP_API;

      if (shouldServeCache) {
        const cachedJobs = cached.map((c) => ({
          ...c,
          fitTier: null as FitTier,
        })) as JobResult[];
        const ranked = await applyFitAndRank(
          ctx,
          cachedJobs,
          identity.tokenIdentifier,
        );
        return {
          ok: true,
          jobs: ranked,
          totalResults: ranked.length,
          detectedLocation: null,
          nextPageToken: null,
          fromCache: true,
          cachedCount: ranked.length,
          freshCount: 0,
          totalActiveCached,
          originalQuery,
          correctedQuery,
        };
      }
    }

    // Fall through to SearchAPI.
    let raw;
    try {
      raw = await searchGoogleJobs({
        query: trimmedQuery,
        location:
          trimmedLocation && trimmedLocation.length > 0
            ? trimmedLocation
            : undefined,
        gl: trimmedGl && trimmedGl.length > 0 ? trimmedGl : undefined,
        nextPageToken: args.nextPageToken,
      });
    } catch (err) {
      console.error("jobSearch.search:failed", {
        query: trimmedQuery,
        location: trimmedLocation,
        gl: trimmedGl,
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        error: "search_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const projected = projectFromSearchAPI(raw.jobs ?? []);

    // Upsert into the cache. The mutation returns per-job mappings keyed by
    // dedupKey so we can stamp IDs onto the projection.
    const upsertResult = await ctx.runMutation(
      internal.jobPostings.upsertFromSearch,
      {
        jobs: projected.map((j) => ({
          position: j.position,
          title: j.title,
          companyName: j.companyName,
          location: j.location,
          via: j.via,
          description: j.description,
          applyLink: j.applyLink,
          sharingLink: j.sharingLink,
          thumbnail: j.thumbnail,
          schedule: j.schedule,
          postedAt: j.postedAt,
          salary: j.salary,
          workFromHome: j.workFromHome,
        })),
        searchQuery: trimmedQuery,
        countryCode: trimmedGl,
      },
    );

    const enriched = await attachIdsByDedupKey(projected, upsertResult.mappings);
    const ranked = await applyFitAndRank(
      ctx,
      enriched,
      identity.tokenIdentifier,
    );

    // Stamp the per-query cache marker so the next identical search inside
    // the freshness window skips SearchAPI. Only on the first page — page 2+
    // continues SearchAPI's pagination cursor and shouldn't reset the run.
    if (!isPaginated) {
      await ctx.runMutation(internal.searchRuns.record, {
        queryNormalized,
        citySlug: citySlugForCache,
        countryCode: countryCodeForCache,
        resultCount: ranked.length,
      });
    }

    return {
      ok: true,
      jobs: ranked,
      totalResults: raw.search_information?.total_results ?? null,
      detectedLocation: raw.search_information?.detected_location ?? null,
      nextPageToken: raw.pagination?.next_page_token ?? null,
      fromCache: false,
      cachedCount: upsertResult.alreadyCachedCount,
      freshCount: upsertResult.upsertedCount,
      totalActiveCached: totalActiveCached + upsertResult.upsertedCount,
      originalQuery,
      correctedQuery,
    };
  },
});
