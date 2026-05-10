import {
  query,
  mutation,
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { generateText, Output } from "ai";
import { chatModel } from "../lib/ai/providers";
import {
  buildGuidePersonalizationPrompt,
  GuidePersonalizationSchema,
  PERSONALIZATION_MODEL_ID,
  type RegionalExaSnippet,
} from "../lib/ai/prompts/guide-personalization";
import { tryConsumeRateLimit } from "./lib/rateLimit";
import { exaAnswer, type Citation } from "../lib/server/exa";

// ── Tunables ────────────────────────────────────────────────────────────────

// 90s freshness guard: a row in `generating` started within this window
// short-circuits the trigger to noop. After 90s we assume the previous
// attempt died and let a retry through.
const GENERATING_FRESHNESS_MS = 90_000;

// Per-user rate limit on personalization triggers.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Hard cap on the LLM call (matches AI SDK rule: 60-90s for non-streaming).
const LLM_TIMEOUT_MS = 60_000;

// Cap on the regional Exa fan-out. Three queries run in parallel; we don't
// want a stuck call to swallow the whole personalization budget.
const REGIONAL_EXA_TIMEOUT_MS = 25_000;

// Returns true when we should NOT generate a per-user regional block:
// either the user is in US/UK (already covered by the public guide
// content) or location is missing entirely (no signal to ground on, so
// any "personalized" region we'd emit would be a guess that can collide
// with the hardcoded US/UK pills in the sidebar).
const skipRegionalPersonalization = (
  location: string | undefined | null,
): boolean => {
  if (!location || location.trim() === "") return true;
  const lower = location.toLowerCase();
  if (
    lower.includes("united states") ||
    /\bus[a]?\b/.test(lower) ||
    /\bu\.s\.[a]?\b/.test(lower)
  ) {
    return true;
  }
  if (lower.includes("united kingdom") || /\b(uk|gb)\b/.test(lower)) {
    return true;
  }
  return false;
};

const EXA_SYSTEM_PROMPT =
  "Be specific with salary numbers, currency, and named institutions. Quote published ranges. If sources disagree, present the spread. Prefer government, professional-body, and major-jobsite sources. Output 4-6 sentences.";

const fetchRegionalExaSnippets = async (
  role: string,
  location: string,
  signal: AbortSignal,
): Promise<{ snippets: RegionalExaSnippet[]; citations: Citation[] }> => {
  const tasks: Array<Pick<RegionalExaSnippet, "topic" | "query">> = [
    {
      topic: "salary",
      query: `${role} salary range ${location} 2024 2025 in local currency`,
    },
    {
      topic: "outlook",
      query: `${role} job outlook hiring demand growth ${location} 2024 2025 employers sectors`,
    },
    {
      topic: "learning-path",
      query: `how to become a ${role} in ${location} qualifications certifications training pathway local accreditation`,
    },
  ];

  const results = await Promise.allSettled(
    tasks.map((task) =>
      exaAnswer(task.query, { systemPrompt: EXA_SYSTEM_PROMPT, signal }),
    ),
  );

  const snippets: RegionalExaSnippet[] = [];
  const citationByUrl = new Map<string, Citation>();
  results.forEach((res, i) => {
    if (res.status !== "fulfilled") return;
    const task = tasks[i];
    snippets.push({
      topic: task.topic,
      query: task.query,
      answer: res.value.answer,
      sources: res.value.citations.map((c) => ({
        url: c.url,
        title: c.title,
        publisher: c.publisher,
      })),
    });
    for (const c of res.value.citations) {
      if (!citationByUrl.has(c.url)) citationByUrl.set(c.url, c);
    }
  });

  return { snippets, citations: Array.from(citationByUrl.values()) };
};

// ── Helpers ─────────────────────────────────────────────────────────────────

// Legacy rows stored each skill bucket as string[]. New rows store
// Array<{skill, why}>. The schema validator unions both for read
// compatibility, but the UI and product copy now expect the {skill, why}
// shape. When we see a legacy row, treat it as stale and regenerate so the
// reader gets the richer "why" content on next view.
const hasLegacySkillsShape = (
  content: Doc<"career_guide_personalizations">["content"],
): boolean => {
  if (!content) return false;
  const buckets = [
    content.skillsAssessment.strengths,
    content.skillsAssessment.transferable,
    content.skillsAssessment.gaps,
  ];
  return buckets.some(
    (bucket) => bucket.length > 0 && typeof bucket[0] === "string",
  );
};

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

// ── Public query: read for current user ─────────────────────────────────────

export const getForGuide = query({
  args: { guideId: v.id("career_guides") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { state: "anonymous" }
    | { state: "no-profile" }
    | { state: "profile-pending"; lastRow: Doc<"career_guide_personalizations"> | null }
    | { state: "enrichment-failed"; reason: string | null }
    | {
        state: "ready";
        row: Doc<"career_guide_personalizations"> | null;
      }
  > => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { state: "anonymous" };

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) return { state: "no-profile" };

    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    // Surface enrichment failure explicitly so the UI can show a retry CTA
    // instead of an indefinite skeleton. The Convex enrichment row carries
    // failureReason when it transitions to "failed".
    if (enrichment && enrichment.status === "failed") {
      return {
        state: "enrichment-failed",
        reason: enrichment.failureReason ?? null,
      };
    }

    if (!enrichment || enrichment.status !== "ready") {
      // Pending / stale: enrichment is still working. Hand back the most
      // recently completed personalization (if any) so the UI can keep the
      // last good content visible with a "personalising" hint, rather than
      // wiping back to a blank skeleton on every profile edit.
      const lastRow = await ctx.db
        .query("career_guide_personalizations")
        .withIndex("by_user_and_guide", (q) =>
          q.eq("userId", user._id).eq("guideId", args.guideId),
        )
        .unique();
      return { state: "profile-pending", lastRow };
    }

    const row = await ctx.db
      .query("career_guide_personalizations")
      .withIndex("by_user_and_guide", (q) =>
        q.eq("userId", user._id).eq("guideId", args.guideId),
      )
      .unique();

    return { state: "ready", row };
  },
});

// ── Public mutation: idempotent trigger ─────────────────────────────────────

export const trigger = mutation({
  args: { guideId: v.id("career_guides") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { state: "anonymous" }
    | { state: "no-profile" }
    | { state: "profile-pending" }
    | { state: "rate-limited"; retryAfterMs: number }
    | { state: "noop"; reason: "fresh-generating" | "up-to-date" }
    | { state: "scheduled" }
  > => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { state: "anonymous" };

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) return { state: "no-profile" };

    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!enrichment || enrichment.status !== "ready") {
      return { state: "profile-pending" };
    }

    const guide = await ctx.db.get(args.guideId);
    if (!guide || guide.contentStatus !== "complete" || !guide.content) {
      return { state: "profile-pending" };
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("career_guide_personalizations")
      .withIndex("by_user_and_guide", (q) =>
        q.eq("userId", user._id).eq("guideId", args.guideId),
      )
      .unique();

    if (existing) {
      if (
        existing.status === "generating" &&
        existing.startedAt !== undefined &&
        now - existing.startedAt < GENERATING_FRESHNESS_MS
      ) {
        return { state: "noop", reason: "fresh-generating" };
      }
      const stampFresh =
        existing.enrichmentEnrichedAtStamp !== undefined &&
        existing.enrichmentEnrichedAtStamp >= enrichment.enrichedAt;
      const locationFresh =
        (existing.locationAtGeneration ?? null) ===
        (profile.location ?? null);
      const shapeFresh = !hasLegacySkillsShape(existing.content);
      if (
        existing.status === "complete" &&
        stampFresh &&
        locationFresh &&
        shapeFresh
      ) {
        return { state: "noop", reason: "up-to-date" };
      }
    }

    const rl = await tryConsumeRateLimit(ctx, {
      key: `personalize:${user._id}`,
      max: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rl.ok) {
      return { state: "rate-limited", retryAfterMs: rl.retryAfterMs };
    }

    const baseAttempts = (existing?.attempts ?? 0) + 1;
    const newToken = (existing?.generationToken ?? 0) + 1;
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "generating",
        startedAt: now,
        attempts: baseAttempts,
        generationToken: newToken,
        lastError: undefined,
      });
    } else {
      await ctx.db.insert("career_guide_personalizations", {
        userId: user._id,
        guideId: args.guideId,
        status: "generating",
        startedAt: now,
        attempts: 1,
        generationToken: newToken,
      });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.careerGuidePersonalizations.generate,
      { userId: user._id, guideId: args.guideId, token: newToken },
    );
    return { state: "scheduled" };
  },
});

// ── Public mutation: retry enrichment after failure ────────────────────────

/**
 * Reschedules the enrichment job for the current user. Called from the UI
 * when the user has hit an `enrichment-failed` state and wants to try again
 * (e.g. transient OpenRouter blip, model timeout). Idempotent against
 * concurrent retries: if the row is already pending we noop.
 */
export const retryEnrichment = mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    | { state: "anonymous" }
    | { state: "no-profile" }
    | { state: "scheduled" }
  > => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { state: "anonymous" };

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) return { state: "no-profile" };

    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    // Always reschedule. We previously noop'd on `status === "pending"` to
    // avoid duplicate runs, but a crashed earlier run can leave the row
    // sitting in "pending" forever, and there is no other recovery path
    // when the catch handler itself threw and never wrote markFailed. The
    // worst case here is two concurrent enrichment runs whose writes get
    // serialised by Convex; the later upsert wins, which is fine.
    if (enrichment) {
      await ctx.db.patch(enrichment._id, {
        status: "stale",
        failureReason: undefined,
      });
    }

    await ctx.scheduler.runAfter(0, internal.enrichments.run, {
      profileId: profile._id,
      userId: user._id,
    });

    return { state: "scheduled" };
  },
});

// ── Internal: gather inputs & write result ──────────────────────────────────

export const _readInputs = internalQuery({
  args: {
    userId: v.id("users"),
    guideId: v.id("career_guides"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    profile: Doc<"profiles">;
    enrichment: Doc<"profile_enrichments">;
    guide: Doc<"career_guides">;
  } | null> => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!profile) return null;

    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!enrichment || enrichment.status !== "ready") return null;

    const guide = await ctx.db.get(args.guideId);
    if (!guide || guide.contentStatus !== "complete" || !guide.content) {
      return null;
    }

    return { profile, enrichment, guide };
  },
});

export const _writeResult = internalMutation({
  args: {
    userId: v.id("users"),
    guideId: v.id("career_guides"),
    token: v.number(),
    outcome: v.union(
      v.object({
        kind: v.literal("complete"),
        content: v.object({
          whyYoureAFit: v.string(),
          skillsAssessment: v.object({
            strengths: v.array(
              v.object({ skill: v.string(), why: v.string() }),
            ),
            transferable: v.array(
              v.object({ skill: v.string(), why: v.string() }),
            ),
            gaps: v.array(
              v.object({ skill: v.string(), why: v.string() }),
            ),
            summary: v.string(),
          }),
          regional: v.optional(
            v.union(
              v.null(),
              v.object({
                countryCode: v.string(),
                countryName: v.string(),
                currencySymbol: v.string(),
                salary: v.object({
                  entry: v.string(),
                  mid: v.string(),
                  senior: v.string(),
                  note: v.optional(v.union(v.string(), v.null())),
                }),
                careerOutlook: v.string(),
                learningPath: v.array(v.string()),
                relatedRoles: v.array(v.string()),
                citations: v.optional(
                  v.array(
                    v.object({
                      url: v.string(),
                      title: v.string(),
                      publisher: v.optional(v.string()),
                      fetchedAt: v.number(),
                    }),
                  ),
                ),
              }),
            ),
          ),
        }),
        enrichmentEnrichedAtStamp: v.number(),
        locationAtGeneration: v.optional(v.string()),
      }),
      v.object({
        kind: v.literal("failed"),
        error: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("career_guide_personalizations")
      .withIndex("by_user_and_guide", (q) =>
        q.eq("userId", args.userId).eq("guideId", args.guideId),
      )
      .unique();
    if (!existing) return;

    // Generation-token guard: a newer trigger has already scheduled a fresh
    // generate, so this older generate's output is stale by definition.
    // Skip the write rather than overwriting fresher in-flight state.
    if (
      existing.generationToken !== undefined &&
      existing.generationToken !== args.token
    ) {
      console.log("careerGuidePersonalizations._writeResult:superseded", {
        userId: args.userId,
        guideId: args.guideId,
        rowToken: existing.generationToken,
        attemptedToken: args.token,
      });
      return;
    }

    if (args.outcome.kind === "complete") {
      await ctx.db.patch(existing._id, {
        status: "complete",
        content: args.outcome.content,
        enrichmentEnrichedAtStamp: args.outcome.enrichmentEnrichedAtStamp,
        locationAtGeneration: args.outcome.locationAtGeneration,
        generatedAt: Date.now(),
        lastError: undefined,
      });
    } else {
      await ctx.db.patch(existing._id, {
        status: "failed",
        lastError: args.outcome.error.slice(0, 500),
      });
    }
  },
});

// ── Internal action: run the LLM ────────────────────────────────────────────

export const generate = internalAction({
  args: {
    userId: v.id("users"),
    guideId: v.id("career_guides"),
    token: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const inputs = await ctx.runQuery(
      internal.careerGuidePersonalizations._readInputs,
      { userId: args.userId, guideId: args.guideId },
    );
    if (!inputs) {
      await ctx.runMutation(
        internal.careerGuidePersonalizations._writeResult,
        {
          userId: args.userId,
          guideId: args.guideId,
          token: args.token,
          outcome: { kind: "failed", error: "Inputs missing at generate time" },
        },
      );
      return;
    }

    const { profile, enrichment, guide } = inputs;
    const c = guide.content!;

    // Fan out Exa for the reader's region (skip when they're in US/UK or
    // location is missing). We do this BEFORE the LLM call so the prompt
    // can ground the regional block in real sources, and we collect the
    // citations to store alongside the personalization row.
    const exaController = new AbortController();
    const exaTimer = setTimeout(
      () => exaController.abort(),
      REGIONAL_EXA_TIMEOUT_MS,
    );
    let regionalSources: RegionalExaSnippet[] = [];
    let regionalCitations: Citation[] = [];
    try {
      if (!skipRegionalPersonalization(profile.location)) {
        const exa = await fetchRegionalExaSnippets(
          guide.title,
          profile.location!,
          exaController.signal,
        );
        regionalSources = exa.snippets;
        regionalCitations = exa.citations;
      }
    } catch (err) {
      // Exa failure is not fatal, we continue without grounding and the
      // LLM will fall back to setting regional=null. The next regen will
      // try Exa again.
      console.warn("careerGuidePersonalizations.generate:exa_failed", {
        userId: args.userId,
        guideId: args.guideId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(exaTimer);
    }

    const prompt = buildGuidePersonalizationPrompt({
      guide: {
        title: guide.title,
        overview: c.overview,
        dayToDay: c.dayToDay,
        typicalSkills: c.typicalSkills,
        riskFactors: c.riskFactors,
        salaryUk: c.regional.uk.salary,
        salaryUs: c.regional.us.salary,
        careerOutlookUk: c.regional.uk.careerOutlook,
        careerOutlookUs: c.regional.us.careerOutlook,
        learningPathUk: c.regional.uk.learningPath,
        learningPathUs: c.regional.us.learningPath,
      },
      profile: {
        rawText: profile.rawText,
        summary: profile.summary,
        headline: profile.headline,
        location: profile.location,
        skills: profile.skills,
        recentExperience: profile.experience.slice(0, 3),
      },
      enrichment: {
        careerStage: enrichment.careerStage,
        careerArchetype: enrichment.careerArchetype,
        narrativeSummary: enrichment.narrativeSummary,
        motivations: enrichment.motivations,
        workStyleSignals: enrichment.workStyleSignals,
        totalYearsExperience: enrichment.totalYearsExperience,
        geographicMobility: enrichment.geographicMobility,
        enrichedSkills: enrichment.enrichedSkills?.map((s) => ({
          canonical: s.canonical,
          proficiencySignal: s.proficiencySignal,
          yearsOfExperience: s.yearsOfExperience,
        })),
      },
      regionalSources,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const { output } = await generateText({
        model: chatModel(PERSONALIZATION_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: GuidePersonalizationSchema }),
        system: prompt.system,
        prompt: prompt.user,
        abortSignal: controller.signal,
      });

      // Enforce the schema contract at write time: when the user is in
      // US/UK or has no location set, the regional block must be null -
      // otherwise the sidebar renders a duplicate "UK" pill (the hardcoded
      // fallback plus a personalized "user" pill the LLM happily emitted
      // without grounding). Strip the model's regional output server-side
      // so the contract is truthful regardless of prompt drift.
      const stripRegional = skipRegionalPersonalization(profile.location);
      const contentWithCitations =
        !stripRegional && output.regional
          ? {
              ...output,
              regional: {
                ...output.regional,
                citations: regionalCitations,
              },
            }
          : { ...output, regional: null };

      await ctx.runMutation(
        internal.careerGuidePersonalizations._writeResult,
        {
          userId: args.userId,
          guideId: args.guideId,
          token: args.token,
          outcome: {
            kind: "complete",
            content: contentWithCitations,
            enrichmentEnrichedAtStamp: enrichment.enrichedAt,
            locationAtGeneration: profile.location ?? undefined,
          },
        },
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown personalization error";
      console.error("careerGuidePersonalizations.generate:failed", {
        userId: args.userId,
        guideId: args.guideId,
        message,
      });
      await ctx.runMutation(
        internal.careerGuidePersonalizations._writeResult,
        {
          userId: args.userId,
          guideId: args.guideId,
          token: args.token,
          outcome: { kind: "failed", error: message },
        },
      );
    } finally {
      clearTimeout(timer);
    }
  },
});
