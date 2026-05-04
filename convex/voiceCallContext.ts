/**
 * Pure helpers for the realtime voice "deep dive" feature.
 *
 * No Convex APIs imported here — these functions are unit-testable and
 * called from convex/voiceCalls.ts after it has loaded the necessary
 * documents through ctx.db / ctx.runQuery.
 */

import type { Doc } from "./_generated/dataModel";
import {
  voiceAdviserPrompt,
  type VoiceAdviserPromptContext,
} from "../lib/ai/prompts/voiceAdviser";

type Region = "us" | "uk";

type Citation = {
  url: string;
  title: string;
  publisher?: string;
  fetchedAt: number;
};

type AggregatedCitation = {
  url: string;
  title: string;
  publisher?: string;
  sectionPath: string;
};

const MAX_CITATIONS_FOR_PROMPT = 10;

/**
 * Merge citations from the guide row, every Go Deeper branch, and the
 * per-user personalization (regional Exa fan-out for non-US/UK users) into
 * one deduplicated, recency-sorted list. The `sectionPath` records *where*
 * each source came from so the system prompt can tell the model what each
 * source is about — useful when the model wants to cite naturally.
 */
export function aggregateGuideCitations(args: {
  guide: Doc<"career_guides">;
  branches: Array<Doc<"career_guide_branches">>;
  personalization: Doc<"career_guide_personalizations"> | null;
}): AggregatedCitation[] {
  const { guide, branches, personalization } = args;
  const seen = new Map<string, AggregatedCitation & { fetchedAt: number }>();

  const addOne = (
    c: Citation | undefined,
    sectionPath: string,
  ): void => {
    if (!c?.url) return;
    const existing = seen.get(c.url);
    // Keep the most recent fetchedAt, but prefer the more specific
    // sectionPath if a duplicate URL appears in multiple sections.
    if (!existing || c.fetchedAt > existing.fetchedAt) {
      seen.set(c.url, {
        url: c.url,
        title: c.title,
        publisher: c.publisher,
        sectionPath,
        fetchedAt: c.fetchedAt,
      });
    }
  };

  // Public guide citations (Record<sectionPath, Citation[]>).
  if (guide.citations) {
    for (const [path, list] of Object.entries(guide.citations)) {
      for (const c of list) addOne(c, path);
    }
  }

  // Personalization regional citations (only present for non-US/UK users).
  const regional = personalization?.content?.regional;
  if (regional && regional.citations) {
    for (const c of regional.citations) {
      addOne(c, `regional.${regional.countryCode}.personalized`);
    }
  }

  // Go Deeper Q&A branch citations.
  for (const branch of branches) {
    if (branch.status !== "complete" || !branch.citations) continue;
    for (const c of branch.citations) {
      addOne(c, `branches.${branch.sectionId}:${truncate(branch.question, 60)}`);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .slice(0, MAX_CITATIONS_FOR_PROMPT)
    .map(({ fetchedAt: _f, ...rest }) => rest);
}

/**
 * Project the rich profile_enrichments row down to just the bits we want to
 * inject into a 5-10 minute voice call. Anything not surfaced here is
 * deliberately omitted — the model's context budget is small and we want
 * the adviser to feel personal, not robotic.
 */
export function buildProfileSnapshotForVoice(args: {
  user: Doc<"users">;
  enrichment: Doc<"profile_enrichments"> | null;
  profile: Doc<"profiles"> | null;
}): VoiceAdviserPromptContext["profile"] {
  const { user, enrichment, profile } = args;

  const candidateName =
    user.name?.trim()?.split(/\s+/)[0] ??
    profile?.name?.trim()?.split(/\s+/)[0] ??
    "there";

  if (!enrichment) {
    // No enrichment means the profile parser hasn't run yet (or the user
    // never uploaded a CV). Returning a minimal block lets the prompt know
    // not to fabricate context.
    return profile
      ? {
          candidateName,
          currentTitle: profile.experience?.[0]?.title,
          currentCompany: profile.experience?.[0]?.company,
          topSkills: profile.skills?.slice(0, 8) ?? [],
          motivations: [],
        }
      : undefined;
  }

  const currentExp = enrichment.enrichedExperience.find((e) => e.isCurrent)
    ?? enrichment.enrichedExperience[0]
    ?? null;

  const topSkills = (enrichment.enrichedSkills ?? [])
    .filter(
      (s) =>
        s.proficiencySignal === "expert" ||
        s.proficiencySignal === "proficient",
    )
    .slice(0, 10)
    .map((s) => s.canonical);

  // If we don't have enough proficient skills, top up from any skill.
  if (topSkills.length < 5) {
    for (const s of enrichment.enrichedSkills ?? []) {
      if (topSkills.length >= 8) break;
      if (!topSkills.includes(s.canonical)) topSkills.push(s.canonical);
    }
  }

  const motivations = (enrichment.motivations ?? []).map((m) => m.kind);

  const workStyle = enrichment.workStyleSignals
    ? `${enrichment.workStyleSignals.collaboration} / ${enrichment.workStyleSignals.pace} / ${enrichment.workStyleSignals.scope}`
    : undefined;

  return {
    candidateName,
    narrativeSummary: enrichment.narrativeSummary,
    careerStage: enrichment.careerStage,
    careerArchetype: enrichment.careerArchetype,
    totalYearsExperience: enrichment.totalYearsExperience,
    currentTitle: profile?.experience?.[0]?.title ?? undefined,
    currentCompany: profile?.experience?.[0]?.company ?? undefined,
    topSkills,
    motivations,
    workStyle,
  };
}

export function buildGuideContextForVoice(args: {
  guide: Doc<"career_guides">;
  region: Region;
}): VoiceAdviserPromptContext["guide"] | null {
  const { guide, region } = args;
  if (!guide.content) return null;
  const r = guide.content.regional[region];
  return {
    title: guide.title,
    overview: guide.content.overview,
    dayToDay: guide.content.dayToDay,
    whyConsider: guide.content.whyConsider,
    riskFactors: guide.content.riskFactors,
    typicalSkills: guide.content.typicalSkills,
    region: {
      key: region,
      label: region === "us" ? "US" : "UK",
      salary: r.salary,
      careerOutlook: r.careerOutlook,
      learningPath: r.learningPath,
    },
  };
}

/**
 * Compose the full system instruction string for a Gemini Live session.
 * Thin wrapper so callers don't have to know about the prompt module.
 */
export function buildSystemInstructions(
  ctx: VoiceAdviserPromptContext,
): string {
  return voiceAdviserPrompt(ctx);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
