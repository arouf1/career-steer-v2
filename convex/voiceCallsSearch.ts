/**
 * Semantic search over voice_calls for the /workspace/calls history page.
 *
 * Embeds the user query with the same model used at write time (Gemini
 * Embedding 2 via OpenRouter, task hint "sentence similarity"), runs
 * vectorSearch against by_summaryVector filtered by userId, then
 * post-filters for archivedAt / surface in code and zips the vector score
 * into the returned list rows.
 *
 * Note on vectorSearch filter API: VectorFilterBuilder only exposes `eq` and
 * `or` — there is no `and` combinator. We filter by userId in the vector
 * search (most selective) and apply archivedAt / surface post-hoc after
 * hydration, which is cheap at the page sizes this feature targets.
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

    // Resolve user inline — keeps the action self-contained (resolveAuthedUser
    // in voiceCalls.ts is typed for QueryCtx / MutationCtx only and cannot be
    // called from an action).
    const user: { _id: Id<"users"> } | null = await ctx.runQuery(
      internal.voiceCalls._userByTokenIdentifier,
      { tokenIdentifier: identity.tokenIdentifier },
    );
    if (!user) return [];

    const trimmed = args.query.trim();
    if (trimmed.length === 0) return [];

    // Embed query with the same task hint used at write time.
    const vector = await embed({
      text: trimmed,
      taskHint: "sentence similarity",
    });

    const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
    const includeArchived = args.includeArchived ?? false;

    // Filter by userId only in the vector search. VectorFilterBuilder only
    // supports `eq` and `or` (no `and`), so archivedAt and surface filtering
    // is handled in code after hydration.
    const hits: Array<{ _id: Id<"voice_calls">; _score: number }> =
      await ctx.vectorSearch("voice_calls", "by_summaryVector", {
        vector,
        // Over-fetch to account for post-filter drop-off from archived/surface
        // filtering. Capped at the API max of 256.
        limit: Math.min(limit * 4, 256),
        filter: (q) => q.eq("userId", user._id),
      });

    if (hits.length === 0) return [];

    // Hydrate matched ids to trimmed rows via the shared internalQuery.
    // _hydrateForList performs the company-info join internally, so the
    // companyName / companyLogoUrl fields come back already populated.
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
      ids: hits.map((h) => h._id),
    });

    const scoreById = new Map<Id<"voice_calls">, number>(
      hits.map((h) => [h._id, h._score]),
    );

    const surfacesSet =
      args.surfaces && args.surfaces.length > 0
        ? new Set(args.surfaces)
        : null;

    const result: CallListRowWithScore[] = [];
    for (const row of rows) {
      // Post-filter: archived semantics
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
