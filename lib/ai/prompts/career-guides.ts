import { z } from "zod";

export const CONTENT_MODEL_ID = "google/gemini-3.1-pro-preview";
export const JUDGE_MODEL_ID = "google/gemini-2.5-flash";
// Gemini 3 Flash — used for short-form, latency-sensitive surfaces where the
// user is actively waiting (Go Deeper Q&A expansions). The full pro-tier
// model is reserved for the heavier upfront guide generation.
export const BRANCH_MODEL_ID = "google/gemini-3-flash-preview";

// Homepage search validation — single boolean + a normalized title. Latency
// matters more than nuance, and the schema is trivial, so flash is the right
// fit. Kept separate from BRANCH so the two surfaces can diverge later.
export const VALIDATION_MODEL_ID = "google/gemini-3-flash-preview";

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
You are deciding whether a user's career-guide search query refers to the same role as any of the existing guides listed below.

DUPLICATE (return isDuplicate=true) — these refer to the same role:
- Acronym variants of the same role: "FP&A Manager" = "Financial Planning & Analysis Manager"; "SWE" = "Software Engineer".
- Common synonyms / abbreviations of the same role: "Front-End Developer" = "Frontend Engineer".
- IC-track seniority of the same role (no change in management scope or function):
    "Senior Software Engineer" = "Software Engineer";
    "Staff Designer" = "Designer";
    "Lead Data Scientist" (IC lead, not a people manager) = "Data Scientist".

NOT a duplicate (return isDuplicate=false) — these are GENUINELY DIFFERENT roles even when they share words:
- Leadership-tier roles vs the IC role they oversee. The leadership role is its own guide; never collapse it into an IC role.
    "Head of Product" is NEVER "Product Manager".
    "Director of Engineering" is NEVER "Software Engineer".
    "VP Marketing" is NEVER "Marketing Manager".
    "Chief Financial Officer" is NEVER "Financial Analyst".
    "Chief Product Officer" is NEVER "Product Manager".
    "Engineering Manager" is NEVER "Senior Software Engineer" (different track — management vs IC).
- Different functions that happen to share a word:
    "Lead Vocalist" is NOT "Engineering Lead".
    "Account Executive" (sales) is NOT "Account Manager" (post-sale customer success).
- Different specialities of a broad function:
    "Frontend Engineer" is NOT "Backend Engineer".
    "Data Engineer" is NOT "Data Scientist".

Default-direction principle: when in doubt, prefer isDuplicate=false. Creating a new guide is recoverable; collapsing two real careers into one is not.

User query: "${query}"

Existing guides:
${candidates.length === 0 ? "(none)" : candidates.map((c, i) => `${i + 1}. "${c.title}" (slug: ${c.slug})`).join("\n")}

Return:
- isDuplicate: true only if the query refers to the same role as one of the listed guides.
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

// Section ids the Go Deeper feature recognises. Mirrors keys used in the
// UI's GoDeeper component and the followUps record on career_guides.
export const FOLLOW_UP_SECTION_IDS = [
  "overview",
  "day-to-day",
  "outlook-us",
  "outlook-uk",
  "learning-path-us",
  "learning-path-uk",
  "considerations",
] as const;
export type FollowUpSectionId = (typeof FOLLOW_UP_SECTION_IDS)[number];

const FollowUpsSchema = z.object({
  overview: z.array(z.string()),
  "day-to-day": z.array(z.string()),
  "outlook-us": z.array(z.string()),
  "outlook-uk": z.array(z.string()),
  "learning-path-us": z.array(z.string()),
  "learning-path-uk": z.array(z.string()),
  considerations: z.array(z.string()),
});
export type FollowUps = z.infer<typeof FollowUpsSchema>;

// SEO meta produced inline with content. No bound constraints — Gemini
// rejects them; lengths and counts are encoded in the prompt.
export const ContentMetaSchema = z.object({
  title: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  socialAlt: z.string(),
});
export type ContentMeta = z.infer<typeof ContentMetaSchema>;

export const ContentResponseSchema = z.object({
  overview: z.string(),
  typicalSkills: z.array(z.string()),
  typicalSkillsDetail: z.array(
    z.object({
      name: z.string(),
      rationale: z.string(),
      tier: z.enum(["must", "nice"]),
    }),
  ),
  dayToDay: z.string(),
  riskFactors: z.array(z.string()),
  whyConsider: z.string(),
  regional: z.object({
    us: RegionalBlockSchema,
    uk: RegionalBlockSchema,
  }),
  followUps: FollowUpsSchema,
  meta: ContentMetaSchema,
  // Classification of the role's typical career stage. Mirrors the
  // careerStage vocabulary on profile_enrichments minus "transitioning"
  // (guides describe destinations, not transitions). Drives discover-canvas
  // lane bucketing — see CareerStageSchema below for the canonical rubric.
  typicalCareerStage: z.enum([
    "early-career",
    "mid-career",
    "senior-IC",
    "manager",
    "director",
    "exec",
  ]),
});
export type ContentResponse = z.infer<typeof ContentResponseSchema>;

export const buildContentPrompt = (title: string): string => `
You are writing a public career guide for the role of "${title}".

Write authoritative, well-researched content in British English. The page is a public wiki-style resource and must NOT reference any specific person's background or skills — write as a general career resource for any reader.

The page serves both United States and United Kingdom audiences. Some information differs by country (salary, hiring market, qualifications, common job-posting titles); shared information (overview, skills, day-to-day, risks, why consider) applies globally.

For any industry acronym in the title, use the standard, widely-accepted expansion in that acronym's conventional industry. Never invent alternative expansions. If you are uncertain what an acronym means, default to the most common professional meaning in the largest industry that uses it.

Field guidance:
- overview: 200 to 300 words. What the role involves, its place in the industry, and why it matters. Warm and authoritative.
- typicalSkills: 8 to 12 specific skills, ordered most-important first. Avoid generic soft skills. Must be the same names that appear in typicalSkillsDetail (in the same order).
- typicalSkillsDetail: the same skills as typicalSkills, each expanded into an object with three fields:
  - name: the skill name (concise, 1 to 5 words; matches the corresponding entry in typicalSkills exactly).
  - rationale: 1 to 2 sentences (max ~25 words) explaining concretely why this skill matters for the role — what it unlocks day-to-day, what fails without it, or what employers screen for. Be specific to "${title}", not generic. Avoid restating the skill name.
  - tier: "must" for non-negotiable / employer-screened capabilities a candidate cannot get hired without; "nice" for capabilities that strongly differentiate but are not table-stakes. Aim for 4 to 6 must and 3 to 5 nice. Order within each tier from most to least important.
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
- followUps: a "Go Deeper" map of career-discovery questions. The reader is someone considering whether to pursue or pivot into this career — NOT a practitioner looking for tactical execution depth. Every question must serve the question "is this career right for me, and what would entering it actually be like?" Reject any question that sounds like it belongs in a how-to-do-the-job manual (e.g. "How do you resolve technical disputes with developers?", "Which user-experience metrics matter most?", "What tools do practitioners use?"). Accept questions about fit, accessibility, market reality, lifestyle, ceiling, comparisons to adjacent careers, AI/automation risk, and the felt experience of doing the work.

  For EACH of these seven section keys produce 4 to 5 questions: "overview", "day-to-day", "outlook-us", "outlook-uk", "learning-path-us", "learning-path-uk", "considerations". Every key must be present and non-empty. Each question is a single sentence ending with a question mark, max 90 characters, in the same warm voice as the rest of the guide.

  Section-specific angles (use these as a guide, not a checklist):
  - overview: who the role suits, who it doesn't, how it compares to adjacent careers (e.g. "${title}" vs. its closest neighbour), whether non-traditional backgrounds break in, what the job is fundamentally about beyond its title.
  - day-to-day: what the work actually feels like (energising, draining, social, solitary, reactive, planned), the rhythm of the week, on-call expectations, meeting load, how often the job leaves you on your own with a hard problem.
  - outlook-{us,uk}: hiring reality in that country right now, which industries hire most, AI/automation exposure for this specific role, whether the role is growing or shrinking, geographic concentration, how downturns hit it.
  - learning-path-{us,uk}: country-specific entry routes, whether degrees are required or whether a portfolio works, fastest credible path in, time-to-livable-salary, switching in from unrelated fields, apprenticeship vs. university trade-offs (UK), bootcamp vs. degree (US).
  - considerations: what burns people out, layoff vulnerability, ethical tensions specific to this work, how the job evolves with seniority, what kills passion in 5+ year veterans, what the role looks like in a bad employer.

  Examples of the right voice for "${title}": "Could someone without a marketing background actually break in?", "How exposed is this role to AI replacing the basic work?", "Does this job get more or less interesting as you get senior?". Examples of the WRONG voice: "Which on-page ranking factors matter most?", "How do practitioners handle technical SEO disputes?", "What is the typical fringe-fitting calculation?".

  Skip "skills" and "related" sections — those already function as drill-downs.
- meta: SEO meta tags for the page. Produce all four fields in the same British English voice as the rest of the guide.
  - meta.title: 50 to 60 characters total. Lead with the role and a high-CTR benefit phrase. Do NOT append "career guide" or the site name (the layout adds a site suffix automatically). Use a SERP-CTR pattern such as "Park Ranger Career: Salary, Skills, How to Become One" or "How to Become a Cardiologist: Routes, Pay, Outlook". Title-case the first word and proper nouns.
  - meta.description: 150 to 160 characters. A single complete sentence — no mid-cut, no ellipsis. Lead with what the role does. Ground a number where natural (a representative salary band or a hiring trend signal). Do not start with "Discover" or "Learn about" — pick a concrete, declarative opening.
  - meta.keywords: 8 to 12 short search-intent phrases. Mix head terms (the role title alone, common variants) with tail terms ("how to become a ${title} uk", "${title} salary us", "${title} career path"). Lower-case, no quotes.
  - meta.socialAlt: 1 to 2 sentences describing the role for the OG/Twitter image's alt attribute. Plain English, ends with a full stop. Used by screen readers and platforms that strip the image.
- typicalCareerStage: classify the PRIMARY level this guide describes — the level a reader would first encounter the role at, not the full trajectory. Pick ONE of:
  - "early-career": junior / associate / 0-2 years experience expected. Trainee, apprentice, junior X.
  - "mid-career": individual contributor with 2-7 years experience. Plain titles like "Software Engineer", "Data Engineer", "Therapist", "Nurse", "Teacher".
  - "senior-IC": individual contributor with 7+ years experience, no direct reports. Senior X / Staff X / Principal X / Lead X (when not a people-leader title).
  - "manager": engineering manager, team lead with reports, 3-7 direct reports. "X Manager" titles where management is the primary axis.
  - "director": director / head-of / department lead. 7-15 reports across 1-2 sub-teams.
  - "exec": VP / SVP / C-suite / Chief X Officer / President. Cross-functional executive scope.

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

// ── Grounded content generation ────────────────────────────────────────────
//
// Used when Exa retrieval succeeds for ≥4 enrichment tasks before content
// generation. The model writes prose grounded in fresh research and returns
// `usedSources` — per-field 0-based indexes into the per-field source list
// it actually drew from. The Convex action then materialises citations
// directly from those indexes, so the LLM never invents URLs.
//
// Schema-key shape: kebab-case keys (mirrors FollowUpsSchema's known-good
// pattern). Dotted fieldPaths like "regional.us.salary" map to safe keys
// like "salary-us" via FIELD_PATH_TO_USED_KEY. Per project memory: no
// .int/.min/.max/array-length constraints — Gemini rejects them.

export const FIELD_PATH_TO_USED_KEY: Record<string, string> = {
  "regional.us.salary": "salary-us",
  "regional.uk.salary": "salary-uk",
  "regional.us.careerOutlook": "career-outlook-us",
  "regional.uk.careerOutlook": "career-outlook-uk",
  "regional.us.learningPath": "learning-path-us",
  "regional.uk.learningPath": "learning-path-uk",
  typicalSkills: "typical-skills",
  riskFactors: "risk-factors",
};

const UsedSourcesSchema = z.object({
  "salary-us": z.array(z.number()),
  "salary-uk": z.array(z.number()),
  "career-outlook-us": z.array(z.number()),
  "career-outlook-uk": z.array(z.number()),
  "learning-path-us": z.array(z.number()),
  "learning-path-uk": z.array(z.number()),
  "typical-skills": z.array(z.number()),
  "risk-factors": z.array(z.number()),
});

export const ContentResponseGroundedSchema = ContentResponseSchema.extend({
  usedSources: UsedSourcesSchema,
});
export type ContentResponseGrounded = z.infer<
  typeof ContentResponseGroundedSchema
>;

export type GroundedResearch = {
  answer: string;
  sources: Citation[];
};

export function buildGroundedContentPrompt(
  title: string,
  exaByField: Map<string, GroundedResearch>,
): string {
  const researchBlocks: string[] = [];
  for (const task of ENRICHMENT_TASKS) {
    const usedKey = FIELD_PATH_TO_USED_KEY[task.fieldPath];
    const research = exaByField.get(task.fieldPath);
    if (!research || research.sources.length === 0) {
      researchBlocks.push(
        `### ${task.fieldPath} (usedSources key: "${usedKey}")\n(no fresh research available — write from your own knowledge and return [] for usedSources["${usedKey}"])`,
      );
      continue;
    }
    const sourceList = research.sources
      .map(
        (c, i) =>
          `[${i}] ${c.title} — ${c.url}${c.publisher ? ` (${c.publisher})` : ""}`,
      )
      .join("\n");
    researchBlocks.push(
      `### ${task.fieldPath} (usedSources key: "${usedKey}")\nFresh research:\n${research.answer}\n\nSources (cite by 0-based index into THIS field's list):\n${sourceList}`,
    );
  }

  const groundingPreamble = `
You are writing a grounded career guide. For the fields listed below, FRESH RESEARCH and SOURCES from a recent web search have been retrieved for you. You must use them.

Rules:
- For every grounded field with fresh research, write that field's content from the research below. Do not contradict the cited sources. If your prior knowledge disagrees with the sources, prefer the sources.
- For grounded fields where research is empty, fall back to your own knowledge for that one field and return an empty array for its key in "usedSources".
- Do NOT invent URLs, publishers, or citations. The Convex layer materialises citations from the indexes you return.
- Return a top-level "usedSources" object with ALL eight required keys: "salary-us", "salary-uk", "career-outlook-us", "career-outlook-uk", "learning-path-us", "learning-path-uk", "typical-skills", "risk-factors". Each value is a list of 0-based indexes into THAT field's source list — only the indexes you actually drew from. Use [] if you used none.
- Source indexes are LOCAL to each field. "salary-us"'s [0] is unrelated to "salary-uk"'s [0].

GROUNDED FIELDS:

${researchBlocks.join("\n\n")}

────────────────────────────────────────

Now write the rest of the guide as instructed below. Narrative fields (overview, dayToDay, whyConsider, relatedRoles, followUps) are not grounded and should be written from your own knowledge in the same warm, authoritative voice — no usedSources entry required for them.

`;

  return `${groundingPreamble.trim()}\n\n${buildContentPrompt(title)}`;
}

// ── Meta-only backfill ─────────────────────────────────────────────────────
//
// Used to retroactively produce content.meta for guides created before the
// SEO meta fields existed in ContentResponseSchema. Cheaper than
// regenerating the whole guide — feeds existing content as input and asks
// for just the four meta fields.

export const MetaOnlySchema = z.object({
  meta: ContentMetaSchema,
});
export type MetaOnly = z.infer<typeof MetaOnlySchema>;

export function buildMetaPrompt(args: {
  title: string;
  overview: string;
  typicalSkills: string[];
  riskFactors: string[];
  usSalary: { entry: string; mid: string; senior: string };
  ukSalary: { entry: string; mid: string; senior: string };
  usOutlook: string;
  ukOutlook: string;
  relatedRolesUs: string[];
}): string {
  return `
You are producing SEO meta tags for an existing public career guide on "${args.title}". The guide is already written and published; you are only producing the meta object.

Existing content for context:

OVERVIEW
${args.overview}

TYPICAL SKILLS
${args.typicalSkills.join(", ")}

US SALARY (USD)
entry ${args.usSalary.entry}, mid ${args.usSalary.mid}, senior ${args.usSalary.senior}

UK SALARY (GBP)
entry ${args.ukSalary.entry}, mid ${args.ukSalary.mid}, senior ${args.ukSalary.senior}

US OUTLOOK
${args.usOutlook}

UK OUTLOOK
${args.ukOutlook}

RELATED ROLES (US)
${args.relatedRolesUs.join(", ")}

RISK FACTORS
${args.riskFactors.join("; ")}

Produce the meta object using these rules:
- meta.title: 50 to 60 characters total. Lead with the role and a high-CTR benefit phrase. Do NOT append "career guide" or the site name (the layout adds a site suffix automatically). Use a SERP-CTR pattern such as "Park Ranger Career: Salary, Skills, How to Become One" or "How to Become a Cardiologist: Routes, Pay, Outlook". Title-case the first word and proper nouns.
- meta.description: 150 to 160 characters. A single complete sentence — no mid-cut, no ellipsis. Lead with what the role does. Ground a number where natural (use the existing salary or outlook content above). Do not start with "Discover" or "Learn about" — pick a concrete, declarative opening.
- meta.keywords: 8 to 12 short search-intent phrases. Mix head terms (the role title alone, common variants) with tail terms ("how to become a ${args.title} uk", "${args.title} salary us", "${args.title} career path"). Lower-case, no quotes.
- meta.socialAlt: 1 to 2 sentences describing the role for the OG/Twitter image's alt attribute. Plain English, ends with a full stop.

British English. Avoid em dashes and en dashes. No emoji.
`.trim();
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

// ── Go Deeper: backfill follow-ups for an existing guide ──────────────────

export const FollowUpsBackfillSchema = z.object({
  followUps: FollowUpsSchema,
});
export type FollowUpsBackfill = z.infer<typeof FollowUpsBackfillSchema>;

export function buildFollowUpsBackfillPrompt(args: {
  title: string;
  overview: string;
  dayToDay: string;
  outlookUs: string;
  outlookUk: string;
  learningPathUs: string[];
  learningPathUk: string[];
  riskFactors: string[];
}): string {
  const numbered = (xs: string[]) =>
    xs.map((x, i) => `${i + 1}. ${x}`).join("\n");
  return `
You are extending a public career guide on "${args.title}" by adding "Go Deeper" follow-up questions. The reader is someone considering whether to pursue or pivot into this career — NOT a practitioner looking for tactical execution depth. Every question must serve "is this career right for me, and what would entering it actually be like?"

REJECT any question that belongs in a how-to-do-the-job manual. For "${args.title}", that means rejecting questions like "How do practitioners resolve technical disputes with developers?", "Which on-page ranking factors matter most?", "What tools do they use?", "What does a typical fringe-fitting calculation look like?", "How do you measure success post algorithm update?". Those are practitioner-tactics questions; this is a career-discovery surface.

ACCEPT questions about fit, accessibility, market reality, lifestyle, ceiling, comparisons to adjacent careers, AI/automation risk, and the felt experience of doing the work. Examples of the right voice: "Could someone without a marketing background actually break in?", "How exposed is this role to AI replacing the basic work?", "Does this job get more or less interesting as you get senior?", "What kind of personality burns out fastest here?", "How does this compare to a Content Marketing Manager?".

For EACH of these seven section keys, produce 4 to 5 questions: "overview", "day-to-day", "outlook-us", "outlook-uk", "learning-path-us", "learning-path-uk", "considerations". Every key must be present and non-empty. Each question is a single sentence ending with a question mark, max 90 characters, British English, no emoji, no em/en dashes.

Section-specific angles:
- overview: who the role suits, who it doesn't, how "${args.title}" compares to its closest adjacent career, whether non-traditional backgrounds break in, what the job is really about beyond its title.
- day-to-day: what the work actually feels like (energising, draining, social, solitary, reactive, planned), rhythm of the week, on-call expectations, meeting load, time alone with hard problems.
- outlook-us / outlook-uk: hiring reality in that country today, which industries hire most, AI/automation exposure for THIS role, growing or shrinking, geographic concentration, how downturns hit. Region-specific.
- learning-path-us / learning-path-uk: country-specific entry routes, degree vs. portfolio, fastest credible path in, time to livable salary, switching in from unrelated fields, apprenticeship vs. university (UK) or bootcamp vs. degree (US). Region-specific.
- considerations: what burns people out, layoff vulnerability in downturns, ethical tensions specific to this work, how the job evolves with seniority, what kills passion in 5+ year veterans, what it looks like in a bad employer.

Existing content for context (use this to ground the questions, but DO NOT lift practitioner-tactic threads from it):

OVERVIEW
${args.overview}

DAY TO DAY
${args.dayToDay}

OUTLOOK — UNITED STATES
${args.outlookUs}

OUTLOOK — UNITED KINGDOM
${args.outlookUk}

LEARNING PATH — UNITED STATES
${numbered(args.learningPathUs)}

LEARNING PATH — UNITED KINGDOM
${numbered(args.learningPathUk)}

CONSIDERATIONS
${numbered(args.riskFactors)}
`.trim();
}

// ── Go Deeper (branch generation) ──────────────────────────────────────────
//
// Two paths:
//  - Narrative sections (overview, day-to-day): "inherited" mode. Generate
//    from parent prose + parent citations only, no Exa fan-out.
//  - Fact-heavy sections (outlook-*, learning-path-*, considerations): "exa"
//    mode. Run an Exa search first, then generate with citations.

// Sections that fan out to Exa on first click. Single source of truth —
// imported by convex/guideBranches.ts to route the generation flow.
//
// As of the citation-everywhere change: ALL Go Deeper sections run through
// Exa so every branch carries its own sources. The set is kept for any
// future caller that wants to know which sections are "naturally" fact-heavy
// (vs narrative), but isFactHeavySection now always returns true.
export const FACT_HEAVY_SECTION_IDS: ReadonlySet<string> = new Set([
  "outlook-us",
  "outlook-uk",
  "learning-path-us",
  "learning-path-uk",
  "considerations",
]);

export const isFactHeavySection = (_sectionId: string): boolean => true;

// Friendly labels for the section context shown to the model.
const SECTION_LABELS: Record<string, string> = {
  overview: "Overview — what the role involves",
  "day-to-day": "Day to day — what the work actually looks like",
  "outlook-us": "Career outlook in the United States",
  "outlook-uk": "Career outlook in the United Kingdom",
  "learning-path-us": "Learning path in the United States",
  "learning-path-uk": "Learning path in the United Kingdom",
  considerations: "Honest considerations and risk factors",
};

const formatCitationContext = (citations: Citation[]): string => {
  if (citations.length === 0) return "(no citations attached to parent section)";
  return citations
    .map((c, i) => `[${i + 1}] ${c.title} — ${c.url}${c.publisher ? ` (${c.publisher})` : ""}`)
    .join("\n");
};

export type Citation = {
  url: string;
  title: string;
  publisher?: string;
  fetchedAt: number;
};

export const DeepenAnswerSchema = z.object({
  title: z.string(),
  body: z.string(),
});
export type DeepenAnswer = z.infer<typeof DeepenAnswerSchema>;

export const DeepenAnswerGroundedSchema = z.object({
  title: z.string(),
  body: z.string(),
  // Indexes into the Exa source list (0-based). The model returns the indexes
  // it actually used; we materialise those into the branch's `citations`.
  // No bound constraints (Gemini structured-output rule).
  citationIndexes: z.array(z.number()),
});
export type DeepenAnswerGrounded = z.infer<typeof DeepenAnswerGroundedSchema>;

export function buildDeepenPrompt(args: {
  guideTitle: string;
  sectionId: string;
  sectionProse: string;
  parentCitations: Citation[];
  question: string;
}): string {
  const sectionLabel = SECTION_LABELS[args.sectionId] ?? args.sectionId;
  return `
You are extending a public career guide on "${args.guideTitle}" with a "Go Deeper" branch.

A reader has just finished reading the section labelled: ${sectionLabel}. They have clicked on this follow-up question:

"${args.question}"

Write a short, sharp sub-explainer that opens up exactly that thread, and nothing else. The branch sits inline beneath the original question and should feel like a thoughtful margin note, not a new article.

Section the reader just read:
${args.sectionProse}

Sources already attached to this section (you may reference these factually but you may NOT invent new sources):
${formatCitationContext(args.parentCitations)}

Field guidance:
- title: a concrete, declarative noun phrase that captures the answer (4 to 8 words). Title-case the first word and proper nouns; do not use sentence case. Examples: "The Difference Is Who You're Talking To", "Why The 90-Day Rule Matters", "Where Sales Hands Off". Never restate the question.
- body: 120 to 220 words, two or three short paragraphs separated by a single newline ("\\n"). Specific, vivid, concrete. No bullet lists, no headings inside the body. Write in British English in the same warm, plain voice as the rest of the guide.

Do NOT introduce facts or numbers that are not supported by the parent section's prose or the citations above. If the question genuinely cannot be answered from that material, write a short body that acknowledges the limit and refocuses on what the parent section did establish.

Style: avoid em dashes and en dashes; use commas, colons, or new sentences. No emoji. No marketing voice.
`.trim();
}

export function buildDeepenPromptGrounded(args: {
  guideTitle: string;
  sectionId: string;
  sectionProse: string;
  parentCitations: Citation[];
  exaAnswer: string;
  exaSources: Citation[];
  question: string;
}): string {
  const sectionLabel = SECTION_LABELS[args.sectionId] ?? args.sectionId;
  const exaList = args.exaSources.length === 0
    ? "(no fresh sources)"
    : args.exaSources
        .map((c, i) => `[${i}] ${c.title} — ${c.url}${c.publisher ? ` (${c.publisher})` : ""}`)
        .join("\n");
  return `
You are extending a public career guide on "${args.guideTitle}" with a fact-grounded "Go Deeper" branch.

A reader has just finished reading the section labelled: ${sectionLabel}. They have clicked on this follow-up question:

"${args.question}"

Write a short, sharp sub-explainer that answers exactly that thread, grounded in the fresh research below.

Section the reader just read:
${args.sectionProse}

Sources already attached to the parent section (context only):
${formatCitationContext(args.parentCitations)}

Fresh research from a web search for this specific question:
${args.exaAnswer}

Sources for the fresh research (cite by index — these are 0-based and you must return their indexes in citationIndexes):
${exaList}

Field guidance:
- title: a concrete, declarative noun phrase that captures the answer (4 to 8 words). Examples: "Two Cities Set The UK Floor", "Automation Hits The Junior Tier First". Never restate the question.
- body: 120 to 220 words, two or three short paragraphs separated by a single newline ("\\n"). Specific and grounded. Reference the fresh sources factually (you do not need inline footnotes in the prose itself; the UI will render the source list separately). No bullet lists, no headings inside the body. Write in British English.
- citationIndexes: the 0-based indexes into the "Fresh research" source list above for the sources you actually drew from. Return ONLY indexes you used. Empty array if none of the fresh sources were usable.

If the fresh research is empty, irrelevant, or contradictory, fall back to a short body grounded in the parent section's prose only and return an empty citationIndexes array.

Style: avoid em dashes and en dashes; use commas, colons, or new sentences. No emoji. No marketing voice.
`.trim();
}

export function buildBranchExaQuery(args: {
  guideTitle: string;
  sectionId: string;
  question: string;
}): { query: string; systemPrompt: string } {
  const today = new Date().toISOString().slice(0, 10);
  const region = args.sectionId.endsWith("-us")
    ? "US"
    : args.sectionId.endsWith("-uk")
      ? "UK"
      : null;

  // Section-specific framing so Exa retrieves the right kind of sources.
  if (args.sectionId.startsWith("outlook")) {
    const domains = region === "US" ? US_OUTLOOK_DOMAINS : UK_OUTLOOK_DOMAINS;
    return {
      query: `For a ${args.guideTitle} in the ${region === "US" ? "United States" : "United Kingdom"}: ${args.question} Cite recent figures or named sources.`,
      systemPrompt: `You are researching a follow-up question about ${region} career outlook for a public career guide. Prefer ${domains}. Cite recent employment numbers or trend signals where they exist. Today's date is ${today}.`,
    };
  }
  if (args.sectionId.startsWith("learning-path")) {
    const domains = region === "US" ? US_LEARNING_DOMAINS : UK_LEARNING_DOMAINS;
    return {
      query: `For someone training to become a ${args.guideTitle} in the ${region === "US" ? "United States" : "United Kingdom"}: ${args.question} Cite official routes, qualifications, or named institutions.`,
      systemPrompt: `You are researching a follow-up question about how to train for a career in the ${region}, for a public guide. Prefer ${domains}. Cite official requirements and recognised routes. Today's date is ${today}.`,
    };
  }
  if (args.sectionId === "considerations") {
    return {
      query: `Honest risks, structural challenges, or burnout patterns for ${args.guideTitle}: ${args.question} Cite recent labour-market reports, surveys, or industry pieces.`,
      systemPrompt: `You are researching honest considerations for a public career guide. Cite from labour-market reports, industry trend pieces, and reputable workplace surveys. Today's date is ${today}.`,
    };
  }
  if (args.sectionId === "overview") {
    return {
      query: `For people working as a ${args.guideTitle}: ${args.question} Cite recent industry context, employment patterns, or comparison to adjacent roles.`,
      systemPrompt: `You are researching a question about who a ${args.guideTitle} role suits and what it broadly involves, for a public career guide. Prefer authoritative careers, labour-market, and industry sources. Today's date is ${today}.`,
    };
  }
  if (args.sectionId === "day-to-day") {
    return {
      query: `What the day-to-day work of a ${args.guideTitle} actually looks like: ${args.question} Cite practitioner accounts, workplace surveys, or industry reports.`,
      systemPrompt: `You are researching a question about the lived experience of working as a ${args.guideTitle}, for a public career guide. Prefer practitioner accounts, professional bodies, workplace surveys, and trade publications. Today's date is ${today}.`,
    };
  }
  // Generic fallback for any future section.
  return {
    query: `In the context of working as a ${args.guideTitle}: ${args.question}`,
    systemPrompt: `You are researching a follow-up question for a public career guide. Cite recent, reputable sources. Today's date is ${today}.`,
  };
}

// ── Career-stage classification ───────────────────────────────────────────
//
// Single-field classifier that tags an existing guide with its typical career
// stage. Drives the discover canvas's 4-lane bucketing (next-steps / sideways
// / earlier-chapters / a-different-chapter) by comparing this against the
// user's profile_enrichments.careerStage. Vocabulary mirrors the enrichment
// stage minus "transitioning" — guides describe destinations, not transitions.
//
// Per project memory `feedback_gemini_structured_output_schema_limits`: the
// schema avoids constraints (no .min/.max/.int/array-length) so Gemini's
// structured output accepts it cleanly. The rubric encodes the gradations.

export const CareerStageSchema = z.object({
  typicalCareerStage: z.union([
    z.literal("early-career"),
    z.literal("mid-career"),
    z.literal("senior-IC"),
    z.literal("manager"),
    z.literal("director"),
    z.literal("exec"),
  ]),
});
export type CareerStageClassification = z.infer<typeof CareerStageSchema>;

// Flash tier — short-form classification, latency-friendly. Same model
// family as VALIDATION/BRANCH for consistency.
export const CAREER_STAGE_MODEL_ID = "google/gemini-3-flash-preview";

export function buildCareerStagePrompt(args: {
  title: string;
  dayToDay: string;
  entrySalary?: string;
  midSalary?: string;
  seniorSalary?: string;
}): string {
  return `Classify this career role's typical career stage based on the role description.

ROLE: ${args.title}
DAY-TO-DAY: ${args.dayToDay}
SALARY BANDS: entry=${args.entrySalary ?? "n/a"}, mid=${args.midSalary ?? "n/a"}, senior=${args.seniorSalary ?? "n/a"}

Rubric — what's the PRIMARY level this role describes?
- "early-career": junior / associate / 0-2 years experience expected. Trainee, apprentice, junior X.
- "mid-career": individual contributor with 2-7 years experience. Plain titles like "Software Engineer", "Data Engineer", "Therapist", "Nurse", "Teacher".
- "senior-IC": individual contributor with 7+ years experience, no direct reports. Senior X / Staff X / Principal X / Lead X (when not a people-leader title).
- "manager": engineering manager, team lead with reports, 3-7 direct reports. "X Manager" titles where management is the primary axis.
- "director": director / head-of / department lead. 7-15 reports across 1-2 sub-teams.
- "exec": VP / SVP / C-suite / Chief X Officer / President. Cross-functional executive scope.

Pick ONE classification — the level a generalist reading this guide would FIRST encounter the role at, not the entire career trajectory.`;
}

// ── Skills-detail backfill ────────────────────────────────────────────────
//
// Retroactively produces typicalSkillsDetail for guides created before the
// rich tiered-skills shape existed. Takes the existing typicalSkills array
// as input and returns a same-length array enriched with rationale + tier.

export const SkillsDetailOnlySchema = z.object({
  typicalSkillsDetail: z.array(
    z.object({
      name: z.string(),
      rationale: z.string(),
      tier: z.enum(["must", "nice"]),
    }),
  ),
});
export type SkillsDetailOnly = z.infer<typeof SkillsDetailOnlySchema>;

export function buildSkillsDetailPrompt(args: {
  title: string;
  typicalSkills: string[];
}): string {
  return `
You are enriching the skills section of an existing public career guide for "${args.title}". The guide already lists the skills below in importance order. Your job is to expand each into a tiered, rationale-backed entry.

EXISTING SKILLS (in importance order)
${args.typicalSkills.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Return a typicalSkillsDetail array that:
- Contains exactly the same names as the input, in the same order. Do not rename, add, remove, merge, or reword any entry. Match each input string verbatim in the "name" field.
- For each skill, write a rationale of 1 to 2 sentences (max ~25 words) explaining concretely why this skill matters specifically for "${args.title}" — what it unlocks day-to-day, what fails without it, or what employers screen for. Be specific, not generic. Do not restate the skill name as the rationale.
- Tag each skill with a tier:
  - "must" = non-negotiable / employer-screened capabilities a candidate cannot get hired without.
  - "nice" = capabilities that strongly differentiate but are not table-stakes.
  - The earlier-listed skills are more likely to be must-haves; later-listed skills are more likely to be nice-to-haves. Use judgment, but aim for 4 to 6 must and 3 to 5 nice across the full list.

Style: British English. Avoid em dashes and en dashes. Be concrete and insightful.
`.trim();
}
