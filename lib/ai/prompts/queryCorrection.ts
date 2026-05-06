import { z } from "zod";

// Typo correction for the job-search bar. Runs server-side before the cache
// lookup so that a corrected query benefits from any cached results under
// its corrected form. Cached forever per inputNormalized in the
// `query_corrections` Convex table — first-time-typo searches pay one Flash
// call, subsequent identical searches are free.

export const JOB_QUERY_CORRECTION_MODEL_ID = "google/gemini-3-flash-preview";

// ── Output schema ─────────────────────────────────────────────────────────
//
// No bound constraints on confidence (e.g. .min(0).max(1)) because Gemini
// structured output rejects them — see project memory "Gemini structured
// output rejects bound/array-length constraints". The action clamps after
// parsing.

export const QueryCorrectionSchema = z.object({
  corrected: z
    .string()
    .describe(
      "The corrected query. If the input is already fine, return it unchanged.",
    ),
  hadTypo: z
    .boolean()
    .describe(
      "True only if you actually changed something. Set to false when " +
        "returning the input unchanged.",
    ),
  confidence: z
    .number()
    .describe(
      "Your confidence in the correction (0.0 to 1.0). Use 1.0 when the " +
        "input is unchanged, 0.9+ for obvious typos, lower when uncertain.",
    ),
});

export type QueryCorrection = z.infer<typeof QueryCorrectionSchema>;

// ── System prompt ─────────────────────────────────────────────────────────

export const CORRECTION_SYSTEM_PROMPT = [
  "You are a typo corrector for a job search bar. Be conservative.",
  "",
  "RULES:",
  "1. Only fix obvious typos: missing letters, swapped letters, common misspellings of well-known job titles.",
  "2. NEVER expand abbreviations. Leave 'PM', 'SWE', 'ML', 'QA', 'UX', 'AI' exactly as typed.",
  "3. NEVER 'improve' or expand the search. Don't change 'engineer' to 'software engineer', or 'manager' to 'product manager'.",
  "4. NEVER rephrase. Keep the user's word order and intent.",
  "5. NEVER change brand names, company names, or proper nouns you don't recognise.",
  "6. When in doubt, leave the input unchanged with hadTypo: false and confidence: 1.0.",
  "",
  "EXAMPLES:",
  "  'softwre engineer'    → { corrected: 'software engineer', hadTypo: true, confidence: 0.95 }",
  "  'product manger'      → { corrected: 'product manager',   hadTypo: true, confidence: 0.95 }",
  "  'pyhton developer'    → { corrected: 'python developer',  hadTypo: true, confidence: 0.95 }",
  "  'product manager'     → { corrected: 'product manager',   hadTypo: false, confidence: 1.0 }",
  "  'PM'                  → { corrected: 'PM',                hadTypo: false, confidence: 1.0 }  // do not expand",
  "  'engineer'            → { corrected: 'engineer',          hadTypo: false, confidence: 1.0 }  // do not improve",
  "  'Brex platform engineer' → { corrected: 'Brex platform engineer', hadTypo: false, confidence: 1.0 }  // brand intact",
  "  'data scintist'       → { corrected: 'data scientist',    hadTypo: true, confidence: 0.95 }",
].join("\n");

// ── Pure helpers ──────────────────────────────────────────────────────────

const NON_ALNUM_OR_SPACE = /[^a-z0-9\s]/g;

export function normalizeQueryForCorrectionCache(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

// Skip the LLM for inputs where there's nothing to correct. Avoids burning
// Flash calls on the obviously-unhelpful (1-char inputs, pure numerics, etc).
export function shouldCorrect(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 3) return false;
  // No letters at all → nothing to correct.
  if (!/[a-z]/i.test(trimmed)) return false;
  return true;
}

export function buildCorrectionPrompt(input: string): string {
  return [
    "Correct the following job-search query if it contains an obvious typo.",
    "Otherwise return it unchanged. Output JSON matching the schema.",
    "",
    `Input: ${input.length > 0 ? input : "(empty)"}`,
  ].join("\n");
}
