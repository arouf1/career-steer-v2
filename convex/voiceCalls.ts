/**
 * Realtime AI voice "deep dive" — non-Node Convex surface.
 *
 * Live audio runs browser↔Gemini Live (WebSocket); this file persists the
 * transcript and surfaces session metadata. Token minting and post-call
 * analysis live in voiceCallsNode.ts because they require Node runtime
 * (@google/genai SDK, OpenRouter via lib/ai/providers, embeddings).
 */

import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

// Each voice call message has these fields. Match the schema validator in
// schema.ts so this stays the single source of truth from the client side.
const messageValidator = v.object({
  id: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  timestamp: v.number(),
  transcriptConfidence: v.optional(v.number()),
  groundingCitations: v.optional(
    v.array(v.object({
      url: v.string(),
      title: v.optional(v.string()),
    })),
  ),
});

// ── Auth helper (mirrors peopleOutreach.ts / careerGuidePersonalizations.ts) ─

const resolveAuthedUser = async (
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
};

// ── Internal: row creator (called from the Node action after token mint) ──

export const _createSession = internalMutation({
  args: {
    userId: v.id("users"),
    guideId: v.id("career_guides"),
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
      surface: "guide",
      guideId: args.guideId,
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

// ── Public mutation: append a transcript message during the live call ─────

export const appendMessage = mutation({
  args: {
    sessionId: v.string(),
    message: messageValidator,
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({
      ok: v.literal(false),
      reason: v.union(
        v.literal("anonymous"),
        v.literal("not-found"),
        v.literal("not-active"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { ok: false as const, reason: "anonymous" as const };

    const row = await ctx.db
      .query("voice_calls")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!row || row.userId !== user._id) {
      return { ok: false as const, reason: "not-found" as const };
    }
    if (row.status !== "active") {
      return { ok: false as const, reason: "not-active" as const };
    }

    // Idempotent on the client-supplied message id — debounce/retry on the
    // browser side will sometimes resend the same message. Cheaper to dedupe
    // here than to push that complexity into the hook.
    if (row.messages.some((m) => m.id === args.message.id)) {
      return { ok: true as const };
    }

    await ctx.db.patch(row._id, {
      messages: [...row.messages, args.message],
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

// ── Public mutation: finalize a call and schedule post-call analysis ──────

export const finalize = mutation({
  args: {
    sessionId: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("interrupted"),
      v.literal("error"),
    ),
    totalDurationSeconds: v.number(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), callId: v.id("voice_calls") }),
    v.object({
      ok: v.literal(false),
      reason: v.union(
        v.literal("anonymous"),
        v.literal("not-found"),
        v.literal("already-final"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { ok: false as const, reason: "anonymous" as const };

    const row = await ctx.db
      .query("voice_calls")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!row || row.userId !== user._id) {
      return { ok: false as const, reason: "not-found" as const };
    }
    if (row.status !== "active") {
      return { ok: false as const, reason: "already-final" as const };
    }

    await ctx.db.patch(row._id, {
      status: args.status,
      totalDurationSeconds: Math.max(0, Math.round(args.totalDurationSeconds)),
      updatedAt: Date.now(),
    });

    // Only run the analysis pipeline on a successful "completed" status with
    // at least one round-trip — silent / errored / 0-message calls aren't
    // worth the OpenRouter spend, and the AI summary would be junk anyway.
    if (args.status === "completed" && row.messages.length >= 2) {
      await ctx.scheduler.runAfter(
        0,
        internal.voiceCallsNode.processCallAnalysis,
        { callId: row._id },
      );
    }

    return { ok: true as const, callId: row._id };
  },
});

// ── Public query: active session for the current user (resilience) ────────

export const getActiveSessionForUser = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      callId: v.id("voice_calls"),
      sessionId: v.string(),
      // Resolved discriminator: "guide" for legacy rows that pre-date the
      // discriminator landing, "compass" for ambient calls, "job" for
      // per-posting calls, "interview_job" for interview-simulation calls.
      surface: v.union(
        v.literal("guide"),
        v.literal("compass"),
        v.literal("job"),
        v.literal("interview_job"),
      ),
      guideId: v.optional(v.id("career_guides")),
      canvasSnapshotId: v.optional(v.id("discover_canvases")),
      jobPostingId: v.optional(v.id("job_postings")),
      title: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return null;

    // by_user_created (reverse) gets us the latest row in O(log n). We then
    // confirm status == active rather than indexing on a composite of
    // [userId, status, createdAt] — keeps index list small for a low-volume
    // table.
    const latest = await ctx.db
      .query("voice_calls")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    if (!latest || latest.status !== "active") return null;

    return {
      callId: latest._id,
      sessionId: latest.sessionId,
      surface: latest.surface ?? "guide",
      guideId: latest.guideId,
      canvasSnapshotId: latest.canvasSnapshotId,
      jobPostingId: latest.jobPostingId,
      title: latest.title,
      createdAt: latest.createdAt,
    };
  },
});

// ── Internal queries called from the Node action ─────────────────────────

export const _getCallById = internalQuery({
  args: { callId: v.id("voice_calls") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("voice_calls"),
      userId: v.id("users"),
      // surface defaults to "guide" for legacy rows so the analysis pipeline
      // can branch on it without an extra null-check.
      surface: v.union(
        v.literal("guide"),
        v.literal("compass"),
        v.literal("job"),
        v.literal("interview_job"),
      ),
      guideId: v.optional(v.id("career_guides")),
      canvasSnapshotId: v.optional(v.id("discover_canvases")),
      jobPostingId: v.optional(v.id("job_postings")),
      title: v.string(),
      status: v.union(
        v.literal("active"),
        v.literal("completed"),
        v.literal("interrupted"),
        v.literal("error"),
      ),
      messages: v.array(messageValidator),
      totalDurationSeconds: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.callId);
    if (!row) return null;
    return {
      _id: row._id,
      userId: row.userId,
      surface: row.surface ?? "guide",
      guideId: row.guideId,
      canvasSnapshotId: row.canvasSnapshotId,
      jobPostingId: row.jobPostingId,
      title: row.title,
      status: row.status,
      messages: row.messages,
      totalDurationSeconds: row.totalDurationSeconds,
    };
  },
});

/**
 * Single round-trip context loader for voiceCallsNode.mintSession.
 *
 * Lives here (not voiceCallsNode.ts) because internalQuery cannot be defined
 * in a "use node" file. Read-only — the action follows up with
 * _createSession to actually persist the new row.
 */
export const _gatherSessionContext = internalQuery({
  args: {
    guideId: v.id("career_guides"),
    tokenIdentifier: v.string(),
  },
  // v.any() shapes here because the action consumes Doc types directly and
  // duplicating every nested validator across modules adds noise without
  // catching real bugs (the action is the only consumer).
  returns: v.union(
    v.null(),
    v.object({
      user: v.any(),
      guide: v.any(),
      profile: v.any(),
      enrichment: v.any(),
      branches: v.any(),
      personalization: v.any(),
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

    const guide = await ctx.db.get(args.guideId);
    if (!guide) {
      return {
        user,
        guide: null,
        profile: null,
        enrichment: null,
        branches: [],
        personalization: null,
      };
    }

    // Latest profile row for this user — covers the resume-replacement case.
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

    // by_guide_status_created lets us bound the branch fan-out to completed
    // rows only — flagged/in-flight branches don't carry usable citations
    // for the prompt.
    const branches = await ctx.db
      .query("career_guide_branches")
      .withIndex("by_guide_status_created", (q) =>
        q.eq("guideId", args.guideId).eq("status", "complete"),
      )
      .collect();

    const personalization = await ctx.db
      .query("career_guide_personalizations")
      .withIndex("by_user_and_guide", (q) =>
        q.eq("userId", user._id).eq("guideId", args.guideId),
      )
      .unique();

    return { user, guide, profile, enrichment, branches, personalization };
  },
});

export const _patchAnalysis = internalMutation({
  args: {
    callId: v.id("voice_calls"),
    aiSummary: v.any(),
    conversationEmbedding: v.array(v.float64()),
    summaryEmbedding: v.array(v.float64()),
    keyTopicsEmbedding: v.array(v.float64()),
    title: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      aiSummary: args.aiSummary,
      conversationEmbedding: args.conversationEmbedding,
      summaryEmbedding: args.summaryEmbedding,
      keyTopicsEmbedding: args.keyTopicsEmbedding,
      updatedAt: Date.now(),
    };
    if (args.title) patch.title = args.title;
    await ctx.db.patch(args.callId, patch);
    return null;
  },
});
