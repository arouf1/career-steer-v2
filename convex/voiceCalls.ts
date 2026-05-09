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
import { paginationOptsValidator } from "convex/server";
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

// ── Trimmed list-row shape ─────────────────────────────────────────────────
//
// Shared between listForUser (returns) and _hydrateForList (returns) so the
// mapping logic lives in exactly one place. No transcript, no embedding bytes
// are included — only what the history page needs to render a card.

const callListRowValidator = v.object({
  _id: v.id("voice_calls"),
  surface: v.optional(
    v.union(
      v.literal("guide"),
      v.literal("compass"),
      v.literal("job"),
      v.literal("interview_job"),
    ),
  ),
  guideId: v.optional(v.id("career_guides")),
  jobPostingId: v.optional(v.id("job_postings")),
  canvasSnapshotId: v.optional(v.id("discover_canvases")),
  title: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("completed"),
    v.literal("interrupted"),
    v.literal("error"),
  ),
  totalDurationSeconds: v.number(),
  messagesCount: v.number(),
  aiSummary: v.optional(v.any()),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  // Joined company info — present only on rows whose jobPostingId resolved to
  // a company. Optional so existing consumers (and rows without a posting)
  // remain compatible.
  companyName: v.optional(v.string()),
  companyLogoUrl: v.optional(v.string()),
});

type CallCompanyInfo = { name?: string; logoUrl?: string };

type CallListRow = {
  _id: Id<"voice_calls">;
  surface?: "guide" | "compass" | "job" | "interview_job";
  guideId?: Id<"career_guides">;
  jobPostingId?: Id<"job_postings">;
  canvasSnapshotId?: Id<"discover_canvases">;
  title: string;
  status: "active" | "completed" | "interrupted" | "error";
  totalDurationSeconds: number;
  messagesCount: number;
  aiSummary?: unknown;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
  companyName?: string;
  companyLogoUrl?: string;
};

function trimToListRow(
  row: Doc<"voice_calls">,
  company?: CallCompanyInfo,
): CallListRow {
  return {
    _id: row._id,
    surface: row.surface,
    guideId: row.guideId,
    jobPostingId: row.jobPostingId,
    canvasSnapshotId: row.canvasSnapshotId,
    title: row.title,
    status: row.status,
    totalDurationSeconds: row.totalDurationSeconds,
    messagesCount: row.messages.length,
    aiSummary: row.aiSummary,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    companyName: company?.name,
    companyLogoUrl: company?.logoUrl,
  };
}

// Resolve { jobPostingId → { companyName, companyLogoUrl } } in two batched
// fetches: postings → companyIds → companies. Bounded at 50 rows per call
// (page size 20, plus search over-fetch headroom). Returns an empty Map when
// no rows have a jobPostingId, skipping the round-trips entirely.
async function buildCompanyMapForRows(
  ctx: QueryCtx,
  rows: ReadonlyArray<Doc<"voice_calls">>,
): Promise<Map<Id<"job_postings">, CallCompanyInfo>> {
  const postingIds = Array.from(
    new Set(
      rows
        .map((r) => r.jobPostingId)
        .filter((id): id is Id<"job_postings"> => id !== undefined),
    ),
  ).slice(0, 50);

  if (postingIds.length === 0) {
    return new Map();
  }

  const postings = await Promise.all(postingIds.map((id) => ctx.db.get(id)));

  const companyIdByPosting = new Map<Id<"job_postings">, Id<"companies">>();
  const uniqueCompanyIds = new Set<Id<"companies">>();
  for (const p of postings) {
    if (!p) continue;
    companyIdByPosting.set(p._id, p.companyId);
    uniqueCompanyIds.add(p.companyId);
  }

  const companyIds = Array.from(uniqueCompanyIds);
  const companies = await Promise.all(companyIds.map((id) => ctx.db.get(id)));
  const companyById = new Map<Id<"companies">, Doc<"companies">>();
  for (const c of companies) {
    if (c) companyById.set(c._id, c);
  }

  const result = new Map<Id<"job_postings">, CallCompanyInfo>();
  for (const [postingId, companyId] of companyIdByPosting) {
    const company = companyById.get(companyId);
    if (!company) continue;
    result.set(postingId, {
      name: company.nameRaw,
      // Coerce the schema-level v.union(string, null) down to undefined so
      // the optional-field validator on the row payload is satisfied.
      logoUrl: company.logoUrl ?? undefined,
    });
  }
  return result;
}

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

// ── Public mutation: mark a rubric dimension as covered ──────────────────
//
// Called from the client hook in response to a Gemini Live toolCall for
// markDimensionCovered. Idempotent on dimension — replaces any prior mark
// for the same dimension with the new one (last write wins).

export const markDimensionCovered = mutation({
  args: {
    sessionId: v.string(),
    dimension: v.string(),
    evidence: v.string(),
    confidence: v.union(
      v.literal("weak"),
      v.literal("solid"),
      v.literal("strong"),
    ),
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

    const existing = row.coverage ?? [];
    const filtered = existing.filter((c) => c.dimension !== args.dimension);
    const next = [
      ...filtered,
      {
        dimension: args.dimension,
        evidence: args.evidence,
        confidence: args.confidence,
        markedAt: Date.now(),
      },
    ];

    await ctx.db.patch(row._id, {
      coverage: next,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

// ── Public query: subscribe to coverage marks for the gauge ──────────────

export const getCoverage = query({
  args: { sessionId: v.string() },
  returns: v.union(
    v.null(),
    v.array(v.object({
      dimension: v.string(),
      evidence: v.string(),
      confidence: v.union(
        v.literal("weak"),
        v.literal("solid"),
        v.literal("strong"),
      ),
      markedAt: v.number(),
    })),
  ),
  handler: async (ctx, args) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return null;
    const row = await ctx.db
      .query("voice_calls")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!row || row.userId !== user._id) return null;
    return row.coverage ?? [];
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
      // Surface-aware dispatch. Interview rows need a different rubric
      // (verbatim-quote enforcement, calibrated against the bundle); other
      // surfaces continue to use the deep-dive summary pipeline.
      if (row.surface === "interview_job") {
        if (row.messages.length >= 4) {
          await ctx.scheduler.runAfter(
            0,
            internal.interviewSimNode.processInterviewAnalysis,
            { callId: row._id },
          );
        }
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.voiceCallsNode.processCallAnalysis,
          { callId: row._id },
        );
      }
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

// ── Public query: subscribe to a single call (auth-gated to owner) ────────
//
// For interview_job + job surfaces (the surfaces that carry a jobPostingId),
// resolve posting → company in two extra ctx.db.get reads and bundle
// companyName + companyLogoUrl onto the returned row so the detail-page
// masthead can render the company anchor without a second roundtrip. The
// return validator stays v.any() so the wire shape is unchanged.

export const getCallById = query({
  args: { callId: v.id("voice_calls") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return null;
    const row = await ctx.db.get(args.callId);
    if (!row || row.userId !== user._id) return null;

    // Skip the join when there's no posting to resolve (guide / compass).
    if (!row.jobPostingId) return row;

    const posting = await ctx.db.get(row.jobPostingId);
    if (!posting) return row;

    const company = await ctx.db.get(posting.companyId);
    if (!company) return row;

    return {
      ...row,
      companyName: company.nameRaw,
      companyLogoUrl: company.logoUrl ?? undefined,
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

// ── Public query: paginated list of calls for the current user ───────────
//
// Powers the /workspace/calls history page. Surface filter applied
// in-memory on the materialised page (cheap at small N); archive filter is a
// true index range via by_user_archived_created. Trimmed shape returned per
// row — no transcript or embedding bytes shipped to the client list.

export const listForUser = query({
  args: {
    surfaces: v.optional(
      v.array(
        v.union(
          v.literal("guide"),
          v.literal("compass"),
          v.literal("job"),
          v.literal("interview_job"),
        ),
      ),
    ),
    includeArchived: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(callListRowValidator),
    isDone: v.boolean(),
    // PaginationResult.continueCursor is always string (never null) — the
    // empty string "" signals "no more pages" in the Convex pagination protocol.
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const includeArchived = args.includeArchived ?? false;

    // Two-arm query: includeArchived means "archived view" (any archivedAt);
    // !includeArchived means "active only" (archivedAt undefined). Both arms
    // hit by_user_archived_created. Active arm uses the eq(undefined) bound to
    // pull only rows where archivedAt is absent.
    const builder = ctx.db
      .query("voice_calls")
      .withIndex("by_user_archived_created", (q) =>
        includeArchived
          ? q.eq("userId", user._id)
          : q.eq("userId", user._id).eq("archivedAt", undefined),
      )
      .order("desc");

    const result = await builder.paginate(args.paginationOpts);

    // In-memory surface filter on the materialised page (cheap at <500 rows;
    // if volume grows add a by_user_surface_created composite index). For the
    // archived view, also drop active rows here since the index arm only
    // constrains on userId when includeArchived is true.
    const surfacesSet =
      args.surfaces && args.surfaces.length > 0
        ? new Set(args.surfaces)
        : null;

    const filteredRows = result.page.filter((row) => {
      if (includeArchived && row.archivedAt === undefined) return false;
      if (
        surfacesSet &&
        (!row.surface ||
          !surfacesSet.has(
            row.surface as "guide" | "compass" | "job" | "interview_job",
          ))
      )
        return false;
      return true;
    });

    // Resolve company info for the filtered rows in two batched fetches.
    const companyByPosting = await buildCompanyMapForRows(ctx, filteredRows);

    const filtered = filteredRows.map((row) =>
      trimToListRow(
        row,
        row.jobPostingId ? companyByPosting.get(row.jobPostingId) : undefined,
      ),
    );

    return {
      page: filtered,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// ── Public mutations: soft delete (archive) + restore ────────────────────

export const archive = mutation({
  args: { callId: v.id("voice_calls") },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { ok: false };
    const row = await ctx.db.get(args.callId);
    if (!row || row.userId !== user._id) return { ok: false };
    if (row.archivedAt !== undefined) return { ok: true }; // idempotent
    await ctx.db.patch(args.callId, {
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const unarchive = mutation({
  args: { callId: v.id("voice_calls") },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { ok: false };
    const row = await ctx.db.get(args.callId);
    if (!row || row.userId !== user._id) return { ok: false };
    if (row.archivedAt === undefined) return { ok: true }; // idempotent
    await ctx.db.patch(args.callId, {
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

// ── Internal query: project a set of call ids to the list-row shape ──────
//
// Used by voiceCallsSearch.searchByText to convert vector-search hits into
// list rows. Auth is the caller's responsibility (the action already resolved
// the user before handing ids here).

export const _hydrateForList = internalQuery({
  args: { ids: v.array(v.id("voice_calls")) },
  returns: v.array(callListRowValidator),
  handler: async (ctx, args) => {
    const rows = (await Promise.all(args.ids.map((id) => ctx.db.get(id))))
      .filter((r): r is Doc<"voice_calls"> => r !== null);
    const companyByPosting = await buildCompanyMapForRows(ctx, rows);
    return rows.map((r) =>
      trimToListRow(
        r,
        r.jobPostingId ? companyByPosting.get(r.jobPostingId) : undefined,
      ),
    );
  },
});

// ── Internal helper: resolve userId from tokenIdentifier ─────────────────
//
// Actions cannot call resolveAuthedUser (which is typed for QueryCtx /
// MutationCtx only). They resolve the identity themselves via ctx.auth, then
// call this query to get the Convex userId in one round trip.

export const _userByTokenIdentifier = internalQuery({
  args: { tokenIdentifier: v.string() },
  returns: v.union(v.null(), v.object({ _id: v.id("users") })),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    return user ? { _id: user._id } : null;
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
