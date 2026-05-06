import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  computeDedupKey,
  extractCity,
  normalizeCompanyName,
  slugify,
} from "../lib/jobs/normalize";
import { expandTitleAbbreviations } from "./lib/titleAbbreviations";

// Maximum number of distinct queries to remember on a posting. Once we've
// seen a posting under 20 different searches, additional ones are dropped.
// Trades a small loss of analytics for bounded row size.
const MAX_SEARCH_QUERIES = 20;

// ── Input shape from convex/jobSearch.ts -------------------------------------
//
// Mirrors the projected JobResult that the search action sends to the client.
// Defined here as a Convex validator so the mutation signature is type-checked
// end-to-end. Keep in lockstep with JobResult in jobSearch.ts.
const JobInputValidator = v.object({
  position: v.union(v.number(), v.null()),
  title: v.string(),
  companyName: v.union(v.string(), v.null()),
  location: v.union(v.string(), v.null()),
  via: v.union(v.string(), v.null()),
  description: v.union(v.string(), v.null()),
  applyLink: v.union(v.string(), v.null()),
  sharingLink: v.union(v.string(), v.null()),
  thumbnail: v.union(v.string(), v.null()),
  schedule: v.union(v.string(), v.null()),
  postedAt: v.union(v.string(), v.null()),
  salary: v.union(v.string(), v.null()),
  workFromHome: v.union(v.boolean(), v.null()),
});

export type CachedPosting = Doc<"job_postings">;

// ── Cache lookup ------------------------------------------------------------
//
// Returns active postings whose searchQueries includes an exact match for
// the supplied query AND whose citySlug matches AND whose lastSeenAt is
// within maxAgeMs. Exact-match only for v1; vector-similarity matching is
// deferred until postings have embeddings (later sub-project).
//
// Returns the same projection shape as the SearchAPI path so callers can
// treat cache hits and SearchAPI hits identically.
export const searchCache = query({
  args: {
    query: v.string(),
    citySlug: v.optional(v.string()),
    maxAgeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.maxAgeMs;
    const trimmedQuery = args.query.trim();
    if (trimmedQuery.length === 0) return [];

    // Match queries case- and whitespace-insensitively so capitalization
    // drift between the corrector / user input doesn't make the cache miss.
    const queryNormalized = trimmedQuery.toLowerCase().replace(/\s+/g, " ");

    // Index is (isActive, lastSeenAt). Walk from newest backward; stop when
    // we drop below the cutoff.
    const recent = await ctx.db
      .query("job_postings")
      .withIndex("by_isActive_lastSeenAt", (q) =>
        q.eq("isActive", true).gte("lastSeenAt", cutoff),
      )
      .order("desc")
      .take(200);

    const filtered = recent.filter((p) => {
      const hasQuery = p.searchQueries.some(
        (q) => q.trim().toLowerCase().replace(/\s+/g, " ") === queryNormalized,
      );
      if (!hasQuery) return false;
      if (args.citySlug && p.citySlug !== args.citySlug) return false;
      return true;
    });

    // Project to the JobResult shape the client already consumes. Companies
    // are joined N+1 here — N is bounded to ~50 by the projection size and
    // each row hits a single point lookup, which is acceptable for v1.
    const results = await Promise.all(
      filtered.map(async (p) => {
        const company = await ctx.db.get(p.companyId);
        return {
          jobPostingId: p._id,
          dedupKey: p.dedupKey,
          citySlug: p.citySlug,
          companySlug: company?.slug ?? null,
          titleSlug: p.titleSlug,
          position: null as number | null,
          title: p.title,
          companyName: company?.nameRaw ?? null,
          location: p.location,
          via: p.via ?? null,
          description: p.rawDescription
            ? p.rawDescription.length > 400
              ? p.rawDescription.slice(0, 399).trimEnd() + "…"
              : p.rawDescription
            : null,
          applyLink: p.applyLink ?? null,
          sharingLink: p.sharingLink ?? null,
          thumbnail: p.thumbnail ?? null,
          schedule: p.detectedExtensions?.schedule ?? null,
          postedAt: p.detectedExtensions?.postedAt ?? null,
          salary: p.detectedExtensions?.salary ?? null,
          workFromHome: p.detectedExtensions?.workFromHome ?? null,
          // Brandfetch enrichment, populated by convex/companies.ts when the
          // company row was created or backfilled. Cards prefer logoUrl when
          // present; domain is the fallback that lets the renderer hit the
          // Brandfetch CDN directly.
          companyDomain: company?.domain ?? null,
          companyLogoUrl: company?.logoUrl ?? null,
          companyBrandColor: company?.brandColor ?? null,
        };
      }),
    );

    return results;
  },
});

// Public query for the /jobs/listing/[city]/[company]/[title]/[id] page.
// No auth gate — these pages are SEO-indexable. Returns posting + company +
// optionally the related career-guide stub for cross-linking. The page
// component decides whether to redirect to the canonical URL when the slug
// segments in the URL don't match the actual posting.
export const getByPublicId = query({
  args: { id: v.id("job_postings") },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.id);
    if (!posting) return null;
    const company = await ctx.db.get(posting.companyId);
    if (!company) return null;

    // Cross-link target. Sub-project 5 will fill richer per-company-role
    // research; for now the page just links to the matching career guide
    // when one exists.
    let relatedGuide:
      | {
          slug: string;
          title: string;
          illustrationStorageId: Id<"_storage"> | null;
        }
      | null = null;
    if (posting.roleArchetypeSlug) {
      const guide = await ctx.db
        .query("career_guides")
        .withIndex("by_slug", (q) =>
          q.eq("slug", posting.roleArchetypeSlug as string),
        )
        .first();
      if (guide) {
        relatedGuide = {
          slug: guide.slug,
          title: guide.title,
          illustrationStorageId: guide.illustrationStorageId ?? null,
        };
      }
    }

    // Sub-project 4: surface the hero image URL alongside the posting.
    // ctx.storage.getUrl returns a signed URL that the page <img> can render
    // without going through any of our endpoints.
    const illustrationUrl = posting.illustrationStorageId
      ? await ctx.storage.getUrl(posting.illustrationStorageId)
      : null;

    // Sub-project 5: research panels. Both queries are idempotent reads of
    // pre-computed rows; the page triggers generation via ensureResearchQueued.
    const companyResearch = await ctx.db
      .query("company_research")
      .withIndex("by_companyId", (q) => q.eq("companyId", posting.companyId))
      .first();
    const companyRoleResearch = posting.roleArchetypeSlug
      ? await ctx.db
          .query("company_role_research")
          .withIndex("by_companyId_archetype", (q) =>
            q
              .eq("companyId", posting.companyId)
              .eq("roleArchetypeSlug", posting.roleArchetypeSlug as string),
          )
          .first()
      : null;

    return {
      posting,
      company: {
        _id: company._id,
        nameRaw: company.nameRaw,
        slug: company.slug,
        domain: company.domain ?? null,
        logoUrl: company.logoUrl ?? null,
      },
      relatedGuide,
      illustrationUrl,
      companyResearch: companyResearch
        ? {
            status: companyResearch.status,
            culture: companyResearch.culture ?? null,
            financials: companyResearch.financials ?? null,
            citations: companyResearch.citations ?? {},
          }
        : null,
      companyRoleResearch: companyRoleResearch
        ? {
            status: companyRoleResearch.status,
            interview: companyRoleResearch.interview ?? null,
            compensation: companyRoleResearch.compensation ?? null,
            citations: companyRoleResearch.citations ?? {},
          }
        : null,
    };
  },
});

// Public listing for the /jobs index page. Returns the lightweight mirror so
// the page can render a 24-card grid without joining the full job_postings
// rows. Active only; sorted by recency. Optional q (matches title or
// companyName) and city (matches city or citySlug) substring filters apply
// after the index walk; we overscan to keep `limit` results coming through.
export const listPublicRecent = query({
  args: {
    limit: v.number(),
    cursorLastSeenAt: v.optional(v.number()),
    q: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit, 1), 100);
    const qNeedle = args.q?.trim().toLowerCase();
    const cityNeedle = args.city?.trim().toLowerCase();
    const filtering = !!(qNeedle || cityNeedle);

    // When filtering, overscan substantially so we don't return a thin page
    // just because the first batch missed the filter. Cap at 500 to stay
    // well within Convex's read-bytes ceiling.
    const fetchTarget = filtering ? Math.min(500, (limit + 1) * 12) : limit + 1;

    const baseQuery = args.cursorLastSeenAt
      ? ctx.db
          .query("job_postings_index")
          .withIndex("by_isActive_lastSeenAt", (q) =>
            q
              .eq("isActive", true)
              .lt("lastSeenAt", args.cursorLastSeenAt as number),
          )
      : ctx.db
          .query("job_postings_index")
          .withIndex("by_isActive_lastSeenAt", (q) => q.eq("isActive", true));

    const rows = await baseQuery.order("desc").take(fetchTarget);

    const matches = filtering
      ? rows.filter((row) => {
          if (
            qNeedle &&
            !(
              row.title.toLowerCase().includes(qNeedle) ||
              row.companyName.toLowerCase().includes(qNeedle)
            )
          ) {
            return false;
          }
          if (
            cityNeedle &&
            !(
              row.city.toLowerCase().includes(cityNeedle) ||
              row.citySlug.toLowerCase().includes(cityNeedle)
            )
          ) {
            return false;
          }
          return true;
        })
      : rows;

    const hasMore = matches.length > limit;
    const page = hasMore ? matches.slice(0, limit) : matches;

    // Join companies for the brand fields so the public card can render a
    // logo without a second roundtrip. N+1 is bounded by `limit` (≤100); each
    // hit is a single point lookup, well inside transaction limits.
    const enriched = await Promise.all(
      page.map(async (row) => {
        const company = await ctx.db.get(row.companyId);
        return {
          ...row,
          companyDomain: company?.domain ?? null,
          companyLogoUrl: company?.logoUrl ?? null,
        };
      }),
    );

    return {
      items: enriched,
      nextCursor:
        hasMore && page.length > 0
          ? page[page.length - 1].lastSeenAt
          : null,
    };
  },
});

// Live content + status lookup for a batch of posting IDs. The workspace
// search subscribes to this so cards swap from raw description to the LLM-
// rewritten overview the moment the rewrite lands — no manual refresh, no
// polling timer, just the standard Convex subscription. Returns one row per
// requested id (preserving the input order is left to the caller via
// jobPostingId in each row).
export const liveContentByIds = query({
  args: { ids: v.array(v.id("job_postings")) },
  returns: v.array(
    v.object({
      jobPostingId: v.id("job_postings"),
      contentStatus: v.union(
        v.literal("pending"),
        v.literal("generating"),
        v.literal("complete"),
        v.literal("failed"),
      ),
      overview: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    // Cap at 100 — the workspace search page-size ceiling is well under this.
    const ids = args.ids.slice(0, 100);
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    const out: Array<{
      jobPostingId: Id<"job_postings">;
      contentStatus: "pending" | "generating" | "complete" | "failed";
      overview: string | null;
    }> = [];
    for (const row of rows) {
      if (!row) continue;
      out.push({
        jobPostingId: row._id,
        contentStatus: row.contentStatus,
        overview: row.content?.overview ?? null,
      });
    }
    return out;
  },
});

// Total cached postings across all queries — feeds the workspace UI's
// "K total cached" line. Bounded by index walk; we cap at a count, not a
// document scan, so this stays cheap.
export const cacheStats = query({
  args: {},
  handler: async (ctx) => {
    // by_isActive_lastSeenAt indexes both true and false. Take all true.
    const active = await ctx.db
      .query("job_postings_index")
      .withIndex("by_isActive_lastSeenAt", (q) => q.eq("isActive", true))
      .take(10_000);
    return { totalActive: active.length };
  },
});

// ── Upsert from a SearchAPI response ----------------------------------------
//
// Called by convex/jobSearch.ts:search after SearchAPI returns. For each job:
//
//   1. Resolve company (find-or-create by nameNormalized).
//   2. Compute dedupKey. Look up existing posting.
//   3a. Existing → patch lastSeenAt, seenCount, merge searchQueries, fill in
//       a now-present applyLink if it was previously missing.
//   3b. New → resolve roleArchetypeSlug from cached title_canonicalizations
//       (no LLM call — best-effort), insert with contentStatus="pending",
//       mirror to job_postings_index.
//
// Returns counts the action surfaces to the client UI.
export const upsertFromSearch = internalMutation({
  args: {
    jobs: v.array(JobInputValidator),
    searchQuery: v.string(),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const trimmedQuery = args.searchQuery.trim();

    let upsertedCount = 0;
    let alreadyCachedCount = 0;
    const mappings: Array<{
      dedupKey: string;
      jobPostingId: Id<"job_postings">;
      wasNew: boolean;
      citySlug: string;
      companySlug: string;
      titleSlug: string;
      // Brandfetch fields off the joined companies row. Null for newly-inserted
      // companies until _enrichBrand finishes; the workspace re-renders from a
      // subscription so the logo lights up on the next paint either way.
      companyDomain: string | null;
      companyLogoUrl: string | null;
      companyBrandColor: string | null;
    }> = [];

    for (const job of args.jobs) {
      const companyNameRaw = (job.companyName ?? "").trim();
      if (companyNameRaw.length === 0) continue;
      const companyNameNorm = normalizeCompanyName(companyNameRaw);
      if (companyNameNorm.length === 0) continue;

      const cityFromLocation = extractCity(job.location ?? "");
      const dedupKey = await computeDedupKey({
        title: job.title,
        company: companyNameRaw,
        city: cityFromLocation,
      });

      // 1. Resolve company.
      let company = await ctx.db
        .query("companies")
        .withIndex("by_nameNormalized", (q) =>
          q.eq("nameNormalized", companyNameNorm),
        )
        .first();
      let companyId: Id<"companies">;
      let companySlug: string;
      if (company) {
        companyId = company._id;
        companySlug = company.slug;
        if (company.lastSeenAt < now - 60_000) {
          await ctx.db.patch(company._id, { lastSeenAt: now });
        }
      } else {
        companySlug = slugify(companyNameRaw);
        if (companySlug.length === 0) companySlug = "unknown";
        // Slug uniqueness: append numeric suffix on collision. Rare enough
        // we can afford a linear walk; bail after 20 attempts.
        let candidateSlug = companySlug;
        for (let n = 1; n <= 20; n++) {
          const collision = await ctx.db
            .query("companies")
            .withIndex("by_slug", (q) => q.eq("slug", candidateSlug))
            .first();
          if (!collision) break;
          candidateSlug = `${companySlug}-${n + 1}`;
        }
        companySlug = candidateSlug;
        companyId = await ctx.db.insert("companies", {
          nameRaw: companyNameRaw,
          nameNormalized: companyNameNorm,
          slug: companySlug,
          firstSeenAt: now,
          lastSeenAt: now,
        });
        company = await ctx.db.get(companyId);
        // Sub-project 4: kick off Brandfetch enrichment for new companies.
        // One-shot per company; the action gates on brandEnrichedAt to avoid
        // re-running if it ever gets re-scheduled.
        await ctx.scheduler.runAfter(0, internal.companies._enrichBrand, {
          companyId,
        });
      }

      // 2. Look up existing posting by dedupKey.
      const existing = await ctx.db
        .query("job_postings")
        .withIndex("by_dedupKey", (q) => q.eq("dedupKey", dedupKey))
        .first();

      if (existing) {
        // 3a. Patch.
        const newQueries = trimmedQuery
          ? mergeQueries(existing.searchQueries, trimmedQuery)
          : existing.searchQueries;
        const fillApplyLink =
          (existing.applyLink == null || existing.applyLink.length === 0) &&
          job.applyLink != null &&
          job.applyLink.length > 0;
        await ctx.db.patch(existing._id, {
          lastSeenAt: now,
          seenCount: existing.seenCount + 1,
          searchQueries: newQueries,
          ...(fillApplyLink ? { applyLink: job.applyLink ?? undefined } : {}),
        });
        await mirrorToIndex(ctx, existing._id);
        alreadyCachedCount += 1;
        mappings.push({
          dedupKey,
          jobPostingId: existing._id,
          wasNew: false,
          citySlug: existing.citySlug,
          companySlug,
          titleSlug: existing.titleSlug,
          companyDomain: company?.domain ?? null,
          companyLogoUrl: company?.logoUrl ?? null,
          companyBrandColor: company?.brandColor ?? null,
        });
      } else {
        // 3b. Insert.
        const titleSlug = slugify(job.title);
        const citySlug = slugify(cityFromLocation);
        const roleArchetypeSlug = await resolveArchetypeSlugFromCache(
          ctx,
          job.title,
        );
        const newId = await ctx.db.insert("job_postings", {
          dedupKey,
          companyId,
          title: job.title,
          titleSlug,
          city: cityFromLocation,
          citySlug,
          countryCode: args.countryCode,
          location: job.location ?? "",
          via: job.via ?? undefined,
          rawDescription: job.description ?? "",
          applyLink: job.applyLink ?? undefined,
          sharingLink: job.sharingLink ?? undefined,
          thumbnail: job.thumbnail ?? undefined,
          detectedExtensions:
            job.schedule || job.postedAt || job.salary || job.workFromHome
              ? {
                  schedule: job.schedule ?? undefined,
                  postedAt: job.postedAt ?? undefined,
                  salary: job.salary ?? undefined,
                  workFromHome: job.workFromHome ?? undefined,
                }
              : undefined,
          firstSeenAt: now,
          lastSeenAt: now,
          seenCount: 1,
          searchQueries: trimmedQuery ? [trimmedQuery] : [],
          isActive: true,
          contentStatus: "pending",
          roleArchetypeSlug,
        });
        await mirrorToIndex(ctx, newId);
        upsertedCount += 1;
        mappings.push({
          dedupKey,
          jobPostingId: newId,
          wasNew: true,
          citySlug,
          companySlug,
          titleSlug,
          companyDomain: company?.domain ?? null,
          companyLogoUrl: company?.logoUrl ?? null,
          companyBrandColor: company?.brandColor ?? null,
        });
        // Sub-project 2: kick off LLM rewrite. Best-effort; failure here
        // doesn't roll back the insert because the row is valid in pending
        // state and the _retryFailedContent cron will pick it up.
        await ctx.scheduler.runAfter(
          0,
          internal.jobPostingsContent._rewriteContent,
          { jobPostingId: newId, bypassAttemptCap: false },
        );
      }
    }

    return {
      upsertedCount,
      alreadyCachedCount,
      totalProcessed: args.jobs.length,
      mappings,
    };
  },
});

// ── Internals ---------------------------------------------------------------

// Merge a fresh query into an existing posting's history. Most-recent first,
// dedup, cap.
function mergeQueries(
  existing: ReadonlyArray<string>,
  fresh: string,
): string[] {
  const next = [fresh, ...existing.filter((q) => q !== fresh)];
  if (next.length > MAX_SEARCH_QUERIES) next.length = MAX_SEARCH_QUERIES;
  return next;
}

// Mirror a job_postings row into job_postings_index. Idempotent: if a mirror
// row exists, patch in place; else insert. Called from upsertFromSearch on
// every change so future readers (sitemap, listings) can hit the lightweight
// table without joining.
async function mirrorToIndex(
  ctx: { db: any },
  jobPostingId: Id<"job_postings">,
): Promise<void> {
  const posting = await ctx.db.get(jobPostingId);
  if (!posting) return;
  const company = await ctx.db.get(posting.companyId);
  if (!company) return;
  const existing = await ctx.db
    .query("job_postings_index")
    .withIndex("by_jobPostingId", (q: any) => q.eq("jobPostingId", jobPostingId))
    .first();
  const payload = {
    jobPostingId,
    dedupKey: posting.dedupKey,
    companyId: posting.companyId,
    companyName: company.nameRaw,
    companySlug: company.slug,
    title: posting.title,
    titleSlug: posting.titleSlug,
    city: posting.city,
    citySlug: posting.citySlug,
    isActive: posting.isActive,
    firstSeenAt: posting.firstSeenAt,
    lastSeenAt: posting.lastSeenAt,
    contentStatus: posting.contentStatus,
  };
  if (existing) {
    await ctx.db.patch(existing._id, payload);
  } else {
    await ctx.db.insert("job_postings_index", payload);
  }
}

// Best-effort sync archetype lookup. NEVER calls the LLM — only consults the
// title_canonicalizations cache that some other code path has already
// populated. Returns null on miss, which sub-project 5 will resolve later
// when it actually needs the archetype slug.
async function resolveArchetypeSlugFromCache(
  ctx: { db: any },
  rawTitle: string,
): Promise<string | null> {
  const prefilteredKey = expandTitleAbbreviations(rawTitle);
  if (!prefilteredKey) return null;
  const cached = await ctx.db
    .query("title_canonicalizations")
    .withIndex("by_prefiltered_key", (q: any) =>
      q.eq("prefilteredKey", prefilteredKey),
    )
    .first();
  if (!cached) return null;
  const candidateSlug = slugify(cached.canonicalTitle);
  if (candidateSlug.length === 0) return null;
  const guide = await ctx.db
    .query("career_guides")
    .withIndex("by_slug", (q: any) => q.eq("slug", candidateSlug))
    .first();
  return guide ? guide.slug : null;
}

// ── Lazy archetype resolution ──────────────────────────────────────────────
//
// The upsert path resolves roleArchetypeSlug from the title canonicalization
// cache only — no LLM call. Postings whose title is seen for the first time
// land with `roleArchetypeSlug: null`, which means the company-role research
// (interview process, compensation insights) never gets queued and the cards
// hang on "Researching…" forever.
//
// `ensureArchetypeResolved` (mutation, called from the detail page) and
// `_resolveArchetype` (the internal action it schedules) close that gap:
// canonicalize the title via the LLM, look for a matching career_guide, and
// stamp the result onto the posting. Idempotent on `roleArchetypeResolvedAt`
// — once we've made the attempt we won't repeat the LLM call.

export const ensureArchetypeResolved = mutation({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) return { scheduled: false };
    // Already resolved — slug present, or attempt already made.
    if (
      posting.roleArchetypeSlug != null ||
      posting.roleArchetypeResolvedAt != null
    ) {
      return { scheduled: false };
    }
    await ctx.scheduler.runAfter(
      0,
      internal.jobPostings._resolveArchetype,
      { jobPostingId: args.jobPostingId },
    );
    return { scheduled: true };
  },
});

// Reads the posting so the action can canonicalize without a second
// roundtrip. Internal because it returns fields no client should care about.
export const _archetypeContext = internalQuery({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      companyId: v.id("companies"),
      alreadyResolved: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) return null;
    return {
      title: posting.title,
      companyId: posting.companyId,
      alreadyResolved:
        posting.roleArchetypeSlug != null ||
        posting.roleArchetypeResolvedAt != null,
    };
  },
});

// Stamps the resolution outcome onto the posting. Always sets the timestamp;
// only sets the slug when a matching guide exists. Mirroring is handled by
// the index; the slug doesn't live there so no mirror needed.
export const _patchArchetypeResolution = internalMutation({
  args: {
    jobPostingId: v.id("job_postings"),
    roleArchetypeSlug: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) return null;
    await ctx.db.patch(args.jobPostingId, {
      roleArchetypeSlug: args.roleArchetypeSlug,
      roleArchetypeResolvedAt: Date.now(),
    });
    // If a slug landed and the posting is still active, kick the role
    // research immediately. ensureResearchQueued is idempotent and will
    // also re-queue company-level research if it's stale, but the company
    // path is already handled by the page's own ensureResearchQueued call;
    // here we just want the role overlay.
    if (args.roleArchetypeSlug && posting.isActive) {
      await ctx.scheduler.runAfter(
        0,
        internal.jobPostings._queueRoleResearch,
        { companyId: posting.companyId, roleArchetypeSlug: args.roleArchetypeSlug },
      );
    }
    return null;
  },
});

// Thin wrapper around the role-research insert path so the action above can
// stay confined to convex/jobPostings.ts and not import companyResearch
// internals directly. Idempotent — safe to schedule on every patch.
export const _queueRoleResearch = internalMutation({
  args: {
    companyId: v.id("companies"),
    roleArchetypeSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("company_role_research")
      .withIndex("by_companyId_archetype", (q) =>
        q
          .eq("companyId", args.companyId)
          .eq("roleArchetypeSlug", args.roleArchetypeSlug),
      )
      .first();
    if (existing) {
      // Already queued or completed by an earlier path; let the existing
      // staleness logic in companyResearch.ensureResearchQueued handle it
      // on the next page view.
      return null;
    }
    const roleResearchId = await ctx.db.insert("company_role_research", {
      companyId: args.companyId,
      roleArchetypeSlug: args.roleArchetypeSlug,
      status: "generating",
    });
    await ctx.scheduler.runAfter(
      0,
      internal.companyResearch._researchCompanyRole,
      { roleResearchId },
    );
    return null;
  },
});

// LLM canonicalize + guide lookup + stamp result. All three legs are wrapped
// in try/catch — on failure we still stamp `roleArchetypeResolvedAt` so we
// don't retry on every page view. The user sees "Not available" rather than
// permanent "Researching…", which is the honest UX.
export const _resolveArchetype = internalAction({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ctxRow = await ctx.runQuery(
      internal.jobPostings._archetypeContext,
      { jobPostingId: args.jobPostingId },
    );
    if (!ctxRow) return null;
    if (ctxRow.alreadyResolved) return null;

    let resolvedSlug: string | null = null;
    try {
      const canonical: { canonicalTitle: string; confidence: number } =
        await ctx.runAction(
          internal.titleCanonicalization.getOrCreateCanonical,
          { rawTitle: ctxRow.title },
        );
      const candidateSlug = slugify(canonical.canonicalTitle);
      if (candidateSlug.length > 0) {
        const guide = await ctx.runQuery(
          internal.jobPostings._lookupGuideBySlug,
          { slug: candidateSlug },
        );
        resolvedSlug = guide ? guide.slug : null;
      }
    } catch (err) {
      console.error("jobPostings._resolveArchetype:failed", {
        jobPostingId: args.jobPostingId,
        message: err instanceof Error ? err.message : String(err),
      });
      // Fall through with resolvedSlug=null so the page stops showing
      // "Researching…" and we don't retry every reload.
    }

    await ctx.runMutation(internal.jobPostings._patchArchetypeResolution, {
      jobPostingId: args.jobPostingId,
      roleArchetypeSlug: resolvedSlug,
    });
    return null;
  },
});

export const _lookupGuideBySlug = internalQuery({
  args: { slug: v.string() },
  returns: v.union(v.null(), v.object({ slug: v.string() })),
  handler: async (ctx, args) => {
    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    return guide ? { slug: guide.slug } : null;
  },
});
