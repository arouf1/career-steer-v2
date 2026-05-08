/**
 * Interview-simulation V8 surface (per-job-posting mock interview).
 *
 * Parallel to convex/jobVoice.ts (per-job deep-dive). Owns:
 *   - prep-status doc creation + patching (subscribed to by the dialog)
 *   - voice_calls row creation with surface: "interview_job"
 *   - context-load internal query for the Node mint action
 *
 * Reuses existing voiceCalls.appendMessage + voiceCalls.finalize — those
 * are surface-agnostic (lookup by sessionId). voiceCalls.finalize is
 * extended in this PR to dispatch interview rows to
 * interviewSimNode.processInterviewAnalysis.
 */

import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

// ── Prep status: write side (internal) ────────────────────────────────────

export const _createPrepStatus = internalMutation({
  args: {
    prepSessionId: v.string(),
    userId: v.id("users"),
    jobPostingId: v.id("job_postings"),
    detail: v.optional(v.string()),
  },
  returns: v.id("interview_prep_status"),
  handler: async (ctx, args) => {
    // Idempotent on prepSessionId. Two callers with the same id (StrictMode
    // double-fire, network retry, user double-click) get the same row
    // instead of two rows that would later trip subscribeToPrep's .unique().
    const existing = await ctx.db
      .query("interview_prep_status")
      .withIndex("by_prepSessionId", (q) =>
        q.eq("prepSessionId", args.prepSessionId),
      )
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    return await ctx.db.insert("interview_prep_status", {
      prepSessionId: args.prepSessionId,
      userId: args.userId,
      jobPostingId: args.jobPostingId,
      status: "researching",
      detail: args.detail,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const _patchPrepStatus = internalMutation({
  args: {
    prepSessionId: v.string(),
    status: v.union(
      v.literal("researching"),
      v.literal("synthesizing"),
      v.literal("minting_token"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    detail: v.optional(v.string()),
    voiceCallId: v.optional(v.id("voice_calls")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("interview_prep_status")
      .withIndex("by_prepSessionId", (q) =>
        q.eq("prepSessionId", args.prepSessionId),
      )
      .first();
    if (!row) return null;
    await ctx.db.patch(row._id, {
      status: args.status,
      ...(args.detail !== undefined ? { detail: args.detail } : {}),
      ...(args.voiceCallId !== undefined ? { voiceCallId: args.voiceCallId } : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ── Prep status: read side (public, subscribed to by the dialog) ──────────

export const subscribeToPrep = query({
  args: { prepSessionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(
        v.literal("researching"),
        v.literal("synthesizing"),
        v.literal("minting_token"),
        v.literal("ready"),
        v.literal("failed"),
      ),
      detail: v.optional(v.string()),
      voiceCallId: v.optional(v.id("voice_calls")),
      error: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("interview_prep_status")
      .withIndex("by_prepSessionId", (q) =>
        q.eq("prepSessionId", args.prepSessionId),
      )
      .first();
    if (!row) return null;

    // Auth: only the user who started the prep can subscribe.
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user || user._id !== row.userId) return null;

    return {
      status: row.status,
      detail: row.detail,
      voiceCallId: row.voiceCallId,
      error: row.error,
    };
  },
});

// ── Row creator (called from the Node mint action) ────────────────────────

export const _createInterviewSession = internalMutation({
  args: {
    userId: v.id("users"),
    jobPostingId: v.id("job_postings"),
    sessionId: v.string(),
    title: v.string(),
    voiceId: v.string(),
    model: v.string(),
    authMode: v.union(v.literal("ephemeral"), v.literal("apiKey")),
  },
  returns: v.id("voice_calls"),
  handler: async (ctx, args): Promise<Id<"voice_calls">> => {
    const now = Date.now();
    return await ctx.db.insert("voice_calls", {
      userId: args.userId,
      surface: "interview_job",
      jobPostingId: args.jobPostingId,
      sessionId: args.sessionId,
      title: args.title,
      voiceProvider: "gemini",
      voiceId: args.voiceId,
      model: args.model,
      authMode: args.authMode,
      status: "active",
      messages: [],
      totalDurationSeconds: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ── Persistence helpers for the synthesis action ─────────────────────────

export const _patchCompanyResearchNews = internalMutation({
  args: {
    companyId: v.id("companies"),
    bullets: v.array(v.object({
      headline: v.string(),
      summary: v.string(),
      sourceUrl: v.string(),
      publisher: v.optional(v.string()),
      publishedAt: v.optional(v.number()),
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("company_research")
      .withIndex("by_companyId", (q) => q.eq("companyId", args.companyId))
      .unique();
    const now = Date.now();
    if (!row) {
      await ctx.db.insert("company_research", {
        companyId: args.companyId,
        status: "complete",
        recentNews: { bullets: args.bullets, fetchedAt: now },
      });
      return null;
    }
    await ctx.db.patch(row._id, {
      recentNews: { bullets: args.bullets, fetchedAt: now },
    });
    return null;
  },
});

export const _patchInterviewBundle = internalMutation({
  args: {
    companyId: v.id("companies"),
    roleArchetypeSlug: v.string(),
    interviewProse: v.string(),
    interviewBundle: v.any(),  // shape validated by InterviewSynthesisSchema in the action
    citations: v.optional(v.any()),
    costCents: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("company_role_research")
      .withIndex("by_companyId_archetype", (q) =>
        q.eq("companyId", args.companyId).eq("roleArchetypeSlug", args.roleArchetypeSlug),
      )
      .unique();
    const now = Date.now();
    if (!row) {
      await ctx.db.insert("company_role_research", {
        companyId: args.companyId,
        roleArchetypeSlug: args.roleArchetypeSlug,
        status: "complete",
        attempts: 1,
        lastResearchedAt: now,
        costCents: args.costCents,
        interview: args.interviewProse,
        interviewBundle: { ...args.interviewBundle, generatedAt: now },
        citations: args.citations,
      });
      return null;
    }
    await ctx.db.patch(row._id, {
      status: "complete",
      lastResearchedAt: now,
      costCents: (row.costCents ?? 0) + (args.costCents ?? 0),
      interview: args.interviewProse,
      interviewBundle: { ...args.interviewBundle, generatedAt: now },
      ...(args.citations ? { citations: { ...row.citations, ...args.citations } } : {}),
    });
    return null;
  },
});

// ── Context loader for mintInterviewSession ───────────────────────────────

export const _gatherInterviewContext = internalQuery({
  args: {
    jobPostingId: v.id("job_postings"),
    tokenIdentifier: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      user: v.any(),
      profile: v.any(),
      enrichment: v.any(),
      posting: v.any(),
      company: v.any(),
      companyResearch: v.any(),
      companyRoleResearch: v.any(),
      cacheKeySlug: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx, args.tokenIdentifier);
    if (!user) return null;

    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) {
      return {
        user, profile: null, enrichment: null, posting: null, company: null,
        companyResearch: null, companyRoleResearch: null, cacheKeySlug: "",
      };
    }

    const company = await ctx.db.get(posting.companyId);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    const enrichment = profile
      ? await ctx.db
          .query("profile_enrichments")
          .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
          .first()
      : null;

    const companyResearch = await ctx.db
      .query("company_research")
      .withIndex("by_companyId", (q) => q.eq("companyId", posting.companyId))
      .unique();

    // Cache key — use roleArchetypeSlug when present; otherwise synthesize a
    // stable slug from companyId + normalized title so postings sharing a
    // title at the same company share the bundle.
    const cacheKeySlug =
      posting.roleArchetypeSlug ??
      `untyped-${normalizeForSlug(posting.title)}`;

    const companyRoleResearch = await ctx.db
      .query("company_role_research")
      .withIndex("by_companyId_archetype", (q) =>
        q.eq("companyId", posting.companyId).eq("roleArchetypeSlug", cacheKeySlug),
      )
      .unique();

    return {
      user,
      profile,
      enrichment,
      posting,
      company,
      companyResearch,
      companyRoleResearch,
      cacheKeySlug,
    };
  },
});

// ── Context loader for processInterviewAnalysis ───────────────────────────

// Bundled query for processInterviewAnalysis — single round-trip.
export const _getPostingWithCompanyAndBundle = internalQuery({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.union(
    v.null(),
    v.object({
      postingTitle: v.string(),
      city: v.optional(v.string()),
      companyName: v.string(),
      bundle: v.union(v.null(), v.any()),
      candidate: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) return null;
    const company = await ctx.db.get(posting.companyId);
    if (!company) return null;

    const slug = posting.roleArchetypeSlug ?? `untyped-${normalizeForSlug(posting.title)}`;
    const role = await ctx.db
      .query("company_role_research")
      .withIndex("by_companyId_archetype", (q) =>
        q.eq("companyId", posting.companyId).eq("roleArchetypeSlug", slug),
      )
      .unique();

    return {
      postingTitle: posting.title,
      city: posting.city,
      companyName: company.nameRaw,
      bundle: role?.interviewBundle ?? null,
      candidate: { firstName: "Candidate" }, // fuller candidate brief loaded
                                             // from the call's userId in a
                                             // future iteration; rubric prompt
                                             // tolerates a thin candidate.
    };
  },
});

// ── Rubric persistence (post-call, no embeddings required) ───────────────

export const _patchInterviewRubric = internalMutation({
  args: {
    callId: v.id("voice_calls"),
    aiSummary: v.any(), // InterviewRubric — shape validated by action
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.callId, {
      aiSummary: args.aiSummary,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ── Per-day rate limit counter ────────────────────────────────────────────

export const _countRecentInterviews = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("voice_calls")
      .withIndex("by_user_created", (q) =>
        q.eq("userId", args.userId).gte("createdAt", args.since),
      )
      .collect();
    return rows.filter((r) => r.surface === "interview_job").length;
  },
});

// ── helpers ───────────────────────────────────────────────────────────────

async function resolveUser(
  ctx: QueryCtx,
  tokenIdentifier: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
}

function normalizeForSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
