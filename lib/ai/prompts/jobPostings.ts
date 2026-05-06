import { z } from "zod";

// Sub-project 2 of the jobs-feature decomposition: rewrite a raw SearchAPI
// posting into sectioned prose in our voice. Used by
// convex/jobPostingsContent.ts:_rewriteContent.
//
// Model: Gemini 3 Flash. Paraphrasing job descriptions to a fixed schema is
// exactly the structured-extraction tier the project's other Flash callers
// occupy (BRANCH_MODEL_ID, VALIDATION_MODEL_ID, PERSONALIZATION_MODEL_ID,
// PEOPLE_EXTRACT_MODEL_ID, CANONICAL_MODEL_ID). Pro would burn reasoning
// tokens on a task that doesn't need reasoning.

export const JOB_REWRITE_MODEL_ID = "google/gemini-3-flash-preview";

// ── Output schema ─────────────────────────────────────────────────────────
//
// Bound constraints (.min/.max/.length on strings or arrays) are deliberately
// omitted because Gemini structured output rejects them — see project memory
// "Gemini structured output rejects bound/array-length constraints". Word
// budgets and array sizes are enforced via the prompt copy.

export const JobPostingContentSchema = z.object({
  overview: z.string().describe(
    "A short, energising 80–120 word summary of the role. Plain prose, no " +
      "lists. Reads as if a recruiter we trust is pitching the job to a " +
      "candidate. Names the company and the role plainly.",
  ),
  theRole: z.string().describe(
    "About 150 words on day-to-day at THIS company. Concrete responsibilities, " +
      "team shape if known, surface area. Avoid generic 'you will…' boilerplate; " +
      "anchor in specifics from the source posting.",
  ),
  whatStandsOut: z
    .array(z.string())
    .describe(
      "3 to 5 short bullets capturing what makes this listing distinctive — " +
        "stack, perks, mission, scope, salary band, hiring stage, anything " +
        "that makes a reader stop scrolling. Each bullet is one sentence.",
    ),
  idealCandidate: z.string().describe(
    "About 80 words sketching who would thrive here. Concrete signals " +
      "(experience years, prior surface area, technical or domain familiarity). " +
      "Inclusive language; no 'must have X years' rigidity.",
  ),
  compSummary: z
    .union([z.string(), z.null()])
    .describe(
      "1–3 sentences summarising compensation when the source posting " +
        "discloses it. Includes the figure, currency, and any meaningful " +
        "context (band, equity, bonus). RETURN NULL when no salary is " +
        "disclosed in the source — do NOT invent figures or pull from " +
        "general knowledge.",
    ),
  metaTitle: z.string().describe(
    "SEO page title, 50–60 characters. Pattern: '{Role} at {Company} — {Hook}'. " +
      "The hook is location, salary, or work-arrangement when it adds value. " +
      "Avoid clickbait.",
  ),
  metaDescription: z.string().describe(
    "SEO meta description, 150–160 characters. One sentence. Compels a click " +
      "without overpromising; mentions the role, company, and one " +
      "differentiator.",
  ),
  socialAlt: z.string().describe(
    "Alt text for the hero image (generated separately). Describes what would " +
      "ideally be in the image given the role + company context. One short " +
      "sentence, descriptive not interpretive.",
  ),
});

export type JobPostingContent = z.infer<typeof JobPostingContentSchema>;

// ── Prompts ──────────────────────────────────────────────────────────────

export const REWRITE_SYSTEM_PROMPT = [
  "You are a careers editor for a high-quality job board.",
  "Your task: paraphrase a job posting into clean, sectioned prose in our voice.",
  "",
  "RULES:",
  "1. Rewrite. Do not copy phrases verbatim from the source posting.",
  "2. Never invent facts. If the source posting doesn't say something, leave it out.",
  "   Never make up salaries, perks, team sizes, technologies, or interview steps.",
  "3. Be specific. Anchor every claim in something the source posting actually says.",
  "4. Be inclusive. Avoid 'rockstar' / 'ninja' / 'must-have'-style rigidity.",
  "5. Be concise. Respect the per-section word and character budgets.",
  "6. No emoji. No marketing fluff. No 'we're a fast-paced team' clichés.",
  "7. The reader is a job-seeker scanning quickly. Lead with substance.",
].join("\n");

export type RewriteInput = {
  title: string;
  companyName: string;
  location: string;
  city: string;
  rawDescription: string;
  salary: string | null;
  schedule: string | null;
  postedAt: string | null;
  workFromHome: boolean | null;
};

export function buildRewritePrompt(input: RewriteInput): string {
  // Build the source-posting block. Skip lines whose value is null/undefined
  // so the prompt never contains literal "null" or "undefined" strings — that
  // confuses the model and pollutes outputs.
  const lines: string[] = [
    `Role: ${input.title}`,
    `Company: ${input.companyName}`,
    `Location: ${input.location}`,
    `City: ${input.city}`,
  ];
  if (input.schedule) lines.push(`Schedule: ${input.schedule}`);
  if (input.postedAt) lines.push(`Posted: ${input.postedAt}`);
  if (input.workFromHome === true) {
    lines.push("Work arrangement: remote (or remote-friendly).");
  }
  if (input.salary) {
    lines.push(`Salary disclosed in source: ${input.salary}`);
  } else {
    lines.push(
      "Salary disclosed in source: NOT DISCLOSED — return null for compSummary.",
    );
  }
  lines.push("");
  lines.push("--- BEGIN SOURCE POSTING ---");
  lines.push(input.rawDescription || "(no description provided)");
  lines.push("--- END SOURCE POSTING ---");

  const guidance = [
    "",
    "Rewrite this posting into the JSON schema you've been given. Bounds:",
    "",
    "- overview: 80–120 words. Plain prose.",
    "- theRole: about 150 words. Day-to-day at THIS company, anchored in specifics.",
    "- whatStandsOut: 3 to 5 bullets. One sentence each. Most distinctive items first.",
    "- idealCandidate: about 80 words. Who would thrive here.",
    "- compSummary: 1–3 sentences IF salary is disclosed; otherwise null.",
    "- metaTitle: 50–60 characters.",
    "- metaDescription: 150–160 characters.",
    "- socialAlt: one short descriptive sentence for the hero image.",
    "",
    "Return ONLY the JSON object matching the schema. No prose before or after.",
  ].join("\n");

  return [...lines, guidance].join("\n");
}
