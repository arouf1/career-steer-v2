// Mirrors lib/ai/prompts/guide-embedding-text.ts but for job postings. A
// posting gets four facet vectors that align directly with profile and guide
// facets: a profile's currentState facet can be cosine-matched against a
// posting's currentState facet, an arc against an arc, etc. This is the same
// trick career_guides + profile_embeddings use for the discover canvas.
//
// Token budget per facet: Gemini Embedding 2 caps at 8192 tokens. We cap at
// 6000 chars to stay safely inside even at worst-case 1 char = 1 token.

const FACET_CHAR_BUDGET = 6000;

export type JobContent = {
  overview: string;
  theRole: string;
  whatStandsOut: string[];
  idealCandidate: string;
  compSummary: string | null;
};

export type JobEmbeddingInput = {
  title: string;
  companyName: string;
  city: string;
  countryCode: string | null;
  schedule: string | null;
  workFromHome: boolean | null;
  salary: string | null;
  content: JobContent | null; // null when content hasn't been generated yet
  roleArchetypeSlug: string | null;
};

export type JobEmbeddingTexts = {
  whole: string;
  arc: string;
  currentState: string;
  domain: string;
};

const truncate = (text: string): string =>
  text.length <= FACET_CHAR_BUDGET ? text : text.slice(0, FACET_CHAR_BUDGET);

const joinNonEmpty = (parts: string[]): string =>
  parts.filter((p) => p.length > 0).join("\n\n");

const unslug = (slug: string): string => slug.replace(/-+/g, " ").trim();

// "Software Engineer at Acme in London" — the framing line shared across
// facets so the company-context signal isn't lost.
const buildHeader = (input: JobEmbeddingInput): string => {
  const remote = input.workFromHome === true ? " (remote-friendly)" : "";
  return `${input.title} at ${input.companyName} in ${input.city}${remote}`;
};

const buildWhole = (input: JobEmbeddingInput): string => {
  const c = input.content;
  const parts: string[] = [`Job posting: ${buildHeader(input)}`];
  if (c) {
    if (c.overview) parts.push(c.overview);
    if (c.theRole) parts.push(`What the role looks like:\n${c.theRole}`);
    if (c.whatStandsOut.length > 0) {
      parts.push(
        `What stands out:\n${c.whatStandsOut.map((s) => `• ${s}`).join("\n")}`,
      );
    }
    if (c.idealCandidate) {
      parts.push(`Who would thrive here:\n${c.idealCandidate}`);
    }
    if (c.compSummary) parts.push(`Compensation: ${c.compSummary}`);
  }
  if (input.schedule) parts.push(`Schedule: ${input.schedule}`);
  return truncate(joinNonEmpty(parts));
};

// Trajectory framing: comp band, archetype, distinctive items that signal
// where in a career arc this role sits. Mirrors guide-embedding-text's
// "Career trajectory for: X" approach.
const buildArc = (input: JobEmbeddingInput): string => {
  const c = input.content;
  const parts: string[] = [`Career step: ${buildHeader(input)}`];
  if (input.roleArchetypeSlug) {
    parts.push(`Role archetype: ${unslug(input.roleArchetypeSlug)}`);
  }
  // Prefer the LLM-distilled compSummary over the raw salary string —
  // it captures band, bonus, equity, and any other context the trajectory
  // signal benefits from. Fall back to raw salary when no rewrite yet.
  if (c?.compSummary) {
    parts.push(`Compensation context: ${c.compSummary}`);
  } else if (input.salary) {
    parts.push(`Salary band: ${input.salary}`);
  }
  if (c?.whatStandsOut && c.whatStandsOut.length > 0) {
    // Distinctive signals — Series stage, scope, scale — are arc cues.
    parts.push(
      `Distinctive about this opportunity:\n${c.whatStandsOut.map((s) => `• ${s}`).join("\n")}`,
    );
  }
  if (c?.idealCandidate) {
    // Years-of-experience signals seniority.
    parts.push(`Profile fit: ${c.idealCandidate}`);
  }
  return truncate(joinNonEmpty(parts));
};

// "What this person actually does day-to-day" — best matched against profile
// currentState. theRole + idealCandidate carry that signal; we also include
// the header so the company context is never absent.
const buildCurrentState = (input: JobEmbeddingInput): string => {
  const c = input.content;
  const parts: string[] = [`Day-to-day: ${buildHeader(input)}`];
  if (c?.theRole) parts.push(c.theRole);
  if (c?.idealCandidate) {
    parts.push(`Profile of someone in this role:\n${c.idealCandidate}`);
  }
  if (input.schedule) parts.push(`Schedule: ${input.schedule}`);
  return truncate(joinNonEmpty(parts));
};

// Tooling / skills / domain. theRole tends to mention concrete tech
// (languages, databases, frameworks); idealCandidate names skills. Both
// are the right substrate for skill-overlap matching.
const buildDomain = (input: JobEmbeddingInput): string => {
  const c = input.content;
  const parts: string[] = [`Domain and skills: ${buildHeader(input)}`];
  if (input.roleArchetypeSlug) {
    parts.push(`Role archetype: ${unslug(input.roleArchetypeSlug)}`);
  }
  if (c?.theRole) {
    parts.push(`Work and tools:\n${c.theRole}`);
  }
  if (c?.idealCandidate) {
    parts.push(`Required and useful skills:\n${c.idealCandidate}`);
  }
  return truncate(joinNonEmpty(parts));
};

export function buildJobEmbeddingTexts(
  input: JobEmbeddingInput,
): JobEmbeddingTexts {
  return {
    whole: buildWhole(input),
    arc: buildArc(input),
    currentState: buildCurrentState(input),
    domain: buildDomain(input),
  };
}
