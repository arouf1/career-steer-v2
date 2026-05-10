import { z } from "zod";
import { EDITORIAL_VOICE_TAIL } from "./voice";

// Re-exported model id for convenience, same Gemini Flash tier we use for
// validation / branch / career-stage classification surfaces. Flash because
// these are short-form classifications where latency matters more than the
// last percentage point of nuance.
export const LADDER_CLASSIFY_MODEL_ID = "google/gemini-3-flash-preview";

// Schemas: bound-free per project memory (Gemini structured output rejects
// .min/.max/.int/array-length constraints).

// Same vocabulary as the schema's `career_guide_ladder_positions.tier` and
// the runtime helpers in `convex/lib/ladders.ts`. Kept in sync by hand -
// adding a tier means three edits (schema, helper, prompt).
export const TierLiteral = z.enum([
  "ic-entry",
  "ic-mid",
  "ic-senior",
  "manager",
  "head",
  "director",
  "vp",
  "c-suite",
]);

export const ConfidenceLiteral = z.enum(["high", "medium", "low"]);

// ── Backfill: given an existing guide, place it on a ladder ─────────────

export const LadderAssignmentSchema = z.object({
  primaryLadder: z.object({
    slug: z.string(),
    rung: z.number(),
    tier: TierLiteral,
    confidence: ConfidenceLiteral,
  }),
  // Cross-cutting roles get a secondary placement. Most guides have only one.
  // Example: an "Engineering Manager" guide is on the Engineering ladder
  // (rung manager) AND on the People-Management ladder (rung manager).
  secondaryLadder: z
    .object({
      slug: z.string(),
      rung: z.number(),
      tier: TierLiteral,
      confidence: ConfidenceLiteral,
    })
    .nullable(),
  reasoning: z.string(),
});
export type LadderAssignment = z.infer<typeof LadderAssignmentSchema>;

export type LadderRungSnapshot = {
  rung: number;
  tier: string;
  // All guides currently placed at this rung. Most rungs hold one guide;
  // some hold several (Frontend Engineer + Backend Engineer + Mobile
  // Engineer all share engineering ladder rung "ic-mid", for example).
  guides: { title: string; slug: string }[];
};

export type LadderForPrompt = {
  slug: string;
  name: string;
  family: string;
  description: string;
  // The rungs that currently exist on this ladder. Empty array means the
  // ladder has been seeded but no guides have been placed yet.
  occupiedRungs: LadderRungSnapshot[];
};

function formatLadderList(ladders: LadderForPrompt[]): string {
  if (ladders.length === 0) return "(no ladders defined)";
  return ladders
    .map((l) => {
      const rungs =
        l.occupiedRungs.length === 0
          ? "  (no occupied rungs yet)"
          : l.occupiedRungs
              .sort((a, b) => a.rung - b.rung)
              .map((r) => {
                const guides = r.guides
                  .map((g) => `"${g.title}" [${g.slug}]`)
                  .join(", ");
                return `  rung ${r.rung} (${r.tier}): ${guides}`;
              })
              .join("\n");
      return `### ${l.slug}, ${l.name} (family: ${l.family})\n${l.description}\n${rungs}`;
    })
    .join("\n\n");
}

export function buildLadderAssignmentPrompt(args: {
  guideTitle: string;
  guideOverview: string;
  guideTypicalCareerStage: string | undefined;
  ladders: LadderForPrompt[];
}): string {
  return `You are placing a career guide onto a career ladder.

A "ladder" is a coherent vertical progression within a profession (e.g. Product Management goes APM → PM → Senior PM → Head of Product → Director of Product → VP Product → CPO). Each rung on a ladder represents one altitude, a specific role title at a specific scope. The same role can exist on multiple ladders when it sits at a crossroads (Engineering Manager belongs to both the Engineering ladder AND the People-Management ladder).

You must pick the best primary ladder for this guide. If the guide is genuinely cross-cutting (a manager-track or director-track role that spans two ladders), also pick a secondary ladder. Most guides have only a primary.

GUIDE TO PLACE
Title: "${args.guideTitle}"
Overview: ${args.guideOverview.slice(0, 600)}
${args.guideTypicalCareerStage ? `Stored typicalCareerStage: ${args.guideTypicalCareerStage}` : "Stored typicalCareerStage: (not classified yet)"}

EXISTING LADDERS (with already-placed rungs as guidance for tier altitude)
${formatLadderList(args.ladders)}

RULES
- Pick a ladder slug that EXISTS in the list above. Do not invent a new ladder slug.
- "rung" is a 0-indexed integer for the role's altitude on that ladder. If the same tier is already occupied on the ladder by another guide, pick the same rung number, multiple guides can occupy the same rung when they're alternate flavours of the role.
- "tier" is the human-readable altitude label. Pick from: ic-entry, ic-mid, ic-senior, manager, head, director, vp, c-suite.
- Tier rubric:
  - "ic-entry": Junior X, Associate X, Trainee X, 0 to 2 years of experience expected.
  - "ic-mid": plain titles like "X", individual contributor with 2 to 7 years.
  - "ic-senior": Senior X, Staff X, Principal X, Lead X (when a non-people-leader title), 7+ years IC.
  - "manager": "X Manager" titles where management is the primary axis. Typically 3-7 reports.
  - "head": "Head of X", typically 7-15 reports across 1-2 sub-teams. ALWAYS distinct from "X Manager" and from "Director of X".
  - "director": "Director of X", typically a department lead with multiple manager reports. ALWAYS distinct from Head and from VP.
  - "vp": "VP of X" / "Vice President X", multi-team executive scope.
  - "c-suite": "Chief X Officer" / "President" / "CEO" / "CFO" / "CTO" / "CPO" / "CMO", cross-functional executive scope.
- Pick the LOWEST tier that genuinely fits, don't inflate. Plain "Software Engineer" is ic-mid, not ic-senior.
- "confidence":
  - "high", you are sure of both ladder and tier.
  - "medium", ladder is right but tier is borderline (e.g. a Senior X might be ic-senior or manager depending on team composition).
  - "low", you cannot place with confidence; flag for human review.
- "secondaryLadder" is null UNLESS the role genuinely spans two ladders. Examples:
  - Engineering Manager → primary: engineering, secondary: people (cross-cutting people-management).
  - Product Marketing Manager → primary: marketing, secondary: product (cross-cutting product/marketing).
  - Sales Director → primary: sales, secondary: people (if it manages people).
- "reasoning", one short sentence explaining the placement.

When in doubt about ladder family fit, prefer placing on the most specialised ladder (Frontend Engineer → engineering, not "other") and use confidence: "medium" rather than picking "other".

${EDITORIAL_VOICE_TAIL}`;
}

// ── On-demand: given a single user-typed query, place it on a ladder ────

export const LadderLookupSchema = z.object({
  ladderSlug: z.string(),
  rung: z.number(),
  tier: TierLiteral,
  // True iff the suggested rung is ALREADY occupied by an existing guide
  // (i.e. real dedup case). False when the rung is empty (the user's query
  // names a brand-new rung that should be created on this ladder).
  isExistingRung: z.boolean(),
  matchedGuideSlug: z.string().nullable(),
  // The FULL canonical title for the role at this rung, what the new guide
  // should be named, with all acronyms expanded ("CPO" → "Chief Product
  // Officer", "VP Marketing" → "Vice President of Marketing"). The caller
  // uses this verbatim as the guide title so on-demand creations are never
  // titled with a raw acronym, regardless of what the user typed.
  canonicalTitle: z.string(),
  confidence: ConfidenceLiteral,
  reasoning: z.string(),
});
export type LadderLookup = z.infer<typeof LadderLookupSchema>;

export function buildLadderLookupPrompt(args: {
  query: string;
  ladders: LadderForPrompt[];
}): string {
  return `You are routing a user's career-guide search query to a career ladder. The user typed a job title and we need to know:
1. Which ladder does this title belong to?
2. At what rung (altitude) does it sit?
3. Does an existing guide already occupy that rung?

If a guide already occupies the rung that matches the user's query, return its slug, the user gets routed to it (real dedup). If no guide occupies that rung yet, return isExistingRung=false, a brand-new guide will be created and attached to that ladder at the suggested rung.

USER QUERY: "${args.query}"

EXISTING LADDERS (with already-placed rungs)
${formatLadderList(args.ladders)}

RULES
- Pick a ladder slug that EXISTS in the list above. Never invent a new ladder slug.
- Pick the tier the user's title lives at (rubric below). Tier is the same vocabulary used by every ladder.
- "isExistingRung": true only if the user's query refers to the SAME role as a guide already shown above. Two roles are the same if they describe the same scope, function, and altitude (e.g. "Senior Software Engineer" vs an existing "Software Engineer" guide is NOT the same, different altitude, return isExistingRung=false unless a Senior SWE guide already exists). "Head of Product" vs "Product Manager" is NEVER the same, they are different altitudes on the same ladder.
- "matchedGuideSlug": when isExistingRung=true, the slug of the matching guide. When false, null.
- "canonicalTitle": the FULL, properly-capitalised, expanded job title for the rung the query refers to. ALWAYS expand acronyms and short forms here so the new guide is never titled with a raw acronym. Examples:
    "CPO" → "Chief Product Officer"
    "VP Marketing" → "Vice President of Marketing"
    "CEO" → "Chief Executive Officer"
    "CFO" → "Chief Financial Officer"
    "CTO" → "Chief Technology Officer"
    "CMO" → "Chief Marketing Officer"
    "CHRO" → "Chief Human Resources Officer"
    "CRO" → "Chief Revenue Officer"
    "PM" → "Product Manager"
    "PMM" → "Product Marketing Manager"
    "SDR" → "Sales Development Representative"
    "AE" → "Account Executive"
    "CSM" → "Customer Success Manager"
    "SWE" → "Software Engineer"
    "SRE" → "Site Reliability Engineer"
    "FP&A Manager" → "Financial Planning and Analysis Manager"
    "QA Engineer" → "Quality Assurance Engineer"
    "UX Designer" → "User Experience Designer"
    "Head of Product" stays "Head of Product"
    "Director of Engineering" stays "Director of Engineering"
  Use judgement when an acronym is the established industry-standard term that would feel awkward expanded ("AI", "ML", "DevOps", "QA" inside "QA Engineer" stays as the leading word but "QA Engineer" still expands to "Quality Assurance Engineer" because the full form is genuinely the canonical title). When in doubt, expand.
- Tier rubric (same vocabulary as the ladder placement):
  - ic-entry: Junior / Associate / Trainee.
  - ic-mid: plain title (Software Engineer, Designer, Marketing Manager).
  - ic-senior: Senior / Staff / Principal / Lead (IC).
  - manager: "X Manager", primary axis is management.
  - head: "Head of X", distinct from manager AND director.
  - director: "Director of X".
  - vp: "VP / Vice President".
  - c-suite: "Chief X Officer" / "President" / single-letter C-titles (CEO/CTO/CFO/CMO/CPO).
- "confidence":
  - "high", clear ladder + tier match. The next caller will trust this and act on it.
  - "medium", ladder is right but tier or specialisation is uncertain.
  - "low", cannot route; the caller will fall back to alternative dedup logic.
- "reasoning", one short sentence.

Default-direction principle: when a user types a leadership-tier title (Head of / Director of / VP / Chief), they almost certainly want a NEW guide for that altitude. Do NOT collapse it into the IC role they oversee. "Head of Product" → never matches an existing "Product Manager" guide.`;
}
