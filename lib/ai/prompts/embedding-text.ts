import type { Profile, ExperienceEntry } from "../../profiles/schema";
import type {
  ProfileEnrichment,
  EnrichedExperienceEntry,
} from "../../profiles/enrichment-schema";

export type EmbeddingTexts = {
  whole: string;
  arc: string;
  currentState: string;
  domain: string;
};

type ExperiencePair = {
  source: ExperienceEntry;
  enriched: EnrichedExperienceEntry;
  index: number;
};

const pairExperience = (
  profile: Profile,
  enrichment: ProfileEnrichment,
): ExperiencePair[] => {
  const len = Math.min(
    profile.experience.length,
    enrichment.enrichedExperience.length,
  );
  return Array.from({ length: len }, (_, i) => ({
    source: profile.experience[i],
    enriched: enrichment.enrichedExperience[i],
    index: i,
  }));
};

const pickMostRecent = (pairs: ExperiencePair[]): ExperiencePair | undefined => {
  if (pairs.length === 0) return undefined;
  const current = pairs.filter((p) => p.enriched.isCurrent);
  const pool = current.length > 0 ? current : pairs;
  return [...pool].sort((a, b) => {
    const aKey = a.enriched.isoStart ?? "";
    const bKey = b.enriched.isoStart ?? "";
    return bKey.localeCompare(aKey);
  })[0];
};

const formatExperienceLine = (pair: ExperiencePair): string => {
  const { source, enriched } = pair;
  const dates = `${enriched.isoStart ?? "?"} → ${
    enriched.isCurrent ? "present" : enriched.isoEnd ?? "?"
  }`;
  const level = `${enriched.seniorityLevel.track}-L${enriched.seniorityLevel.band}`;
  const fn = enriched.subFunction
    ? `${enriched.functionalArea}/${enriched.subFunction}`
    : enriched.functionalArea;
  const industry = enriched.industry ? ` · ${enriched.industry}` : "";
  return `${source.title} @ ${source.company} (${dates}), ${fn} · ${level}${industry}`;
};

const formatAchievements = (enriched: EnrichedExperienceEntry): string => {
  if (enriched.quantifiedAchievements.length === 0) return "";
  return enriched.quantifiedAchievements
    .slice(0, 3)
    .map((a) => `• ${a.evidenceQuote}`)
    .join("\n");
};

const buildWhole = (
  profile: Profile,
  enrichment: ProfileEnrichment,
  pairs: ExperiencePair[],
): string => {
  const parts: string[] = [];
  if (enrichment.narrativeSummary) parts.push(enrichment.narrativeSummary);
  if (profile.headline) parts.push(`Headline: ${profile.headline}`);

  const recent = pairs.slice(0, 3);
  if (recent.length > 0) {
    parts.push("Recent roles:");
    for (const p of recent) {
      parts.push(formatExperienceLine(p));
      const achievements = formatAchievements(p.enriched);
      if (achievements) parts.push(achievements);
    }
  }

  if (enrichment.enrichedSkills.length > 0) {
    const skills = enrichment.enrichedSkills
      .filter(
        (s) =>
          s.proficiencySignal === "proficient" ||
          s.proficiencySignal === "expert",
      )
      .map((s) => s.canonical);
    const fallback = enrichment.enrichedSkills.slice(0, 20).map((s) => s.canonical);
    const chosen = skills.length > 0 ? skills : fallback;
    if (chosen.length > 0) parts.push(`Skills: ${chosen.join(", ")}`);
  }

  return parts.join("\n\n");
};

const buildArc = (
  profile: Profile,
  enrichment: ProfileEnrichment,
  pairs: ExperiencePair[],
): string => {
  const parts: string[] = [];
  if (enrichment.careerStage)
    parts.push(`Career stage: ${enrichment.careerStage}`);
  if (enrichment.careerArchetype)
    parts.push(`Archetype: ${enrichment.careerArchetype}`);

  const trajectory = pairs
    .slice(0, 6)
    .map((p) => {
      const fn = p.enriched.subFunction
        ? `${p.enriched.functionalArea}/${p.enriched.subFunction}`
        : p.enriched.functionalArea;
      return `${p.source.title} (${fn})`;
    })
    .reverse()
    .join(" → ");
  if (trajectory) parts.push(`Trajectory: ${trajectory}`);

  if (enrichment.pivots.length > 0) {
    parts.push("Pivots:");
    for (const pivot of enrichment.pivots) {
      const year = pivot.year ? `${pivot.year}: ` : "";
      parts.push(`• ${year}[${pivot.kind}] ${pivot.deltaDescription}`);
    }
  }

  if (enrichment.totalYearsExperience !== null) {
    parts.push(`Total experience: ${enrichment.totalYearsExperience} years`);
  }
  if (enrichment.careerVelocity) {
    parts.push(`Velocity: ${enrichment.careerVelocity}`);
  }

  return parts.join("\n");
};

const buildCurrentState = (
  profile: Profile,
  enrichment: ProfileEnrichment,
  pairs: ExperiencePair[],
): string => {
  const recent = pickMostRecent(pairs);
  if (!recent) {
    return enrichment.narrativeSummary ?? profile.headline ?? "";
  }

  const parts: string[] = [];
  parts.push(formatExperienceLine(recent));
  if (recent.source.description) parts.push(recent.source.description);

  const achievements = formatAchievements(recent.enriched);
  if (achievements) parts.push(achievements);

  if (recent.enriched.toolsUsed.length > 0) {
    parts.push(`Tools: ${recent.enriched.toolsUsed.join(", ")}`);
  }

  if (recent.enriched.scopeSignals.teamSizeLed) {
    parts.push(`Team led: ${recent.enriched.scopeSignals.teamSizeLed}`);
  }
  if (recent.enriched.scopeSignals.budgetSignal) {
    parts.push(`Budget: ${recent.enriched.scopeSignals.budgetSignal}`);
  }

  return parts.join("\n");
};

const buildDomain = (
  enrichment: ProfileEnrichment,
  pairs: ExperiencePair[],
): string => {
  const domains = new Set<string>();
  const tools = new Set<string>();
  const industries = new Set<string>();
  for (const p of pairs) {
    for (const d of p.enriched.domainExpertise) domains.add(d);
    for (const t of p.enriched.toolsUsed) tools.add(t);
    if (p.enriched.industry) industries.add(p.enriched.industry);
  }

  const parts: string[] = [];
  if (industries.size > 0) parts.push(`Industries: ${[...industries].join(", ")}`);
  if (domains.size > 0) parts.push(`Domain expertise: ${[...domains].join(", ")}`);
  if (tools.size > 0) parts.push(`Tools: ${[...tools].slice(0, 30).join(", ")}`);

  const expertSkills = enrichment.enrichedSkills.filter(
    (s) =>
      s.proficiencySignal === "expert" || s.proficiencySignal === "proficient",
  );
  if (expertSkills.length > 0) {
    parts.push(
      `Strong skills: ${expertSkills.map((s) => s.canonical).join(", ")}`,
    );
  }

  return parts.join("\n");
};

export const buildEmbeddingTexts = (
  profile: Profile,
  enrichment: ProfileEnrichment,
): EmbeddingTexts => {
  const pairs = pairExperience(profile, enrichment);
  return {
    whole: buildWhole(profile, enrichment, pairs),
    arc: buildArc(profile, enrichment, pairs),
    currentState: buildCurrentState(profile, enrichment, pairs),
    domain: buildDomain(enrichment, pairs),
  };
};
