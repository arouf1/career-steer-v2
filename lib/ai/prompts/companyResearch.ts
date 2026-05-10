import { z } from "zod";
import { EDITORIAL_VOICE_TAIL } from "./voice";

// Sub-project 5 of the jobs feature. Two tightly-related but separate
// pipelines:
//
//   1. Per-company research: culture + financials. One row per company.
//   2. Per-(company, role-archetype) research: interview process + comp
//      specifics for THIS role at THIS company.
//
// Both follow the career-guides "grounded synthesis" pattern verbatim:
//   - upstream Exa.answer calls produce { answer, sources[] } per field
//   - the LLM receives the answers + indexed sources
//   - the LLM emits prose + per-field source-index lists (`usedSources`)
//   - the action materialises Citation[] per field from those indexes
// This guarantees no fabricated URLs and lets the page render per-section
// citations exactly like /career-guides/[slug] does.

// ── Shared types ──────────────────────────────────────────────────────────

export type ResearchSource = {
  url: string;
  title: string;
  fetchedAt: number;
  publisher?: string;
};

export type GroundedResearch = {
  answer: string;
  sources: ResearchSource[];
};

// ── Output schemas ────────────────────────────────────────────────────────
//
// Bound constraints (.min/.max/.length on strings or arrays) are deliberately
// omitted because Gemini structured output rejects them, see project memory
// "Gemini structured output rejects bound/array-length constraints".

export const CompanyResearchSchema = z.object({
  culture: z
    .union([z.string(), z.null()])
    .describe(
      "60-120 word paragraph on the company's culture: how they work, what " +
        "they're known for internally, what people who've worked there say. " +
        "Anchored in the provided sources. RETURN NULL if no usable culture " +
        "research was provided.",
    ),
  financials: z
    .union([z.string(), z.null()])
    .describe(
      "40-100 word paragraph summarising recent funding, revenue, headcount, " +
        "or other financial signals. Anchored in the provided sources. " +
        "RETURN NULL if no usable financials research was provided.",
    ),
  usedSources: z
    .object({
      culture: z.array(z.number()),
      financials: z.array(z.number()),
    })
    .describe(
      "For each field, the indexes (0-based) of the sources you actually " +
        "drew on for that field. NEVER invent sources or use indexes that " +
        "weren't supplied to you.",
    ),
});

export type CompanyResearch = z.infer<typeof CompanyResearchSchema>;

export const CompanyRoleResearchSchema = z.object({
  interview: z
    .union([z.string(), z.null()])
    .describe(
      "60-150 word paragraph describing the interview process for THIS role " +
        "at THIS company. Format, number of rounds, what to expect. RETURN " +
        "NULL if research is too thin to summarise without inventing.",
    ),
  compensation: z
    .union([z.string(), z.null()])
    .describe(
      "40-120 word paragraph summarising compensation for THIS role at THIS " +
        "company: bands, equity, bonus, anything specific. RETURN NULL if " +
        "research is too thin.",
    ),
  usedSources: z
    .object({
      interview: z.array(z.number()),
      compensation: z.array(z.number()),
    })
    .describe(
      "For each field, the indexes (0-based) of the sources you actually " +
        "drew on for that field. NEVER invent sources or use indexes that " +
        "weren't supplied to you.",
    ),
});

export type CompanyRoleResearch = z.infer<typeof CompanyRoleResearchSchema>;

// ── System prompt (shared across both pipelines) ──────────────────────────

export const COMPANY_RESEARCH_SYSTEM_PROMPT = [
  "You are a careers analyst writing factual, grounded summaries.",
  "",
  "RULES:",
  "1. Every claim must be supported by a source you were given.",
  "2. Cite by returning the source indexes you used in `usedSources.{field}`.",
  "3. If the research provided isn't enough to summarise a field without inventing, return null for that field and an empty index list.",
  "4. Never invent funding figures, headcounts, interview formats, or comp ranges. Never hallucinate.",
  "5. Be concise, these summaries appear as small panels next to the main job posting, not as standalone articles.",
  "6. Plain prose. No bullet lists. No markdown.",
  "",
  EDITORIAL_VOICE_TAIL,
].join("\n");

// ── Per-field input rendering ─────────────────────────────────────────────

function renderField(
  fieldKey: string,
  research: GroundedResearch | undefined,
): string {
  if (!research || research.sources.length === 0) {
    return [
      `## ${fieldKey}`,
      `(no research available for this field, return null in your output)`,
      "",
    ].join("\n");
  }
  const sources = research.sources
    .map((s, i) => `[${i}] ${s.title}, ${s.url}`)
    .join("\n");
  return [
    `## ${fieldKey}`,
    "Research:",
    research.answer,
    "",
    "Sources you can cite (return indexes in usedSources):",
    sources,
    "",
  ].join("\n");
}

// ── Prompt builders ───────────────────────────────────────────────────────

export type CompanyResearchInput = {
  companyName: string;
  researchByField: Partial<Record<"culture" | "financials", GroundedResearch>>;
};

export function buildCompanyResearchPrompt(
  input: CompanyResearchInput,
): string {
  return [
    `Company: ${input.companyName}`,
    "",
    "You're writing a short, sourced summary of this company for a careers page.",
    "Use ONLY the research provided. If a field has no usable research, return null for that field.",
    "",
    renderField("culture", input.researchByField.culture),
    renderField("financials", input.researchByField.financials),
    "Return ONLY the JSON object matching the schema. No prose before or after.",
  ].join("\n");
}

export type CompanyRoleResearchInput = {
  companyName: string;
  roleTitle: string;
  researchByField: Partial<
    Record<"interview" | "compensation", GroundedResearch>
  >;
};

export function buildCompanyRolePrompt(
  input: CompanyRoleResearchInput,
): string {
  return [
    `Company: ${input.companyName}`,
    `Role: ${input.roleTitle}`,
    "",
    "You're writing a short, sourced summary of how interviews and compensation",
    "work for THIS specific role at THIS specific company. Use ONLY the research",
    "provided. If a field has no usable research, return null for that field.",
    "",
    renderField("interview", input.researchByField.interview),
    renderField("compensation", input.researchByField.compensation),
    "Return ONLY the JSON object matching the schema. No prose before or after.",
  ].join("\n");
}
