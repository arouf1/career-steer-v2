// Career-guide → jobs plug. Three exports:
//
//   - forGuide(query): the read path the JobsForGuide component subscribes
//     to. Pulls active postings by archetype slug, applies the location
//     ladder (50 km radius → country → anywhere), hydrates company name,
//     returns a viewer-state-agnostic card list plus a ladderHit tag the UI
//     uses for honest microcopy.
//
//   - fitScores(query): signed-in-only side query that resolves a tier
//     (strong / worth / null) per jobPostingId via the user's profile
//     embedding + each posting's embedding.
//
//   - searchLive(action): rate-limited trigger that fans out to the public
//     jobSearch.search action so signed-in users can fill thin caches. Two
//     limits via the existing rate_limits table — per (user, archetype) per
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

// Tunables — see "Open questions / tunables" in the spec for context. All
// are safe to adjust without code refactors elsewhere.
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

const cardValidator = v.object({
  jobPostingId: v.id("job_postings"),
  title: v.string(),
  titleSlug: v.string(),
  companyName: v.string(),
  companySlug: v.string(),
  city: v.string(),
  citySlug: v.string(),
  countryCode: v.optional(v.string()),
  postedAt: v.number(),
  salaryDisplay: v.optional(v.string()),
  archetypeSlug: v.string(),
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
    // Hot path: archetype + active filter via the new compound index.
    // Bounded at MAX_LADDER_CANDIDATES so the in-memory Haversine sort can't
    // explode for very popular roles.
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

    const byId = new Map(candidates.map((c) => [c._id, c] as const));
    const jobs = await Promise.all(
      picked.map(async (p) => {
        const job = byId.get(p._id)!;
        return await hydrateCard(ctx, job);
      }),
    );

    return {
      jobs,
      totalArchetypeMatches: candidates.length,
      ladderHit,
    };
  },
});

async function hydrateCard(ctx: QueryCtx, job: Doc<"job_postings">) {
  const company = await ctx.db.get(job.companyId);
  return {
    jobPostingId: job._id,
    title: job.title,
    titleSlug: job.titleSlug,
    companyName: company?.nameRaw ?? "Unknown",
    companySlug: company?.slug ?? "unknown",
    city: job.city,
    citySlug: job.citySlug,
    countryCode: job.countryCode,
    postedAt: job.lastSeenAt,
    salaryDisplay: job.detectedExtensions?.salary ?? undefined,
    archetypeSlug: job.roleArchetypeSlug ?? "",
  };
}

// ── fitScores ─────────────────────────────────────────────────────────────

const tierResultValidator = v.union(
  v.null(),
  v.array(
    v.object({
      jobPostingId: v.id("job_postings"),
      tier: v.union(
        v.literal("strong"),
        v.literal("worth"),
        v.null(),
      ),
    }),
  ),
);

export const fitScores = query({
  args: { jobIds: v.array(v.id("job_postings")) },
  returns: tierResultValidator,
  handler: async (ctx, { jobIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const data = await loadProfileAndJobVectors(
      ctx,
      identity.tokenIdentifier,
      jobIds,
    );
    if (!data) return null;

    const tierByJobId = new Map<Id<"job_postings">, "strong" | "worth" | null>();
    for (const { jobPostingId, vector } of data.jobVectors) {
      let sim: number;
      try {
        sim = cosineSim(data.profileVector, vector);
      } catch {
        // Dimension mismatch during a model migration — drop fit silently.
        continue;
      }
      tierByJobId.set(
        jobPostingId,
        sim >= FIT_TIER_STRONG_MIN
          ? "strong"
          : sim >= FIT_TIER_WORTH_MIN
            ? "worth"
            : null,
      );
    }

    return jobIds.map((id) => ({
      jobPostingId: id,
      tier: tierByJobId.get(id) ?? null,
    }));
  },
});

// ── searchLive (rate-limited action) ──────────────────────────────────────

// Internal mutation that consumes both rate-limit windows. Two consume
// calls because we want the per-archetype counter to bite first (tighter
// constraint), then the per-user-per-day cap.
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
    // user's profile.location string (or undefined to search "anywhere").
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

    // Hand off to the existing public search action. The query string is the
    // de-slugged archetype label — search action handles its own typo
    // correction, cache lookup, and SearchAPI fan-out.
    await ctx.runAction(api.jobSearch.search, {
      query: guideSlug.replace(/-/g, " "),
      location,
      gl,
      // Skip correction — slug-derived queries are already canonical.
      skipCorrection: true,
    });

    return { ok: true };
  },
});
