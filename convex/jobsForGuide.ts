// Career-guide → jobs plug. Three exports:
//
//   - forGuide(query): the read path the JobsForGuide component subscribes
//     to. Pulls active postings by archetype slug, applies the location
//     ladder (50 km radius → country → anywhere), hydrates company name,
//     bakes in the fit tier when the viewer is signed-in with a profile
//     embedding, and returns JobResult-shaped rows that JobCardRow can
//     render directly, visual parity with /jobs/listing and
//     /workspace/jobs.
//
//   - searchLive(action): rate-limited trigger that fans out to the public
//     jobSearch.search action so signed-in users can fill thin caches. Two
//     limits via the existing rate_limits table, per (user, archetype) per
//     hour, and per user per day.
//
// Spec: docs/superpowers/specs/2026-05-06-career-guide-jobs-plug-design.md

import {
  query,
  action,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { applyLocationLadder, type LadderCandidate } from "./lib/locationLadder";
import { loadProfileAndJobVectors } from "./lib/jobFit";
import { cosineSim } from "./lib/discoverScoring";
import { tryConsumeRateLimit } from "./lib/rateLimit";

// Tunables, see "Open questions / tunables" in the spec for context.
const RADIUS_KM = 50;
const MAX_LADDER_CANDIDATES = 200;

// Cosine bands match the existing fit-rerank behaviour in jobSearch.ts so
// the same posting reads as the same tier on /jobs/listing pages and on
// the guide-page module.
const FIT_TIER_STRONG_MIN = 0.7;
const FIT_TIER_WORTH_MIN = 0.55;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PER_ARCHETYPE_PER_HOUR = 5;
const PER_USER_PER_DAY = 20;

// ── forGuide ──────────────────────────────────────────────────────────────

// JobResult-shaped, matches the projection in jobPostings.searchCache and
// the action return shape in jobSearch.search. Kept in lockstep so that
// JobCardRow renders both surfaces identically without an adapter.
const fitTierValidator = v.union(
  v.literal("strong"),
  v.literal("worth"),
  v.null(),
);

const cardValidator = v.object({
  jobPostingId: v.id("job_postings"),
  dedupKey: v.string(),
  citySlug: v.string(),
  companySlug: v.union(v.string(), v.null()),
  titleSlug: v.string(),
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
  companyDomain: v.union(v.string(), v.null()),
  companyLogoUrl: v.union(v.string(), v.null()),
  companyBrandColor: v.union(v.string(), v.null()),
  fitTier: fitTierValidator,
});

export const forGuide = query({
  args: {
    guideSlug: v.string(),
    viewer: v.object({
      lat: v.optional(v.number()),
      lon: v.optional(v.number()),
      countryCode: v.optional(v.string()),
    }),
    limit: v.number(),
  },
  returns: v.object({
    jobs: v.array(cardValidator),
    totalArchetypeMatches: v.number(),
    ladderHit: v.union(
      v.literal("radius"),
      v.literal("country"),
      v.literal("anywhere"),
    ),
  }),
  handler: async (ctx, { guideSlug, viewer, limit }) => {
    const candidates = await ctx.db
      .query("job_postings")
      .withIndex("by_roleArchetypeSlug_isActive_lastSeenAt", (q) =>
        q.eq("roleArchetypeSlug", guideSlug).eq("isActive", true),
      )
      .order("desc")
      .take(MAX_LADDER_CANDIDATES);

    if (candidates.length === 0) {
      return {
        jobs: [],
        totalArchetypeMatches: 0,
        ladderHit: "anywhere" as const,
      };
    }

    const ladderCandidates: LadderCandidate[] = candidates.map((c) => ({
      _id: c._id,
      gps: c.gps,
      countryCode: c.countryCode,
      lastSeenAt: c.lastSeenAt,
      citySlug: c.citySlug,
    }));
    const { picked, ladderHit } = applyLocationLadder(
      ladderCandidates,
      {
        lat: viewer.lat,
        lon: viewer.lon,
        countryCode: viewer.countryCode?.toLowerCase(),
      },
      limit,
      RADIUS_KM,
    );

    // Fit tiers, only for signed-in viewers with a profile embedding. Falls
    // back to fitTier=null for everyone else (anonymous, signed-out, signed
    // in without a profile, or a profile that hasn't been embedded yet).
    const identity = await ctx.auth.getUserIdentity();
    const fitTierByJobId = new Map<Id<"job_postings">, "strong" | "worth" | null>();
    if (identity) {
      const fit = await loadProfileAndJobVectors(
        ctx,
        identity.tokenIdentifier,
        picked.map((p) => p._id),
      );
      if (fit) {
        for (const { jobPostingId, vector } of fit.jobVectors) {
          let sim: number;
          try {
            sim = cosineSim(fit.profileVector, vector);
          } catch {
            continue;
          }
          fitTierByJobId.set(
            jobPostingId,
            sim >= FIT_TIER_STRONG_MIN
              ? "strong"
              : sim >= FIT_TIER_WORTH_MIN
                ? "worth"
                : null,
          );
        }
      }
    }

    const byId = new Map(candidates.map((c) => [c._id, c] as const));
    const jobs = await Promise.all(
      picked.map(async (p) => {
        const job = byId.get(p._id)!;
        return await hydrateCard(ctx, job, fitTierByJobId.get(p._id) ?? null);
      }),
    );

    return {
      jobs,
      totalArchetypeMatches: candidates.length,
      ladderHit,
    };
  },
});

async function hydrateCard(
  ctx: QueryCtx,
  job: Doc<"job_postings">,
  fitTier: "strong" | "worth" | null,
) {
  const company = await ctx.db.get(job.companyId);
  return {
    jobPostingId: job._id,
    dedupKey: job.dedupKey,
    citySlug: job.citySlug,
    companySlug: company?.slug ?? null,
    titleSlug: job.titleSlug,
    position: null as number | null,
    title: job.title,
    companyName: company?.nameRaw ?? null,
    location: job.location,
    via: job.via ?? null,
    description: job.rawDescription
      ? job.rawDescription.length > 400
        ? job.rawDescription.slice(0, 399).trimEnd() + "…"
        : job.rawDescription
      : null,
    applyLink: job.applyLink ?? null,
    sharingLink: job.sharingLink ?? null,
    thumbnail: job.thumbnail ?? null,
    schedule: job.detectedExtensions?.schedule ?? null,
    postedAt: job.detectedExtensions?.postedAt ?? null,
    salary: job.detectedExtensions?.salary ?? null,
    workFromHome: job.detectedExtensions?.workFromHome ?? null,
    companyDomain: company?.domain ?? null,
    companyLogoUrl: company?.logoUrl ?? null,
    companyBrandColor: company?.brandColor ?? null,
    fitTier,
  };
}

// ── searchLive (rate-limited action) ──────────────────────────────────────

export const _consumeSearchQuota = internalMutation({
  args: {
    userClerkId: v.string(),
    archetypeSlug: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), retryAfterMs: v.number() }),
  ),
  handler: async (ctx, { userClerkId, archetypeSlug }) => {
    const perArchetype = await tryConsumeRateLimit(ctx, {
      key: `livejobsearch:archetype:${userClerkId}:${archetypeSlug}`,
      max: PER_ARCHETYPE_PER_HOUR,
      windowMs: HOUR_MS,
    });
    if (!perArchetype.ok) {
      return { ok: false as const, retryAfterMs: perArchetype.retryAfterMs };
    }

    const perUser = await tryConsumeRateLimit(ctx, {
      key: `livejobsearch:user:${userClerkId}`,
      max: PER_USER_PER_DAY,
      windowMs: DAY_MS,
    });
    if (!perUser.ok) {
      return { ok: false as const, retryAfterMs: perUser.retryAfterMs };
    }

    return { ok: true as const };
  },
});

export const searchLive = action({
  args: {
    guideSlug: v.string(),
    // Free-text location passed through to jobSearch.search; the search
    // action extracts citySlug + applies its own normalisation. Pass the
    // signed-in user's profile city (preferred), else IP-derived city,
    // else undefined (search "anywhere").
    location: v.optional(v.string()),
    // Two-letter country code passed as the SearchAPI `gl` param.
    gl: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { guideSlug, location, gl }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("auth required");

    const quota = await ctx.runMutation(
      internal.jobsForGuide._consumeSearchQuota,
      {
        userClerkId: identity.subject,
        archetypeSlug: guideSlug,
      },
    );
    if (!quota.ok) {
      throw new ConvexError({
        kind: "quota_exceeded",
        retryAfterMs: quota.retryAfterMs,
      });
    }

    await ctx.runAction(api.jobSearch.search, {
      query: guideSlug.replace(/-/g, " "),
      location,
      gl,
      skipCorrection: true,
    });

    return { ok: true };
  },
});
