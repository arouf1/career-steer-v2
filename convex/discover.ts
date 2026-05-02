// convex/discover.ts
import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import {
  REGEN_DEBOUNCE_MS,
  SNAPSHOT_MAX_ATTEMPTS,
} from "./lib/discoverThresholds";

/**
 * Resolve the calling user's userId. Throws if unauthenticated.
 *
 * NOTE: this project's `users` table is keyed by Clerk's `tokenIdentifier`
 * (not `subject` / `clerkId`), so we look up by the `by_tokenIdentifier`
 * index — matching the pattern in `convex/users.ts`.
 */
async function requireUserId(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
  db: any;
}): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q: any) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) throw new Error("user-not-provisioned");
  return user._id as Id<"users">;
}

/**
 * Single entry-point for all snapshot regeneration triggers. Debounces
 * within REGEN_DEBOUNCE_MS per userId so a flurry of writes doesn't fire
 * ten generations. `dedupKey` is currently informational only (logged on
 * debounce-skip for traceability); we may partition the debounce window
 * per (userId, dedupKey) if we observe legitimate concurrent triggers
 * needing independent regen.
 *
 * `dedupKey` examples:
 *   "init"          — first eager generation on profile completion
 *   "embedding"     — profile embedding regenerated
 *   "guide:<id>"    — guide content/embedding changed (fan-out)
 *   "manual"        — user-initiated refresh
 */
export const scheduleSnapshotRegeneration = internalMutation({
  args: {
    userId: v.id("users"),
    dedupKey: v.string(),
    /** When true, bypasses the discover_match_reasons cache for fresh LLM calls. */
    forceFreshReasons: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!profile) {
      console.warn("discover.schedule:no-profile", { userId: args.userId });
      return;
    }
    const embedding = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (!embedding) {
      console.warn("discover.schedule:no-embedding", { profileId: profile._id });
      return;
    }

    // Dedup: if a snapshot exists with status "generating" started within
    // the debounce window for this user, skip enqueueing.
    const existing = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (
      existing &&
      existing.status === "generating" &&
      Date.now() - existing.generatedAt < REGEN_DEBOUNCE_MS
    ) {
      console.debug("discover.schedule:debounced", {
        userId: args.userId,
        dedupKey: args.dedupKey,
        ageMs: Date.now() - existing.generatedAt,
      });
      return;
    }

    // Mark a generating row (insert or replace) so subsequent triggers
    // within the window dedup. The action will replace it on success.
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "generating",
        generatedAt: Date.now(),
        attempts: 0,
        failureReason: undefined,
      });
    } else {
      await ctx.db.insert("discover_canvases", {
        userId: args.userId,
        profileId: profile._id,
        profileEmbeddingId: embedding._id,
        generatedAt: Date.now(),
        status: "generating",
        lanes: [],
        attempts: 0,
      });
    }

    await ctx.scheduler.runAfter(0, internal.discover.generateSnapshot, {
      userId: args.userId,
      profileId: profile._id,
      expectedProfileEmbeddingId: embedding._id,
      forceFreshReasons: args.forceFreshReasons ?? false,
    });
  },
});

// `generateSnapshot` is implemented across Tasks 2.2 – 2.9 below.
// Stub so the file compiles in isolation:
export const generateSnapshot = internalAction({
  args: {
    userId: v.id("users"),
    profileId: v.id("profiles"),
    expectedProfileEmbeddingId: v.id("profile_embeddings"),
    forceFreshReasons: v.boolean(),
  },
  handler: async () => {
    // TODO: implemented in Tasks 2.2-2.9
  },
});
