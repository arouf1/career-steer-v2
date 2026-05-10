/**
 * Per-job-posting voice assistant, non-Node Convex surface.
 *
 * Parallel to convex/voiceCalls.ts (per-guide) and convex/compassVoice.ts
 * (per-canvas). Shares the persistence + post-call analysis pipeline
 * (appendMessage, finalize, processCallAnalysis on voiceCalls / voiceCallsNode)
 * but needs its own context-loader internalQuery and its own row creator
 * that writes `surface: "job"`.
 *
 * The action that mints the Gemini Live ephemeral token lives in
 * convex/jobVoiceNode.ts (Node runtime), same split as voiceCalls.ts vs
 * voiceCallsNode.ts.
 */

import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

// ── Internal: row creator (called from the Node action after token mint) ──

export const _createJobSession = internalMutation({
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
      surface: "job",
      jobPostingId: args.jobPostingId,
      // guideId / canvasSnapshotId deliberately omitted, job calls aren't
      // anchored to either. Schema makes both optional for exactly this case.
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

// ── Internal query: gather everything mintJobSession needs in one trip ────

/**
 * Single round-trip context loader for jobVoiceNode.mintJobSession.
 *
 * Loads:
 *   - user identity + latest profile + enrichment (warm narrative for adviser)
 *   - profile_embeddings (4-facet vectors, used for fit cosine sim)
 *   - posting + company (the entity the call is about)
 *   - company_research (culture/financials; status checked downstream)
 *   - company_role_research (interview/compensation; only when the posting
 *     has a roleArchetypeSlug, research keys on it)
 *   - job_posting_embeddings (4-facet vectors for fit narrative)
 *   - linked career_guide (when roleArchetypeSlug resolves), gives the
 *     adviser typicalSkills / dayToDay / risk-factors grounding to compare
 *     the posting against the canonical role
 *
 * Read-only, the action follows up with _createJobSession to insert.
 */
export const _gatherJobContext = internalQuery({
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
      profileEmbeddings: v.any(),
      posting: v.any(),
      company: v.any(),
      companyResearch: v.any(),
      companyRoleResearch: v.any(),
      jobEmbeddings: v.any(),
      linkedGuide: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx, args.tokenIdentifier);
    if (!user) return null;

    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) {
      return {
        user,
        profile: null,
        enrichment: null,
        profileEmbeddings: null,
        posting: null,
        company: null,
        companyResearch: null,
        companyRoleResearch: null,
        jobEmbeddings: null,
        linkedGuide: null,
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

    const profileEmbeddings = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    const companyResearch = await ctx.db
      .query("company_research")
      .withIndex("by_companyId", (q) => q.eq("companyId", posting.companyId))
      .first();

    // Role-specific research is only meaningful when the posting has a
    // canonical role anchor. roleArchetypeSlug is null (resolved, no match)
    // or undefined (resolver hasn't run); both skip role research.
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

    const jobEmbeddings = await ctx.db
      .query("job_posting_embeddings")
      .withIndex("by_jobPostingId", (q) =>
        q.eq("jobPostingId", args.jobPostingId),
      )
      .first();

    const linkedGuide = posting.roleArchetypeSlug
      ? await ctx.db
          .query("career_guides")
          .withIndex("by_slug", (q) =>
            q.eq("slug", posting.roleArchetypeSlug as string),
          )
          .first()
      : null;

    return {
      user,
      profile,
      enrichment,
      profileEmbeddings,
      posting,
      company,
      companyResearch,
      companyRoleResearch,
      jobEmbeddings,
      linkedGuide,
    };
  },
});

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
