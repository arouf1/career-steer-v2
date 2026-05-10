import { EDITORIAL_VOICE_TAIL } from "./voice";

// Prompts for the autonomous career-guide catalog expansion cron.
// Two LLM calls per tick:
//   1. Brainstorm, given an industry bucket and a sample of existing
//      slugs, propose 5 candidate canonical job titles we don't yet cover.
//   2. Legitimacy judge, given an Exa "answer" for a candidate title,
//      decide whether the title is a real, commonly-recognised
//      professional role worth a guide.
//
// Both prompts are deliberately strict. The system invents nothing the
// real labour market does not contain; cute, niche, or project-task
// titles are rejected at the judge step before any expensive content
// generation runs.

export const BRAINSTORM_SYSTEM_PROMPT = [
  "You are the curator of a career-guide catalog for a B2C career-coaching",
  "product. Your job is to propose canonical job titles for new guides.",
  "",
  "Hard rules:",
  "1. Each title must be a REAL, widely-recognised professional occupation -",
  "   the kind of title that appears on Indeed, LinkedIn, or BLS occupation",
  "   listings. No invented roles. No project tasks. No internal team names.",
  "2. Use the canonical, public form of the title. Title Case.",
  "   Examples of good output: 'Software Engineer', 'Registered Nurse',",
  "   'Tax Accountant', 'Industrial Electrician', 'UX Researcher',",
  "   'Production Designer', 'Compliance Officer'.",
  "3. STRIP all seniority modifiers UNLESS the seniority is the role itself.",
  "   Drop: Junior, Senior, Lead, Staff, Principal, Sr., Jr., II, III.",
  "   Keep: Vice President, Chief Technology Officer, Director of",
  "   Engineering (when 'Director' is the substantive role).",
  "4. NO duplicates. Do not repeat any title from the existing-catalog",
  "   sample provided in the user message. Do not propose obvious",
  "   synonyms or near-paraphrases of those titles either.",
  "5. STAY IN BUCKET. Every candidate must clearly belong to the industry",
  "   bucket specified in the user message.",
  "6. Bias toward HIGH-DEMAND, professional-track roles with meaningful",
  "   career arcs. Skip novelty and very-niche specialisations.",
  "7. Output exactly 5 candidates. No commentary, no markdown, no numbering",
  "   beyond the JSON schema.",
].join("\n");

export const buildBrainstormPrompt = (params: {
  industryBucket: string;
  existingSample: ReadonlyArray<{ slug: string; title: string }>;
}): string => {
  const { industryBucket, existingSample } = params;
  const existingList = existingSample.length
    ? existingSample.map((s) => `- ${s.title}`).join("\n")
    : "(catalog is empty)";
  return [
    `Industry bucket for this tick: ${industryBucket}`,
    "",
    "Existing catalog sample (most-recent guides. DO NOT repeat or paraphrase):",
    existingList,
    "",
    "Propose 5 canonical job titles, all in this industry bucket, none in",
    "the existing-catalog sample, following the rules in the system prompt.",
  ].join("\n");
};

// Judge prompt evaluates an Exa answer for a candidate title against a
// 4-point rubric. Verdict drives the cron's decision to spend on full
// guide generation. The judge also returns a refined canonical form, in
// case Exa surfaces a more standard variant of the brainstormed title
// (e.g. brainstorm proposed "Cyber Threat Hunter" but Exa snippets show
// the canonical industry term is "Threat Intelligence Analyst").
//
// CONTRACT NOTE: the schema fields are ordered reasoning → isLegitimate
// → canonicalTitle → confidence on purpose. Gemini fills fields in order,
// so reasoning runs first as a written chain of thought, then
// canonicalTitle is bound to whatever name reasoning settled on. The
// binding rule below makes that explicit; do not weaken it.
export const LEGITIMACY_JUDGE_SYSTEM_PROMPT = [
  "You are validating whether a proposed job title deserves its own",
  "career guide in our catalog. You will receive (a) a candidate title",
  "and (b) an Exa answer summarising web search results for that title.",
  "",
  "BINDING RULE (most important):",
  "Whenever your reasoning describes a corrected canonical name, that",
  "exact name is what you must put in canonicalTitle. The two fields",
  "are bound. A correction described in reasoning but absent from",
  "canonicalTitle is a contract violation. Do not narrate a rename in",
  "reasoning and then echo the original candidate in canonicalTitle.",
  "",
  "Apply this 4-point rubric. The title must satisfy ALL FOUR to pass:",
  "  R1. Real role: the search results clearly describe a recognised",
  "      professional occupation, not a project task, hobby, marketing",
  "      buzzword, or a single company's internal title.",
  "  R2. Real employers hire for it: results mention multiple companies,",
  "      employers, or industries hiring this role, not one outlier.",
  "  R3. Distinct identity: the role is materially distinct from",
  "      existing common occupations. If results show it's just a",
  "      seniority variant or trivial synonym of a more common title,",
  "      reject and surface the canonical form instead.",
  "  R4. Career arc: results imply this is a career, not a one-off task.",
  "      There is a learning path, day-to-day responsibilities, and",
  "      progression.",
  "",
  "Return (field order matters, do not reorder):",
  "  - reasoning: 2-4 sentence rationale, plain text. Walk through the",
  "    rubric. If you decide a corrected canonical name is needed, name",
  "    the exact corrected Title Case form here.",
  "  - isLegitimate: true ONLY if all 4 rules pass.",
  "  - canonicalTitle: the canonical Title Case form chosen in your",
  "    reasoning. Echo the candidate verbatim if no correction needed.",
  "    Strip seniority qualifiers per the same rules used for brainstorm.",
  "  - confidence: 0.0-1.0, how confident you are the rubric is",
  "    satisfied AND canonicalTitle matches the name in reasoning.",
  "",
  "Worked examples (illustrate the binding rule):",
  "",
  "  Candidate: Director of Admissions",
  "    reasoning: Exa evidence consistently uses Admissions Director as",
  "      the canonical industry title across higher education and private",
  "      schooling. Real role with a clear career arc, multiple employers",
  "      hire, distinct from generic Director roles. Renaming to",
  "      Admissions Director.",
  "    isLegitimate: true",
  "    canonicalTitle: Admissions Director",
  "    confidence: 0.95",
  "",
  "  Candidate: Cyber Threat Hunter",
  "    reasoning: Exa evidence shows the standard industry term is Threat",
  "      Intelligence Analyst. Real role, hiring is broad, distinct",
  "      identity, defined progression. Renaming to Threat Intelligence",
  "      Analyst.",
  "    isLegitimate: true",
  "    canonicalTitle: Threat Intelligence Analyst",
  "    confidence: 0.9",
  "",
  "  Candidate: Frontend Developer",
  "    reasoning: Exa evidence confirms Frontend Developer is the",
  "      standard, widely-used title. Real role, broad hiring, distinct,",
  "      defined career arc. No correction needed.",
  "    isLegitimate: true",
  "    canonicalTitle: Frontend Developer",
  "    confidence: 0.98",
  "",
  "Be skeptical. When in doubt, reject, the catalog grows hourly and",
  "we'd rather skip a tick than publish a junk guide.",
  "",
  EDITORIAL_VOICE_TAIL,
].join("\n");

export const buildLegitimacyJudgePrompt = (params: {
  candidateTitle: string;
  exaAnswer: string;
}): string => {
  const { candidateTitle, exaAnswer } = params;
  return [
    `Candidate title: ${candidateTitle}`,
    "",
    "Exa answer (summarising web evidence):",
    exaAnswer,
    "",
    "Apply the rubric. Output JSON matching the schema.",
  ].join("\n");
};

export const buildLegitimacyExaQuery = (candidateTitle: string): string =>
  `What is a "${candidateTitle}"? Is it a real, commonly-recognised ` +
  `professional occupation that real employers hire for? What does the ` +
  `role typically involve, and how is it different from related job ` +
  `titles?`;

// Round-robin industry buckets. 12 entries → full cycle every 12 hours
// (each fires twice per day). Curated to span the breadth of a B2C
// career-coaching audience without overlapping too much.
export const INDUSTRY_BUCKETS = [
  "software & data",
  "healthcare & life sciences",
  "finance & accounting",
  "skilled trades & construction",
  "creative & media",
  "education & academia",
  "sales & business development",
  "operations & supply chain",
  "marketing & growth",
  "science & research",
  "legal & compliance",
  "public sector & nonprofit",
] as const;

export type IndustryBucket = (typeof INDUSTRY_BUCKETS)[number];

// Deterministic round-robin keyed on the wall-clock hour. Stable across
// process restarts, picking the same bucket inside the same hour is fine
// (the actual cron only fires once per hour).
export const pickIndustryBucket = (now: Date): IndustryBucket => {
  const hoursSinceEpoch = Math.floor(now.getTime() / (60 * 60 * 1000));
  return INDUSTRY_BUCKETS[hoursSinceEpoch % INDUSTRY_BUCKETS.length];
};
