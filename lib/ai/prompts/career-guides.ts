import { z } from "zod";

export const CONTENT_MODEL_ID = "google/gemini-3.1-pro-preview";
export const JUDGE_MODEL_ID = "google/gemini-2.5-flash";

// ── Validation ──────────────────────────────────────────────────────────────

export const ValidationResponseSchema = z.object({
  valid: z.boolean(),
  normalizedTitle: z.string().nullable(),
  reason: z.string(),
});
export type ValidationResponse = z.infer<typeof ValidationResponseSchema>;

export const buildValidationPrompt = (career: string): string => `
You are a career expert. Decide whether the input is a complete, unambiguous career, job title, or profession that a guide could be written about.

Input: "${career}"

Accept full, specific job titles ("marine biologist", "primary school teacher", "FP&A manager", "plumber"). Accept common abbreviations of full titles ("SWE" for software engineer, "QA engineer") and return them in their canonical, properly capitalised form.

Reject if any of these apply:
- The input is a single ambiguous word that is most commonly a fragment of a longer title rather than a job on its own ("marine" is usually "marine biologist" or "marine engineer"; "data" is usually "data scientist"; "product" is usually "product manager"; "senior" alone has no role).
- The input is a discipline, industry, department, or skill rather than a job ("biology", "finance", "marketing", "javascript").
- The input is an adjective or modifier with no role attached ("senior", "remote", "freelance").
- The input is nonsense, offensive, or a random string of characters.

If the input could plausibly be the start of several different real careers and you cannot tell which the user means, reject it and explain that more detail is needed.

Return:
- valid: true only if you are confident it names a single, recognisable career.
- normalizedTitle: the canonical, capitalised job title if valid, otherwise null.
- reason: one short sentence. If rejecting an ambiguous fragment, hint at what to add (for example: "Try 'marine biologist' or 'marine engineer'.").
`.trim();

// ── Tier-4 LLM dedup ────────────────────────────────────────────────────────

export const DedupResponseSchema = z.object({
  isDuplicate: z.boolean(),
  matchedSlug: z.string().nullable(),
  reason: z.string(),
});
export type DedupResponse = z.infer<typeof DedupResponseSchema>;

export const buildDedupPrompt = (
  query: string,
  candidates: { slug: string; title: string }[],
): string => `
You are deciding whether a user's career-guide search query refers to the same role as any of the existing guides listed below. Catch acronym variants, synonyms, common abbreviations, and seniority variants of the same underlying role (for example, "FP&A Manager" and "Financial Planning & Analysis Manager" are the same; "Senior Software Engineer" and "Software Engineer" are also the same role for guide purposes).

Two roles are NOT duplicates if they describe genuinely different work, even when the words overlap (for example, "Lead Vocalist" is not the same as "Engineering Lead").

User query: "${query}"

Existing guides:
${candidates.length === 0 ? "(none)" : candidates.map((c, i) => `${i + 1}. "${c.title}" (slug: ${c.slug})`).join("\n")}

Return:
- isDuplicate: true if the query refers to the same role as any existing guide.
- matchedSlug: the slug of the matching guide if isDuplicate is true, otherwise null.
- reason: one short sentence.
`.trim();

// ── Content generation ──────────────────────────────────────────────────────

const SalarySchema = z.object({
  entry: z.string(),
  mid: z.string(),
  senior: z.string(),
  note: z.string().nullable(),
});

const RegionalBlockSchema = z.object({
  salary: SalarySchema,
  careerOutlook: z.string(),
  learningPath: z.array(z.string()),
  relatedRoles: z.array(z.string()),
});

export const ContentResponseSchema = z.object({
  overview: z.string(),
  typicalSkills: z.array(z.string()),
  dayToDay: z.string(),
  riskFactors: z.array(z.string()),
  whyConsider: z.string(),
  regional: z.object({
    us: RegionalBlockSchema,
    uk: RegionalBlockSchema,
  }),
});
export type ContentResponse = z.infer<typeof ContentResponseSchema>;

export const buildContentPrompt = (title: string): string => `
You are writing a public career guide for the role of "${title}".

Write authoritative, well-researched content in British English. The page is a public wiki-style resource and must NOT reference any specific person's background or skills — write as a general career resource for any reader.

The page serves both United States and United Kingdom audiences. Some information differs by country (salary, hiring market, qualifications, common job-posting titles); shared information (overview, skills, day-to-day, risks, why consider) applies globally.

For any industry acronym in the title, use the standard, widely-accepted expansion in that acronym's conventional industry. Never invent alternative expansions. If you are uncertain what an acronym means, default to the most common professional meaning in the largest industry that uses it.

Field guidance:
- overview: 200 to 300 words. What the role involves, its place in the industry, and why it matters. Warm and authoritative.
- typicalSkills: 8 to 12 specific skills, ordered most-important first. Avoid generic soft skills.
- dayToDay: 100 to 150 words. Specific and vivid description of a typical working day or week.
- riskFactors: 3 to 5 honest considerations or challenges someone should know before pursuing this path. Include automation exposure and market volatility where relevant.
- whyConsider: 80 to 120 words. Genuine and specific reasons to consider this career, not salesy.
- regional.us.salary: structured US compensation in USD, drawn from BLS, O*NET, Levels.fyi, Glassdoor US. Each band is a short, compact string with no thousands separators and the symbol-free k/m form, e.g. "50k to 65k" or "120k+". Use entry for early-career, mid for established practitioners, senior for senior or principal level. Use note for optional one-line context (sector or location variance, signing-on norms, etc.); set note to null if not needed.
- regional.us.careerOutlook: 100 to 150 words on US hiring demand, 12-month trend, growth trajectory, US-specific industry context.
- regional.us.learningPath: 5 to 8 sequential steps for entering this career in the US, with US-specific qualifications where relevant (state licensure, US certifications, common US degree routes).
- regional.us.relatedRoles: 4 to 6 distinctly different careers a person in this role might pivot to, as they appear in US job postings. Do NOT include seniority variants of the main title (different levels of the same job) or near-synonyms (the same role under another name). Each must have a different functional focus, different daily work, or different skill emphasis from the main role.
- regional.uk.salary: same structure as regional.us.salary, in GBP, in the same compact symbol-free form (e.g. "28k to 38k"), drawn from ONS, Prospects, Reed, Glassdoor UK.
- regional.uk.careerOutlook: 100 to 150 words on UK hiring demand, 12-month trend, growth trajectory, UK-specific industry context.
- regional.uk.learningPath: 5 to 8 sequential steps for entering this career in the UK, with UK-specific qualifications where relevant (chartered status, UK apprenticeships, common UK degree routes, professional bodies).
- regional.uk.relatedRoles: same as regional.us.relatedRoles but with names as they appear in UK job postings. Same distinctness rule applies.

Style: avoid em dashes and en dashes; use commas, colons, or new sentences. Be concrete and insightful, not generic. Where US and UK genuinely look similar, still produce both regional blocks with region-appropriate phrasing and localised numbers.
`.trim();

// ── Exa enrichment ─────────────────────────────────────────────────────────

export type EnrichmentRegion = "us" | "uk";
export type EnrichmentField =
  | "salary"
  | "careerOutlook"
  | "learningPath"
  | "typicalSkills"
  | "riskFactors";

export type EnrichmentTask =
  | { fieldPath: `regional.${EnrichmentRegion}.${"salary" | "careerOutlook" | "learningPath"}`; field: "salary" | "careerOutlook" | "learningPath"; region: EnrichmentRegion }
  | { fieldPath: "typicalSkills"; field: "typicalSkills"; region: null }
  | { fieldPath: "riskFactors"; field: "riskFactors"; region: null };

export const ENRICHMENT_TASKS: EnrichmentTask[] = [
  { fieldPath: "regional.us.salary", field: "salary", region: "us" },
  { fieldPath: "regional.uk.salary", field: "salary", region: "uk" },
  { fieldPath: "regional.us.careerOutlook", field: "careerOutlook", region: "us" },
  { fieldPath: "regional.uk.careerOutlook", field: "careerOutlook", region: "uk" },
  { fieldPath: "regional.us.learningPath", field: "learningPath", region: "us" },
  { fieldPath: "regional.uk.learningPath", field: "learningPath", region: "uk" },
  { fieldPath: "typicalSkills", field: "typicalSkills", region: null },
  { fieldPath: "riskFactors", field: "riskFactors", region: null },
];

const US_SALARY_DOMAINS =
  "Bureau of Labor Statistics (BLS Occupational Outlook Handbook), O*NET, Levels.fyi, Glassdoor US, Payscale US";
const UK_SALARY_DOMAINS =
  "Office for National Statistics (ONS), Prospects.ac.uk, Reed.co.uk salary guides, Glassdoor UK, Totaljobs";
const US_OUTLOOK_DOMAINS =
  "Bureau of Labor Statistics (BLS Occupational Outlook Handbook), O*NET, Lightcast, US industry trade bodies";
const UK_OUTLOOK_DOMAINS =
  "Office for National Statistics (ONS), Prospects.ac.uk, UK government skills reports, UK trade bodies";
const US_LEARNING_DOMAINS =
  "Bureau of Labor Statistics (BLS), O*NET, US accreditation bodies, US professional associations";
const UK_LEARNING_DOMAINS =
  "UCAS, Prospects.ac.uk, UK chartered bodies, UK apprenticeship guidance, UK government careers advice";

export function buildEnrichmentQuery(
  task: EnrichmentTask,
  title: string,
): { query: string; systemPrompt: string } {
  switch (task.field) {
    case "salary":
      return task.region === "us"
        ? {
            query: `What is the typical salary range for a ${title} in the United States today, broken down by entry-level, mid-level, and senior? Cite recent figures with sources.`,
            systemPrompt: `You are researching US compensation data for a public career guide. Prefer authoritative US sources: ${US_SALARY_DOMAINS}. Provide concrete USD figures and cite each band. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
          }
        : {
            query: `What is the typical salary range for a ${title} in the United Kingdom today, broken down by entry-level, mid-level, and senior? Cite recent figures with sources.`,
            systemPrompt: `You are researching UK compensation data for a public career guide. Prefer authoritative UK sources: ${UK_SALARY_DOMAINS}. Provide concrete GBP figures and cite each band. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
          };
    case "careerOutlook":
      return task.region === "us"
        ? {
            query: `What is the current US hiring demand, 12-month trend, and growth projection for a ${title}? What industry or sector context should a reader know in the United States?`,
            systemPrompt: `You are researching US career outlook for a public guide. Prefer ${US_OUTLOOK_DOMAINS}. Cite specific employment numbers, growth rates, and recent trend data. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
          }
        : {
            query: `What is the current UK hiring demand, 12-month trend, and growth projection for a ${title}? What industry or sector context should a reader know in the United Kingdom?`,
            systemPrompt: `You are researching UK career outlook for a public guide. Prefer ${UK_OUTLOOK_DOMAINS}. Cite specific employment numbers, growth rates, and recent trend data. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
          };
    case "learningPath":
      return task.region === "us"
        ? {
            query: `What is the typical path to becoming a ${title} in the United States today: required degrees, certifications, common entry routes, state licensure if any?`,
            systemPrompt: `You are researching how to enter a career in the United States for a public guide. Prefer ${US_LEARNING_DOMAINS}. Cite official requirements and recognised routes. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
          }
        : {
            query: `What is the typical path to becoming a ${title} in the United Kingdom today: required qualifications, chartered status, apprenticeships, common entry routes?`,
            systemPrompt: `You are researching how to enter a career in the United Kingdom for a public guide. Prefer ${UK_LEARNING_DOMAINS}. Cite official requirements and recognised routes. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
          };
    case "typicalSkills":
      return {
        query: `What are the most important specific skills employers list for a ${title} role today? Order by importance, prefer concrete technical and domain skills over generic soft skills.`,
        systemPrompt: `You are researching the skills that matter for a career, for a public guide. Cite from O*NET, professional bodies, and current job listings. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
      };
    case "riskFactors":
      return {
        query: `What are the honest considerations and risk factors for a career as a ${title} today: automation exposure, market volatility, common burnout patterns, structural risks?`,
        systemPrompt: `You are researching honest risk factors for a public career guide. Cite from labour-market reports, industry trend pieces, and reputable workplace surveys. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
      };
  }
}

// Salary judge — compares stored vs Exa-grounded salary, may patch on
// material delta. Per project memory: Gemini structured output cannot
// have .int/.min/.max/array-length constraints.

export const SalaryJudgeSchema = z.object({
  us: z.object({
    verdict: z.enum(["unchanged", "minor", "material"]),
    proposed: z
      .object({
        entry: z.string(),
        mid: z.string(),
        senior: z.string(),
        note: z.string().nullable(),
      })
      .nullable(),
    reasoning: z.string(),
  }),
  uk: z.object({
    verdict: z.enum(["unchanged", "minor", "material"]),
    proposed: z
      .object({
        entry: z.string(),
        mid: z.string(),
        senior: z.string(),
        note: z.string().nullable(),
      })
      .nullable(),
    reasoning: z.string(),
  }),
});
export type SalaryJudge = z.infer<typeof SalaryJudgeSchema>;

export type SalaryBand = { entry: string; mid: string; senior: string; note?: string };

export function buildSalaryJudgePrompt(args: {
  title: string;
  us: { stored: SalaryBand; exaAnswer: string; sources: string[] };
  uk: { stored: SalaryBand; exaAnswer: string; sources: string[] };
}): string {
  const fmt = (b: SalaryBand) =>
    `entry: "${b.entry}", mid: "${b.mid}", senior: "${b.senior}"${b.note ? `, note: "${b.note}"` : ""}`;
  return `
You are validating salary data for a public career guide on "${args.title}".

For each region, compare the stored salary band against the freshly-researched Exa answer. Decide a verdict:
- unchanged: the stored band is consistent with the fresh data; no patch needed.
- minor: small variation (a few thousand off, or rounded differently) but the band is broadly correct; no patch.
- material: the stored band is meaningfully wrong (more than ~15% off on any band, or a band falls outside the cited range, or the currency or unit is wrong); patch is required.

Only set "proposed" when verdict is "material". When you propose, ground each band in the cited sources and use the compact symbol-free form ("50k to 65k", "120k+", "28k to 38k") with no thousands separators or currency symbols. Include a one-line "note" only if the cited sources reveal an important regional or sector caveat; otherwise set note to null.

Return reasoning as a short single sentence per region.

UNITED STATES
Stored: ${fmt(args.us.stored)}
Fresh research:
${args.us.exaAnswer}
Sources: ${args.us.sources.slice(0, 8).join(", ") || "(none)"}

UNITED KINGDOM
Stored: ${fmt(args.uk.stored)}
Fresh research:
${args.uk.exaAnswer}
Sources: ${args.uk.sources.slice(0, 8).join(", ") || "(none)"}
`.trim();
}
