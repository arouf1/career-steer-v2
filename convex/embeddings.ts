import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { embedBatch } from "../lib/ai/providers";
import { buildEmbeddingTexts } from "../lib/ai/prompts/embedding-text";
import type { Profile } from "../lib/profiles/schema";
import type { ProfileEnrichment } from "../lib/profiles/enrichment-schema";

const EMBED_DIM = 1536;
const EMBED_MODEL = "google/gemini-embedding-2-preview";

export const byProfile = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args): Promise<Doc<"profile_embeddings"> | null> => {
    return await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();
  },
});

export const upsert = internalMutation({
  args: {
    profileId: v.id("profiles"),
    userId: v.id("users"),
    wholeVector: v.array(v.float64()),
    arcVector: v.array(v.float64()),
    currentStateVector: v.array(v.float64()),
    domainVector: v.array(v.float64()),
    // Required on writes; field on table is optional only for legacy rows.
    arcSourceText: v.string(),
    dimensions: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();

    const doc = {
      profileId: args.profileId,
      userId: args.userId,
      wholeVector: args.wholeVector,
      arcVector: args.arcVector,
      currentStateVector: args.currentStateVector,
      domainVector: args.domainVector,
      arcSourceText: args.arcSourceText,
      dimensions: args.dimensions,
      model: args.model,
      generatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("profile_embeddings", doc);
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
      console.error("embeddings.generate:profile_missing", {
        profileId: args.profileId,
      });
      return;
    }

    const enrichmentDoc: Doc<"profile_enrichments"> | null = await ctx.runQuery(
      internal.enrichments.byProfile,
      { profileId: args.profileId },
    );
    if (!enrichmentDoc || enrichmentDoc.status !== "ready") {
      console.error("embeddings.generate:enrichment_not_ready", {
        profileId: args.profileId,
        status: enrichmentDoc?.status,
      });
      return;
    }

    const texts = buildEmbeddingTexts(
      profileToInputShape(profile),
      enrichmentDocToShape(enrichmentDoc),
    );

    try {
      const [wholeVector, arcVector, currentStateVector, domainVector] =
        await embedBatch(
          [
            { text: texts.whole, taskHint: "retrieval document" },
            { text: texts.arc, taskHint: "retrieval document" },
            { text: texts.currentState, taskHint: "retrieval document" },
            { text: texts.domain, taskHint: "retrieval document" },
          ],
          { outputDimensionality: EMBED_DIM, model: EMBED_MODEL },
        );

      for (const [name, vec] of [
        ["whole", wholeVector],
        ["arc", arcVector],
        ["currentState", currentStateVector],
        ["domain", domainVector],
      ] as const) {
        if (vec.length !== EMBED_DIM) {
          throw new Error(
            `${name} embedding has ${vec.length} dims, expected ${EMBED_DIM}`,
          );
        }
      }

      await ctx.runMutation(internal.embeddings.upsert, {
        profileId: args.profileId,
        userId: args.userId,
        wholeVector,
        arcVector,
        currentStateVector,
        domainVector,
        arcSourceText: texts.arc,
        dimensions: EMBED_DIM,
        model: EMBED_MODEL,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.slice(0, 500) : "unknown error";
      console.error("embeddings.generate:failed", {
        profileId: args.profileId,
        reason,
      });
    }
  },
});
