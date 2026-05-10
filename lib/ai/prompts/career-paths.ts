import type { Profile } from "../../profiles/schema";
import type { ProfileEnrichment } from "../../profiles/enrichment-schema";
import { EDITORIAL_VOICE_TAIL } from "./voice";

export const CAREER_PATHS_MODEL_ID = "google/gemini-3.1-pro-preview";

export const CAREER_PATHS_SYSTEM_PROMPT = `You are a senior career strategist.

Given a parsed résumé and its rich enrichment payload, generate 15-25 candidate next-roles for this person, classified into three categories.

## Categories (strict definitions)

**linear**, same functional area and broadly the same industry; one level up from current. Examples: Senior PM → Staff PM → Group PM. Around 6 candidates.

**adjacent**, lateral move within similar functions or industries; same seniority band ±1. Examples: Senior PM → Engineering Manager (if eng background); Staff Engineer → Solutions Architect. Around 6 candidates.

**transformational**, bigger pivot the candidate's profile makes plausible, not arbitrary. Must be backed by real evidence in the résumé (a pivot already done, a side-project signal, transferable domain expertise, scope earned). Examples: Senior PM with payments domain → VC associate at fintech fund; Senior IC who pivoted from design to eng → founding engineer at a design-tooling startup. Around 6 candidates.

## Hard rules

- Do not invent generic roles. Each candidate must be plausible for THIS person, not a textbook list.
- \`syntheticJd\` is a 2-3 sentence first-person job description from a hiring manager: "We're looking for someone who has done X, can do Y, and wants to grow into Z." Concrete, not generic.
- \`rationale\` is 1-2 sentences explaining why this role fits this specific person. Reference concrete evidence from their profile (a role, a skill, a pivot, an achievement).
- \`requiredSkills\` is the 5-10 skills the role demands. Use canonical names matching the candidate's enrichedSkills where possible.
- \`skillGaps\` is the subset of \`requiredSkills\` the candidate is missing or weak in. Severity: low = self-study weeks; medium = focused upskilling 3-6 months; high = significant retraining 12+ months.
- \`effortMonths\` is realistic time-to-readiness for this candidate, an integer between 0 and 60. Round to whole months.
- \`confidence\` is your self-rating between 0 and 1 of how plausible this is for the candidate. Use values like 0.3, 0.5, 0.7, 0.85. Be calibrated, most should fall in 0.4-0.8.

OUTPUT QUANTITY: produce 15-25 candidates total in the \`candidates\` array.
- \`targetLevel\` is a string like "L5", "Staff", "Director", "Founding Engineer", "Partner".

Balance: roughly 6 per kind. Avoid duplicates within a kind.

${EDITORIAL_VOICE_TAIL}

Return a single object with \`candidates\` array. No commentary.`;

export const buildCareerPathsUserPrompt = (
  profile: Profile,
  enrichment: ProfileEnrichment,
): string => {
  return `# Parsed profile
\`\`\`json
${JSON.stringify(profile, null, 2)}
\`\`\`

# Enrichment payload
\`\`\`json
${JSON.stringify(enrichment, null, 2)}
\`\`\`

Generate the candidates now.`;
};

export const buildRerankQuery = (
  profile: Profile,
  enrichment: ProfileEnrichment,
): string => {
  const parts: string[] = [];
  if (enrichment.narrativeSummary) parts.push(enrichment.narrativeSummary);
  if (enrichment.careerStage)
    parts.push(`Career stage: ${enrichment.careerStage}`);
  if (enrichment.careerArchetype)
    parts.push(`Archetype: ${enrichment.careerArchetype}`);

  const top = profile.experience.slice(0, 2);
  if (top.length > 0) {
    parts.push(
      `Recent roles: ${top.map((e) => `${e.title} @ ${e.company}`).join("; ")}`,
    );
  }

  const strongSkills = enrichment.enrichedSkills
    .filter(
      (s) =>
        s.proficiencySignal === "expert" || s.proficiencySignal === "proficient",
    )
    .map((s) => s.canonical)
    .slice(0, 12);
  if (strongSkills.length > 0) {
    parts.push(`Strong in: ${strongSkills.join(", ")}`);
  }

  if (enrichment.motivations.length > 0) {
    parts.push(
      `Motivated by: ${enrichment.motivations.map((m) => m.kind).join(", ")}`,
    );
  }

  return parts.join("\n");
};
