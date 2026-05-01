import { v } from "convex/values";
import { generateText, Output } from "ai";
import {
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  CareerPathsResponseSchema,
  type CareerPathCandidate,
} from "../lib/profiles/career-paths-schema";
import {
  CAREER_PATHS_MODEL_ID,
  CAREER_PATHS_SYSTEM_PROMPT,
  buildCareerPathsUserPrompt,
  buildRerankQuery,
} from "../lib/ai/prompts/career-paths";
import { chatModel, rerank } from "../lib/ai/providers";
import type { Profile } from "../lib/profiles/schema";
import type { ProfileEnrichment } from "../lib/profiles/enrichment-schema";

const RUN_TIMEOUT_MS = 180_000;
const RERANK_MODEL = "cohere/rerank-4-pro";

export const listForCurrentUser = query({
  args: {
    kind: v.optional(v.union(
      v.literal("linear"),
      v.literal("adjacent"),
      v.literal("transformational"),
    )),
  },
  handler: async (ctx, args): Promise<Doc<"career_paths">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return [];

    const all = await ctx.db
      .query("career_paths")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    const filtered = args.kind
      ? all.filter((row) => row.kind === args.kind)
      : all;

    return [...filtered].sort((a, b) => b.fitScore - a.fitScore);
  },
});

export const replaceForProfile = internalMutation({
  args: {
    profileId: v.id("profiles"),
    userId: v.id("users"),
    rows: v.array(v.object({
      kind: v.union(
        v.literal("linear"),
        v.literal("adjacent"),
        v.literal("transformational"),
      ),
      targetRoleTitle: v.string(),
      targetFunctionalArea: v.string(),
      targetIndustry: v.optional(v.string()),
      targetLevel: v.string(),
      syntheticJd: v.string(),
      rationale: v.string(),
      requiredSkills: v.array(v.string()),
      skillGaps: v.array(v.object({
        skill: v.string(),
        severity: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
        ),
      })),
      effortMonths: v.number(),
      confidence: v.number(),
      fitScore: v.number(),
      rerankedAt: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("career_paths")
      .withIndex("by_profileId_and_kind", (q) =>
        q.eq("profileId", args.profileId),
      )
      .collect();

    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    const now = Date.now();
    for (const row of args.rows) {
      await ctx.db.insert("career_paths", {
        profileId: args.profileId,
        userId: args.userId,
        ...row,
        generatedAt: now,
      });
    }
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

const enrichmentDocToShape = (
  d: Doc<"profile_enrichments">,
): ProfileEnrichment => ({
  careerStage: d.careerStage ?? null,
  careerArchetype: d.careerArchetype ?? null,
  narrativeSummary: d.narrativeSummary ?? null,
  motivations: d.motivations ?? [],
  workStyleSignals: d.workStyleSignals ?? null,
  pivots: (d.pivots ?? []).map((p) => ({
    year: p.year ?? null,
    kind: p.kind,
    deltaDescription: p.deltaDescription,
  })),
  enrichedExperience: d.enrichedExperience.map((x) => ({
    isoStart: x.isoStart ?? null,
    isoEnd: x.isoEnd ?? null,
    isCurrent: x.isCurrent,
    tenureMonths: x.tenureMonths ?? null,
    functionalArea: x.functionalArea,
    subFunction: x.subFunction ?? null,
    seniorityLevel: x.seniorityLevel,
    industry: x.industry ?? null,
    companySizeSignal: x.companySizeSignal,
    roleArchetype: x.roleArchetype ?? null,
    quantifiedAchievements: x.quantifiedAchievements.map((a) => ({
      verb: a.verb,
      metric: a.metric ?? null,
      delta: a.delta ?? null,
      scope: a.scope ?? null,
      evidenceQuote: a.evidenceQuote,
    })),
    scopeSignals: {
      teamSizeLed: x.scopeSignals.teamSizeLed ?? null,
      budgetSignal: x.scopeSignals.budgetSignal ?? null,
      geography: x.scopeSignals.geography ?? null,
    },
    toolsUsed: x.toolsUsed,
    domainExpertise: x.domainExpertise,
  })),
  enrichedSkills: d.enrichedSkills.map((s) => ({
    raw: s.raw,
    canonical: s.canonical,
    category: s.category,
    yearsOfExperience: s.yearsOfExperience ?? null,
    lastUsedYear: s.lastUsedYear ?? null,
    proficiencySignal: s.proficiencySignal,
  })),
  totalYearsExperience: d.totalYearsExperience ?? null,
  careerVelocity: d.careerVelocity ?? null,
  tenureStats: d.tenureStats ?? null,
  careerGaps: (d.careerGaps ?? []).map((g) => ({
    startIso: g.startIso ?? null,
    endIso: g.endIso ?? null,
    durationMonths: g.durationMonths,
    inferredReason: g.inferredReason ?? null,
  })),
  geographicMobility: d.geographicMobility ?? null,
  languagesSpoken: d.languagesSpoken ?? [],
  enrichedEducation: d.enrichedEducation.map((e) => ({
    isoStart: e.isoStart ?? null,
    isoEnd: e.isoEnd ?? null,
    degreeLevel: e.degreeLevel,
    fieldNormalized: e.fieldNormalized ?? null,
    institutionType: e.institutionType,
  })),
  confidenceFlags: d.confidenceFlags,
});

const candidateToRerankDocument = (c: CareerPathCandidate): string =>
  `[${c.kind}] ${c.targetRoleTitle} (${c.targetLevel}, ${c.targetFunctionalArea}${
    c.targetIndustry ? `, ${c.targetIndustry}` : ""
  })\n${c.syntheticJd}\nRequires: ${c.requiredSkills.join(", ")}`;

export const generate = internalAction({
  args: {
    profileId: v.id("profiles"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const profile: Doc<"profiles"> | null = await ctx.runQuery(
      internal.profiles.getById,
      { profileId: args.profileId },
    );
    if (!profile) {
      console.error("careerPaths.generate:profile_missing", {
        profileId: args.profileId,
      });
      return;
    }

    const enrichmentDoc: Doc<"profile_enrichments"> | null = await ctx.runQuery(
      internal.enrichments.byProfile,
      { profileId: args.profileId },
    );
    if (!enrichmentDoc || enrichmentDoc.status !== "ready") {
      console.error("careerPaths.generate:enrichment_not_ready", {
        profileId: args.profileId,
        status: enrichmentDoc?.status,
      });
      return;
    }

    const profileShape = profileToInputShape(profile);
    const enrichment = enrichmentDocToShape(enrichmentDoc);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    try {
      const { output } = await generateText({
        model: chatModel(CAREER_PATHS_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: CareerPathsResponseSchema }),
        system: CAREER_PATHS_SYSTEM_PROMPT,
        prompt: buildCareerPathsUserPrompt(profileShape, enrichment),
        abortSignal: controller.signal,
      });
      const candidates = output.candidates;

      const rerankQuery = buildRerankQuery(profileShape, enrichment);
      const ranked = await rerank({
        query: rerankQuery,
        documents: candidates.map(candidateToRerankDocument),
        model: RERANK_MODEL,
        signal: controller.signal,
      });

      const fitScoreByIndex = new Map<number, number>();
      for (const r of ranked) {
        fitScoreByIndex.set(r.index, r.relevanceScore);
      }

      const now = Date.now();
      const rows = candidates.map((c, idx) => ({
        kind: c.kind,
        targetRoleTitle: c.targetRoleTitle,
        targetFunctionalArea: c.targetFunctionalArea,
        targetIndustry: c.targetIndustry ?? undefined,
        targetLevel: c.targetLevel,
        syntheticJd: c.syntheticJd,
        rationale: c.rationale,
        requiredSkills: c.requiredSkills,
        skillGaps: c.skillGaps,
        effortMonths: c.effortMonths,
        confidence: c.confidence,
        fitScore: fitScoreByIndex.get(idx) ?? c.confidence,
        rerankedAt: now,
      }));

      await ctx.runMutation(internal.careerPaths.replaceForProfile, {
        profileId: args.profileId,
        userId: args.userId,
        rows,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.slice(0, 500) : "unknown error";
      console.error("careerPaths.generate:failed", {
        profileId: args.profileId,
        reason,
      });
    } finally {
      clearTimeout(timeout);
    }
  },
});
