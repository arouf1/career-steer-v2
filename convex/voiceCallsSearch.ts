/**
 * Hybrid search over voice_calls for the /workspace/conversations history page.
 *
 * Two passes, literal-first:
 *
 *   1. Literal substring match against title + companyName via
 *      _literalSearchForUser. Cheap, instant, deterministic. Catches short
 *      proper-noun queries ("OpenAI", "Stripe") that semantic similarity
 *      handles poorly, AND surfaces rows whose summaryEmbedding hasn't been
 *      backfilled (which would otherwise be invisible to vector search).
 *      Literal hits get searchScore = 1.0.
 *
 *   2. Semantic vector search against by_summaryVector. Only runs when the
 *      literal pass leaves slots unfilled, saves an embed call when the
 *      common case (a company/role keyword) saturates results from the
 *      cheap pass.
 *
 * Vector pass detail: VectorFilterBuilder only exposes `eq` and `or` (no
 * `and`), so we filter by userId in the index and apply archivedAt / surface
 * post-hoc after hydration. Over-fetch by 4x (capped at 256) to absorb the
 * post-filter drop-off.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { embed } from "../lib/ai/providers";

// Trimmed list-row + score shape. Mirrors callListRowValidator from
// voiceCalls.ts but extended with searchScore. Kept inline so this file
// is self-contained. companyName / companyLogoUrl come from the join
// performed inside _hydrateForList.
const callListRowWithScoreValidator = v.object({
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
  companyName: v.optional(v.string()),
  companyLogoUrl: v.optional(v.string()),
  searchScore: v.number(),
});

type CallListRowWithScore = {
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
  searchScore: number;
};

export const searchByText = action({
  args: {
    query: v.string(),
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
    limit: v.optional(v.number()),
  },
  returns: v.array(callListRowWithScoreValidator),
  handler: async (ctx, args): Promise<CallListRowWithScore[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // Resolve user inline, keeps the action self-contained (resolveAuthedUser
    // in voiceCalls.ts is typed for QueryCtx / MutationCtx only and cannot be
    // called from an action).
    const user: { _id: Id<"users"> } | null = await ctx.runQuery(
      internal.voiceCalls._userByTokenIdentifier,
      { tokenIdentifier: identity.tokenIdentifier },
    );
    if (!user) return [];

    const trimmed = args.query.trim();
    if (trimmed.length === 0) return [];

    const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
    const includeArchived = args.includeArchived ?? false;

    // ── Pass 1: literal title/company substring match ─────────────────
    // Always runs. Cheap. Deterministic. Catches short proper-noun queries
    // and any rows that lack summaryEmbedding (legacy data pre-backfill).
    const literalRows: Array<{
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
    }> = await ctx.runQuery(internal.voiceCalls._literalSearchForUser, {
      userId: user._id,
      query: trimmed,
      surfaces: args.surfaces,
      includeArchived,
      limit,
    });

    const result: CallListRowWithScore[] = literalRows.map((row) => ({
      ...row,
      searchScore: 1, // literal hits get top rank, ahead of any vector match
    }));

    // Short-circuit: if literal saturates the limit, skip the vector pass
    // entirely (no embed cost, no extra round trip).
    if (result.length >= limit) return result.slice(0, limit);

    // ── Pass 2: semantic vector search to fill remaining slots ────────
    const seenIds = new Set<Id<"voice_calls">>(result.map((r) => r._id));
    const remaining = limit - result.length;

    // Embed query with the same task hint used at write time.
    const vector = await embed({
      text: trimmed,
      taskHint: "sentence similarity",
    });

    const hits: Array<{ _id: Id<"voice_calls">; _score: number }> =
      await ctx.vectorSearch("voice_calls", "by_summaryVector", {
        vector,
        // Over-fetch to absorb post-filter drop-off from archived/surface
        // gates and from literal-match dedup. Capped at the API max of 256.
        limit: Math.min(remaining * 4, 256),
        filter: (q) => q.eq("userId", user._id),
      });

    if (hits.length === 0) return result;

    // Drop hits already returned by the literal pass before hydrating -
    // saves a few db.get calls.
    const newHitIds = hits
      .map((h) => h._id)
      .filter((id) => !seenIds.has(id));
    if (newHitIds.length === 0) return result;

    const rows: Array<{
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
    }> = await ctx.runQuery(internal.voiceCalls._hydrateForList, {
      ids: newHitIds,
    });

    const scoreById = new Map<Id<"voice_calls">, number>(
      hits.map((h) => [h._id, h._score]),
    );

    const surfacesSet =
      args.surfaces && args.surfaces.length > 0
        ? new Set(args.surfaces)
        : null;

    for (const row of rows) {
      // Post-filter: archived semantics (literal pass handled this in
      // _literalSearchForUser; vector pass needs it applied here)
      if (includeArchived && row.archivedAt === undefined) continue;
      if (!includeArchived && row.archivedAt !== undefined) continue;
      // Post-filter: surface
      if (surfacesSet && (!row.surface || !surfacesSet.has(row.surface))) continue;

      result.push({
        ...row,
        searchScore: scoreById.get(row._id) ?? 0,
      });
      if (result.length >= limit) break;
    }

    return result;
  },
});
