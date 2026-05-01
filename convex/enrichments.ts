import { v } from "convex/values";
import { generateText, Output } from "ai";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  ProfileEnrichmentSchema,
  type ProfileEnrichment,
} from "../lib/profiles/enrichment-schema";
import {
  ENRICHMENT_MODEL_ID,
  ENRICHMENT_SYSTEM_PROMPT,
  buildEnrichmentUserPrompt,
} from "../lib/ai/prompts/enrichment";
import { chatModel } from "../lib/ai/providers";
import type { Doc, Id } from "./_generated/dataModel";
import type { Profile } from "../lib/profiles/schema";

const nullToUndef = <T>(value: T | null | undefined): T | undefined =>
  value === null ? undefined : value;

const arrayOrUndef = <T>(value: T[]): T[] | undefined =>
  value.length === 0 ? undefined : value;

const RUN_TIMEOUT_MS = 180_000;

export const current = query({
  args: {},
  handler: async (ctx): Promise<Doc<"profile_enrichments"> | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;

    return await ctx.db
      .query("profile_enrichments")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
  },
});

export const byProfile = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args): Promise<Doc<"profile_enrichments"> | null> => {
    return await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();
  },
});

const enrichmentArgs = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("ready"),
    v.literal("stale"),
    v.literal("failed"),
  ),
  careerStage: v.optional(v.union(
    v.literal("early-career"),
    v.literal("mid-career"),
    v.literal("senior-IC"),
    v.literal("manager"),
    v.literal("director"),
    v.literal("exec"),
    v.literal("transitioning"),
  )),
  careerArchetype: v.optional(v.union(
    v.literal("founder"),
    v.literal("builder"),
    v.literal("scaler"),
    v.literal("fixer"),
    v.literal("integrator"),
    v.literal("specialist"),
    v.literal("generalist"),
  )),
  narrativeSummary: v.optional(v.string()),
  motivations: v.optional(v.array(v.object({
    kind: v.union(
      v.literal("impact"),
      v.literal("growth"),
      v.literal("craft"),
      v.literal("autonomy"),
      v.literal("financial"),
      v.literal("mission"),
      v.literal("mastery"),
    ),
    evidenceQuote: v.string(),
  }))),
  workStyleSignals: v.optional(v.object({
    collaboration: v.union(v.literal("ic"), v.literal("hybrid"), v.literal("team-lead")),
    pace: v.union(v.literal("deliberate"), v.literal("fast")),
    scope: v.union(v.literal("depth"), v.literal("breadth")),
  })),
  pivots: v.optional(v.array(v.object({
    year: v.optional(v.number()),
    kind: v.union(v.literal("role"), v.literal("function"), v.literal("industry")),
    deltaDescription: v.string(),
  }))),
  enrichedExperience: v.array(v.object({
    isoStart: v.optional(v.string()),
    isoEnd: v.optional(v.string()),
    isCurrent: v.boolean(),
    tenureMonths: v.optional(v.number()),
    functionalArea: v.union(
      v.literal("engineering"),
      v.literal("product"),
      v.literal("design"),
      v.literal("data"),
      v.literal("sales"),
      v.literal("marketing"),
      v.literal("ops"),
      v.literal("finance"),
      v.literal("legal"),
      v.literal("hr"),
      v.literal("research"),
      v.literal("exec"),
      v.literal("other"),
    ),
    subFunction: v.optional(v.string()),
    seniorityLevel: v.object({
      track: v.union(v.literal("ic"), v.literal("manager"), v.literal("exec")),
      band: v.number(),
    }),
    industry: v.optional(v.string()),
    companySizeSignal: v.union(
      v.literal("solo"),
      v.literal("startup-seed"),
      v.literal("startup-growth"),
      v.literal("scale-up"),
      v.literal("enterprise"),
      v.literal("unknown"),
    ),
    roleArchetype: v.optional(v.union(
      v.literal("founder"),
      v.literal("builder"),
      v.literal("scaler"),
      v.literal("fixer"),
      v.literal("integrator"),
      v.literal("specialist"),
      v.literal("generalist"),
    )),
    quantifiedAchievements: v.array(v.object({
      verb: v.string(),
      metric: v.optional(v.string()),
      delta: v.optional(v.string()),
      scope: v.optional(v.string()),
      evidenceQuote: v.string(),
    })),
    scopeSignals: v.object({
      teamSizeLed: v.optional(v.number()),
      budgetSignal: v.optional(v.string()),
      geography: v.optional(v.array(v.string())),
    }),
    toolsUsed: v.array(v.string()),
    domainExpertise: v.array(v.string()),
  })),
  enrichedSkills: v.array(v.object({
    raw: v.string(),
    canonical: v.string(),
    category: v.union(
      v.literal("technical"),
      v.literal("leadership"),
      v.literal("domain"),
      v.literal("soft"),
      v.literal("language"),
      v.literal("tool"),
    ),
    yearsOfExperience: v.optional(v.number()),
    lastUsedYear: v.optional(v.number()),
    proficiencySignal: v.union(
      v.literal("exposure"),
      v.literal("working"),
      v.literal("proficient"),
      v.literal("expert"),
    ),
  })),
  totalYearsExperience: v.optional(v.number()),
  careerVelocity: v.optional(v.union(
    v.literal("slow"),
    v.literal("steady"),
    v.literal("fast"),
    v.literal("very-fast"),
  )),
  tenureStats: v.optional(v.object({
    avgMonths: v.number(),
    longestMonths: v.number(),
    shortestMonths: v.number(),
  })),
  careerGaps: v.optional(v.array(v.object({
    startIso: v.optional(v.string()),
    endIso: v.optional(v.string()),
    durationMonths: v.number(),
    inferredReason: v.optional(v.string()),
  }))),
  geographicMobility: v.optional(v.object({
    cities: v.array(v.string()),
    countries: v.array(v.string()),
    remoteSignal: v.union(
      v.literal("onsite"),
      v.literal("hybrid"),
      v.literal("remote-friendly"),
      v.literal("remote-only"),
      v.literal("unknown"),
    ),
  })),
  languagesSpoken: v.optional(v.array(v.string())),
  enrichedEducation: v.array(v.object({
    isoStart: v.optional(v.string()),
    isoEnd: v.optional(v.string()),
    degreeLevel: v.union(
      v.literal("none"),
      v.literal("certificate"),
      v.literal("associate"),
      v.literal("bachelor"),
      v.literal("master"),
      v.literal("mba"),
      v.literal("phd"),
      v.literal("other"),
    ),
    fieldNormalized: v.optional(v.string()),
    institutionType: v.union(
      v.literal("university"),
      v.literal("bootcamp"),
      v.literal("online-platform"),
      v.literal("k12"),
      v.literal("other"),
    ),
  })),
  confidenceFlags: v.array(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  failureReason: v.optional(v.string()),
});

export const upsert = internalMutation({
  args: {
    profileId: v.id("profiles"),
    userId: v.id("users"),
    model: v.string(),
    payload: enrichmentArgs,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();

    const doc = {
      profileId: args.profileId,
      userId: args.userId,
      model: args.model,
      enrichedAt: Date.now(),
      ...args.payload,
    };

    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("profile_enrichments", doc);
    }
  },
});

export const markPending = internalMutation({
  args: {
    profileId: v.id("profiles"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "pending",
        failureReason: undefined,
      });
      return;
    }

    await ctx.db.insert("profile_enrichments", {
      profileId: args.profileId,
      userId: args.userId,
      status: "pending",
      enrichedExperience: [],
      enrichedSkills: [],
      enrichedEducation: [],
      motivations: [],
      pivots: [],
      careerGaps: [],
      languagesSpoken: [],
      confidenceFlags: [],
      model: ENRICHMENT_MODEL_ID,
      enrichedAt: Date.now(),
    });
  },
});

export const markStale = internalMutation({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, { status: "stale" });
  },
});

export const markFailed = internalMutation({
  args: {
    profileId: v.id("profiles"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: "failed",
      failureReason: args.reason,
    });
  },
});

const profileToInputShape = (p: Doc<"profiles">): Profile => ({
  name: p.name ?? null,
  headline: p.headline ?? null,
  summary: p.summary ?? null,
  location: p.location ?? null,
  experience: p.experience.map((e) => ({
    title: e.title,
    company: e.company,
    startDate: e.startDate ?? null,
    endDate: e.endDate ?? null,
    description: e.description ?? null,
  })),
  education: p.education.map((e) => ({
    school: e.school,
    degree: e.degree ?? null,
    field: e.field ?? null,
    startDate: e.startDate ?? null,
    endDate: e.endDate ?? null,
  })),
  skills: p.skills,
});

const enrichmentToConvex = (
  e: ProfileEnrichment,
): Omit<typeof enrichmentArgs.type, "status" | "inputTokens" | "outputTokens" | "failureReason"> => ({
  careerStage: nullToUndef(e.careerStage),
  careerArchetype: nullToUndef(e.careerArchetype),
  narrativeSummary: nullToUndef(e.narrativeSummary),
  motivations: arrayOrUndef(e.motivations),
  workStyleSignals: nullToUndef(e.workStyleSignals),
  pivots: arrayOrUndef(
    e.pivots.map((p) => ({
      year: nullToUndef(p.year),
      kind: p.kind,
      deltaDescription: p.deltaDescription,
    })),
  ),
  enrichedExperience: e.enrichedExperience.map((x) => ({
    isoStart: nullToUndef(x.isoStart),
    isoEnd: nullToUndef(x.isoEnd),
    isCurrent: x.isCurrent,
    tenureMonths: nullToUndef(x.tenureMonths),
    functionalArea: x.functionalArea,
    subFunction: nullToUndef(x.subFunction),
    seniorityLevel: x.seniorityLevel,
    industry: nullToUndef(x.industry),
    companySizeSignal: x.companySizeSignal,
    roleArchetype: nullToUndef(x.roleArchetype),
    quantifiedAchievements: x.quantifiedAchievements.map((a) => ({
      verb: a.verb,
      metric: nullToUndef(a.metric),
      delta: nullToUndef(a.delta),
      scope: nullToUndef(a.scope),
      evidenceQuote: a.evidenceQuote,
    })),
    scopeSignals: {
      teamSizeLed: nullToUndef(x.scopeSignals.teamSizeLed),
      budgetSignal: nullToUndef(x.scopeSignals.budgetSignal),
      geography: nullToUndef(x.scopeSignals.geography),
    },
    toolsUsed: x.toolsUsed,
    domainExpertise: x.domainExpertise,
  })),
  enrichedSkills: e.enrichedSkills.map((s) => ({
    raw: s.raw,
    canonical: s.canonical,
    category: s.category,
    yearsOfExperience: nullToUndef(s.yearsOfExperience),
    lastUsedYear: nullToUndef(s.lastUsedYear),
    proficiencySignal: s.proficiencySignal,
  })),
  totalYearsExperience: nullToUndef(e.totalYearsExperience),
  careerVelocity: nullToUndef(e.careerVelocity),
  tenureStats: nullToUndef(e.tenureStats),
  careerGaps: arrayOrUndef(
    e.careerGaps.map((g) => ({
      startIso: nullToUndef(g.startIso),
      endIso: nullToUndef(g.endIso),
      durationMonths: g.durationMonths,
      inferredReason: nullToUndef(g.inferredReason),
    })),
  ),
  geographicMobility: nullToUndef(e.geographicMobility),
  languagesSpoken: arrayOrUndef(e.languagesSpoken),
  enrichedEducation: e.enrichedEducation.map((d) => ({
    isoStart: nullToUndef(d.isoStart),
    isoEnd: nullToUndef(d.isoEnd),
    degreeLevel: d.degreeLevel,
    fieldNormalized: nullToUndef(d.fieldNormalized),
    institutionType: d.institutionType,
  })),
  confidenceFlags: e.confidenceFlags,
});

export const run = internalAction({
  args: {
    profileId: v.id("profiles"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.enrichments.markPending, {
      profileId: args.profileId,
      userId: args.userId,
    });

    const profile: Doc<"profiles"> | null = await ctx.runQuery(
      internal.profiles.getById,
      { profileId: args.profileId },
    );
    if (!profile) {
      await ctx.runMutation(internal.enrichments.markFailed, {
        profileId: args.profileId,
        reason: "profile not found",
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    try {
      const { output, usage } = await generateText({
        model: chatModel(ENRICHMENT_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: ProfileEnrichmentSchema }),
        system: ENRICHMENT_SYSTEM_PROMPT,
        prompt: buildEnrichmentUserPrompt(
          profileToInputShape(profile),
          profile.rawText,
        ),
        abortSignal: controller.signal,
      });

      const enriched = output as ProfileEnrichment;
      const payload = enrichmentToConvex(enriched);

      const inputTokens =
        usage && "inputTokens" in usage && typeof usage.inputTokens === "number"
          ? usage.inputTokens
          : undefined;
      const outputTokens =
        usage && "outputTokens" in usage && typeof usage.outputTokens === "number"
          ? usage.outputTokens
          : undefined;

      await ctx.runMutation(internal.enrichments.upsert, {
        profileId: args.profileId,
        userId: args.userId,
        model: ENRICHMENT_MODEL_ID,
        payload: {
          status: "ready",
          ...payload,
          inputTokens,
          outputTokens,
        },
      });

      await Promise.all([
        ctx.scheduler.runAfter(0, internal.embeddings.generate, {
          profileId: args.profileId,
          userId: args.userId,
        }),
        ctx.scheduler.runAfter(0, internal.careerPaths.generate, {
          profileId: args.profileId,
          userId: args.userId,
        }),
      ]);
    } catch (error) {
      // Defensive: each diagnostic step here was previously crashing the
      // catch handler when its input was unexpectedly undefined (e.g.
      // `JSON.stringify(undefined)` returns the value `undefined`, not the
      // string "undefined", so `.slice` then throws). When the catch
      // handler crashes, `markFailed` never runs and the row sits in
      // `pending` forever. Wrap each step so a single bad shape can't
      // prevent the row from transitioning to "failed".
      let reason = "unknown error";
      let cause: string | undefined;
      let responseBody: string | undefined;
      try {
        if (error instanceof Error && typeof error.message === "string") {
          reason = error.message.slice(0, 500);
        }
      } catch {}
      try {
        if (error instanceof Error && "cause" in error) {
          const stringified = JSON.stringify(error.cause);
          if (typeof stringified === "string") {
            cause = stringified.slice(0, 2000);
          }
        }
      } catch {}
      try {
        if (error instanceof Error && "responseBody" in error) {
          const body = (error as { responseBody: unknown }).responseBody;
          if (body !== undefined && body !== null) {
            responseBody = String(body).slice(0, 2000);
          }
        }
      } catch {}
      console.error("enrichments.run:failed", {
        profileId: args.profileId,
        reason,
        cause,
        responseBody,
      });
      try {
        await ctx.runMutation(internal.enrichments.markFailed, {
          profileId: args.profileId,
          reason,
        });
      } catch (markErr) {
        console.error("enrichments.run:markFailed_threw", {
          profileId: args.profileId,
          markErrMessage:
            markErr instanceof Error ? markErr.message : "unknown",
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  },
});
