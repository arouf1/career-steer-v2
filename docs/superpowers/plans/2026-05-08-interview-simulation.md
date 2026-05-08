# Interview Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-tap mock-interview feature on every job listing — Gemini Live realtime call grounded in real research about how the company interviews for that role, followed by a structured rubric graded against company-specific anchors.

**Architecture:** New `surface: "interview_job"` discriminator on the existing `voice_calls` table. Two new Convex modules (`interviewSim.ts` V8, `interviewSimNode.ts` Node) own the new lifecycle; existing `voiceCalls.appendMessage` and `voiceCalls.finalize` are reused. Research synthesizes 5 parallel Exa queries into one `generateText` + `Output.object` call against Gemini 3.1 Pro on OpenRouter, persisted to `company_role_research.interviewBundle` (30-day TTL) plus `company_research.recentNews` (7-day TTL). Live interview prompt enables Gemini's `googleSearch` tool. Post-call rubric enforces verbatim-quote citations against the transcript.

**Tech Stack:** Convex (V8 + Node runtimes), `@google/genai` (Gemini Live), AI SDK v6 + `@openrouter/ai-sdk-provider`, Zod 4, `exa-js`, Next.js 16 App Router, React 19, shadcn/ui + Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-08-interview-simulation-design.md`

---

## File map

**New files:**
- `convex/interviewSim.ts` — V8 surface: context loader, status doc helpers, `_createInterviewSession`, `_setPrepStatus`, `subscribeToPrep`
- `convex/interviewSimNode.ts` — Node surface: `mintInterviewSession` (entry), `_synthesizeInterviewResearch`, `processInterviewAnalysis`
- `convex/lib/interviewResearch.ts` — Exa query builders + parallel-fetch helper (pure, testable)
- `lib/ai/prompts/interviewer.ts` — `InterviewSynthesisSchema`, `InterviewRubricSchema`, prompt builders, helper to run the rubric with verbatim-quote retries
- `convex/interviewSim.test.ts` — Vitest tests for synthesis + rubric prompt mechanics
- `convex/lib/interviewResearch.test.ts` — Vitest tests for query builders
- `components/jobs/voice/interview/InterviewSimCallTile.tsx` — listing CTA tile
- `components/jobs/voice/interview/InterviewSimDialog.tsx` — modal with all 3 phases
- `components/jobs/voice/interview/InterviewPrepProgress.tsx` — Phase 1 UI
- `components/jobs/voice/interview/InterviewLiveCall.tsx` — Phase 2 UI (wraps useInterviewCall)
- `components/jobs/voice/interview/InterviewFeedback.tsx` — Phase 3 UI
- `components/jobs/voice/interview/useInterviewCall.ts` — cloned hook (mints from `interviewSimNode.mintInterviewSession`)

**Modified files:**
- `convex/schema.ts` — additive optionals on `voice_calls`, `company_role_research`, `company_research`
- `convex/voiceCalls.ts` — extend `messageValidator` with `groundingCitations`; branch `finalize` dispatcher on `surface === "interview_job"`
- `components/jobs/JobPostingArticle.tsx` — render `InterviewSimCallTile` next to `JobVoiceCallTile` (both byline-inline and aside placements)
- `components/career-guides/voice-call/VoiceCallHistoryList.tsx` (or wherever the history list lives — verify in Task 16) — distinguish `interview_job` rows with a "Mock interview" chip

**Conventions referenced (already in repo):**
- `convex/jobVoiceNode.ts` — pattern for the Node mint action
- `convex/jobVoice.ts` — pattern for the V8 surface
- `convex/companyResearch.ts` — pattern for parallel Exa + structured-output synthesis
- `convex/lib/voiceLiveConfig.ts` — `buildLiveConfig(args)` already accepts `tools`
- `lib/ai/prompts/career-guides.ts` exports `CONTENT_MODEL_ID = "google/gemini-3.1-pro-preview"`
- `lib/ai/providers.ts` exports `chatModel(modelId, { zdr })`
- `lib/server/exa.ts` exports `exaAnswer(query, opts)` returning `{ answer, citations, costCents }`

**Cross-cutting reminders:**
- Local Convex codegen blocked on Node 25 (project memory). After adding new convex files, the cloud `npx convex dev` will regenerate `convex/_generated/api.d.ts`. If running offline you may need to hand-add the new module exports to that file temporarily. Plan tasks assume cloud codegen is available.
- All schema changes here are **additive optionals** — no widen/migrate/narrow needed. Per `convex-migration-helper`, no migration runner involvement required.
- `.claude/rules/deployment-previews.md` is not triggered (no crons added).
- Per `.claude/rules/ai-sdk-patterns.md`: structured output uses `experimental_output: Output.object({ schema })` (AI SDK v6 syntax already in `convex/companyResearch.ts`). Zod schemas must avoid `.min/.max/.int/.length` constraints because Gemini structured-output rejects bounds — encode bounds in prompt text instead.

---

## Task 1: Schema additions (additive optionals)

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Read current `voice_calls`, `company_research`, `company_role_research` definitions** to confirm anchors before editing.

Run: `grep -n "voice_calls\|company_research\|company_role_research" convex/schema.ts`
Expected: lines 1006, 1278, 1314 (or thereabouts).

- [ ] **Step 2: Extend `voice_calls.surface` and `voice_calls.messages[].groundingCitations`**

Find the `surface` union (around line 1011) and add `interview_job`:

```ts
    surface: v.optional(
      v.union(
        v.literal("guide"),
        v.literal("compass"),
        v.literal("job"),
        v.literal("interview_job"),
      ),
    ),
```

Find the `messages` array (around line 1051) and add `groundingCitations` to the inner object:

```ts
    messages: v.array(
      v.object({
        id: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        timestamp: v.number(),
        transcriptConfidence: v.optional(v.number()),
        groundingCitations: v.optional(
          v.array(v.object({
            url: v.string(),
            title: v.optional(v.string()),
          })),
        ),
      }),
    ),
```

- [ ] **Step 3: Add `interviewBundle` to `company_role_research`**

After the existing `interview` field (around line 1328), add:

```ts
    interviewBundle: v.optional(v.object({
      rounds: v.array(v.object({
        name: v.string(),
        durationMinutes: v.optional(v.number()),
        focus: v.string(),
        interviewerArchetype: v.string(),
      })),
      signatureQuestions: v.array(v.object({
        question: v.string(),
        rationale: v.string(),
      })),
      rubric: v.object({
        rigor: v.number(),
        rigorRationale: v.string(),
        interviewerArchetype: v.string(),
        dimensions: v.array(v.object({
          key: v.string(),
          anchorBelow: v.string(),
          anchorAt: v.string(),
          anchorAbove: v.string(),
        })),
      }),
      prestigeSignals: v.object({
        employeeBand: v.optional(v.string()),
        fundingOrPublic: v.optional(v.string()),
        brandMentions: v.optional(v.number()),
        glassdoorDifficulty: v.optional(v.number()),
      }),
      generatedAt: v.number(),
      modelUsed: v.string(),
    })),
```

- [ ] **Step 4: Add `recentNews` to `company_research`**

After the existing `citations` field on `company_research` (around line 1305, before the index declarations), add:

```ts
    recentNews: v.optional(v.object({
      bullets: v.array(v.object({
        headline: v.string(),
        summary: v.string(),
        sourceUrl: v.string(),
        publisher: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
      })),
      fetchedAt: v.number(),
    })),
```

- [ ] **Step 5: Push the schema and verify**

Run (in repo root, with Convex dev pointing at `pleasant-pigeon-988`):

```bash
npx convex dev --once
```

Expected: `Schema validation passed.` No errors. (The cloud backend regenerates `convex/_generated/dataModel.d.ts` and `api.d.ts`.)

If you see a schema validation error referencing any **existing** row that doesn't match the new shape: this should not happen because every change is an `optional` addition. If it does, stop and re-read `.claude/rules/convex-patterns.md`.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/_generated/
git commit -m "feat(schema): additive fields for interview-sim feature

- voice_calls.surface gains 'interview_job' literal
- voice_calls.messages[].groundingCitations (optional) for Gemini search-grounded turns
- company_role_research.interviewBundle (optional) for structured interview research
- company_research.recentNews (optional) for company-news bullets

All additions are optional; no backfill needed."
```

---

## Task 2: Extend `messageValidator` for grounding citations

**Files:**
- Modify: `convex/voiceCalls.ts:24-30`

The runtime validator that gates `appendMessage` lives in `voiceCalls.ts`. It must mirror the schema change from Task 1, otherwise `appendMessage` will reject any message with `groundingCitations`.

- [ ] **Step 1: Update the validator**

Find:

```ts
const messageValidator = v.object({
  id: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  timestamp: v.number(),
  transcriptConfidence: v.optional(v.number()),
});
```

Replace with:

```ts
const messageValidator = v.object({
  id: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  timestamp: v.number(),
  transcriptConfidence: v.optional(v.number()),
  groundingCitations: v.optional(
    v.array(v.object({
      url: v.string(),
      title: v.optional(v.string()),
    })),
  ),
});
```

- [ ] **Step 2: Push and verify**

```bash
npx convex dev --once
```

Expected: clean push, no validation errors.

- [ ] **Step 3: Commit**

```bash
git add convex/voiceCalls.ts
git commit -m "feat(voiceCalls): allow groundingCitations on transcript messages"
```

---

## Task 3: Interview-research Exa query builders (pure module + tests)

**Files:**
- Create: `convex/lib/interviewResearch.ts`
- Test: `convex/lib/interviewResearch.test.ts`

Pure helpers — no Convex context, no I/O — so they're easily unit-tested.

- [ ] **Step 1: Write the failing test**

Create `convex/lib/interviewResearch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildInterviewQueries,
  buildNewsQuery,
  isBundleStale,
  isNewsStale,
  BUNDLE_TTL_MS,
  NEWS_TTL_MS,
} from "./interviewResearch";

describe("interviewResearch.buildInterviewQueries", () => {
  it("returns 4 prompts that all reference the company and role", () => {
    const qs = buildInterviewQueries({
      companyName: "Stripe",
      roleTitle: "Senior Software Engineer",
    });
    expect(Object.keys(qs).sort()).toEqual([
      "loop",
      "prestigeSignals",
      "questions",
      "rigor",
    ]);
    for (const v of Object.values(qs)) {
      expect(v).toMatch(/Stripe/);
      expect(v).toMatch(/Senior Software Engineer/i);
    }
  });

  it("converts a slug-style role into prose", () => {
    const qs = buildInterviewQueries({
      companyName: "Acme",
      roleTitle: "staff-product-manager",
    });
    expect(qs.loop).toMatch(/staff product manager/i);
  });
});

describe("interviewResearch.buildNewsQuery", () => {
  it("includes a 90-day window phrasing in the query", () => {
    const q = buildNewsQuery({ companyName: "OpenAI" });
    expect(q).toMatch(/OpenAI/);
    expect(q).toMatch(/90 days|three months|recent/i);
  });
});

describe("interviewResearch.isBundleStale / isNewsStale", () => {
  it("returns true when timestamp is missing", () => {
    expect(isBundleStale(undefined)).toBe(true);
    expect(isNewsStale(undefined)).toBe(true);
  });

  it("returns true when older than the TTL", () => {
    const now = Date.now();
    expect(isBundleStale(now - BUNDLE_TTL_MS - 1, now)).toBe(true);
    expect(isNewsStale(now - NEWS_TTL_MS - 1, now)).toBe(true);
  });

  it("returns false when fresher than the TTL", () => {
    const now = Date.now();
    expect(isBundleStale(now - 1000, now)).toBe(false);
    expect(isNewsStale(now - 1000, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm vitest run convex/lib/interviewResearch.test.ts
```

Expected: cannot resolve module `./interviewResearch`.

- [ ] **Step 3: Implement the helper**

Create `convex/lib/interviewResearch.ts`:

```ts
/**
 * Pure helpers for the interview-research pipeline:
 *   - Build the 5 Exa queries used by `_synthesizeInterviewResearch`.
 *   - Check freshness against the 30-day (bundle) and 7-day (news) TTLs.
 *
 * No I/O, no Convex context — easy to unit-test.
 */

export const BUNDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const NEWS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InterviewQueryArgs = {
  companyName: string;
  roleTitle: string;
};

export type InterviewQueryKey = "loop" | "questions" | "rigor" | "prestigeSignals";

const slugToProse = (s: string): string => s.replace(/-+/g, " ").trim();

export function buildInterviewQueries(
  args: InterviewQueryArgs,
): Record<InterviewQueryKey, string> {
  const role = slugToProse(args.roleTitle);
  const co = args.companyName;
  return {
    loop: `Describe the interview process for ${role} roles at ${co}: how many rounds, what each round assesses, format (panel / 1:1 / take-home / live coding / case), and what to expect. Use what candidates have shared publicly.`,
    questions: `What interview questions have ${role} candidates at ${co} reported being asked? Include behavioral, technical, and case questions where applicable.`,
    rigor: `On Glassdoor, levels.fyi, and similar sites, how difficult is the interview at ${co}, especially for ${role} roles? Include any reported difficulty score (1-5) and how selective the company is reported to be.`,
    prestigeSignals: `Summarise ${co} as a company: approximate employee headcount, public/private, latest funding round if private, recent revenue if known, and how widely recognised the brand is. Be specific where possible.`,
  };
}

export function buildNewsQuery(args: { companyName: string }): string {
  return `What are the most notable recent news stories about ${args.companyName} from the last 90 days? Include announcements, product launches, leadership changes, layoffs, funding events, partnerships, controversies, or financial milestones.`;
}

export function isBundleStale(
  generatedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!generatedAt) return true;
  return now - generatedAt > BUNDLE_TTL_MS;
}

export function isNewsStale(
  fetchedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!fetchedAt) return true;
  return now - fetchedAt > NEWS_TTL_MS;
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm vitest run convex/lib/interviewResearch.test.ts
```

Expected: 7 passes.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/interviewResearch.ts convex/lib/interviewResearch.test.ts
git commit -m "feat(interviewSim): pure helpers for Exa research queries + TTL checks"
```

---

## Task 4: `InterviewSynthesisSchema` + synthesis prompt + analyzer

**Files:**
- Create: `lib/ai/prompts/interviewer.ts`
- Test: `lib/ai/prompts/interviewer.test.ts`

This file owns every Zod schema and every prompt-string for the interview-sim feature. Splitting it later (synthesis vs interviewer-prompt vs rubric) is fine, but for now keep them colocated — they share constants and reading them together is the only way to verify the calibration story.

- [ ] **Step 1: Write the failing test for `InterviewSynthesisSchema` shape**

Create `lib/ai/prompts/interviewer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  InterviewSynthesisSchema,
  buildSynthesisPrompt,
  buildInterviewerPrompt,
  InterviewRubricSchema,
  enforceVerbatimQuotes,
} from "./interviewer";

describe("InterviewSynthesisSchema", () => {
  it("accepts a well-formed synthesis output", () => {
    const ok = {
      interviewBundle: {
        rounds: [
          { name: "Recruiter screen", durationMinutes: 30, focus: "Mutual fit", interviewerArchetype: "recruiter" },
        ],
        signatureQuestions: [
          { question: "Tell me about a time you disagreed with a teammate.", rationale: "Tests collaboration." },
        ],
        rubric: {
          rigor: 4,
          rigorRationale: "Public company with strong brand recognition.",
          interviewerArchetype: "engineering manager",
          dimensions: [
            { key: "structure", anchorBelow: "Rambling.", anchorAt: "STAR.", anchorAbove: "Crisp + quantified." },
            { key: "depth", anchorBelow: "Surface.", anchorAt: "Adequate.", anchorAbove: "Probes own assumptions." },
            { key: "role-fit", anchorBelow: "Misaligned.", anchorAt: "Plausible.", anchorAbove: "Strong evidence." },
            { key: "company-fit", anchorBelow: "Generic.", anchorAt: "Aware.", anchorAbove: "Specific + informed." },
          ],
        },
        prestigeSignals: {
          employeeBand: "5k-50k",
          fundingOrPublic: "public",
          brandMentions: 200,
          glassdoorDifficulty: 4,
        },
      },
      interviewProse: "Stripe runs a 4-round loop including a take-home, live coding, system design, and values round.",
      recentNews: { bullets: [] },
    };
    expect(() => InterviewSynthesisSchema.parse(ok)).not.toThrow();
  });

  it("does NOT use min/max/int/length Zod constraints (Gemini compat)", () => {
    // Roundtrip through JSON schema and assert no constraint keys appear.
    // Use Zod's toJSONSchema if available; fall back to inspecting _def.
    const json = JSON.stringify(InterviewSynthesisSchema._def);
    expect(json).not.toMatch(/"minimum"|"maximum"|"minLength"|"maxLength"|"minItems"|"maxItems"/);
  });
});

describe("buildSynthesisPrompt", () => {
  it("includes the company, role, and every available Exa source by section", () => {
    const prompt = buildSynthesisPrompt({
      companyName: "Acme",
      roleTitle: "Staff Engineer",
      exaResults: {
        loop: { answer: "ACME RUNS A 5-ROUND LOOP", citations: [] },
        questions: { answer: "Q1: Tell me about a system you scaled", citations: [] },
        rigor: { answer: "Glassdoor 4.2/5", citations: [] },
        prestigeSignals: { answer: "Public company, 8000 employees", citations: [] },
      },
      newsAnswer: undefined,
    });
    expect(prompt).toMatch(/Acme/);
    expect(prompt).toMatch(/Staff Engineer/);
    expect(prompt).toMatch(/ACME RUNS A 5-ROUND LOOP/);
    expect(prompt).toMatch(/Glassdoor 4\.2\/5/);
    expect(prompt).toMatch(/3 to 5 rounds/);
    expect(prompt).toMatch(/exactly 4 dimensions/);
  });

  it("instructs the model to cite the prestige signals in rigorRationale", () => {
    const prompt = buildSynthesisPrompt({
      companyName: "X",
      roleTitle: "Y",
      exaResults: {
        loop: { answer: "", citations: [] },
        questions: { answer: "", citations: [] },
        rigor: { answer: "", citations: [] },
        prestigeSignals: { answer: "", citations: [] },
      },
      newsAnswer: undefined,
    });
    expect(prompt).toMatch(/rigorRationale/);
    expect(prompt).toMatch(/cite/i);
  });
});

describe("buildInterviewerPrompt", () => {
  it("renders a system prompt with persona, candidate brief, role brief, and the signature questions", () => {
    const prompt = buildInterviewerPrompt({
      candidate: {
        firstName: "Sam",
        currentTitle: "Senior Engineer",
        yearsExperience: 8,
        topSkills: ["Go", "Postgres"],
        narrative: "Built and led platform teams at two scale-ups.",
        resumeExcerpt: "—",
      },
      posting: { title: "Staff Engineer", city: "London", excerpt: "Ship infra at scale." },
      company: { name: "Stripe" },
      bundle: {
        rounds: [{ name: "System design", focus: "scaling discussion", interviewerArchetype: "staff EM" }],
        signatureQuestions: [{ question: "Walk me through a system you scaled.", rationale: "—" }],
        rubric: {
          rigor: 4,
          rigorRationale: "Public, household name.",
          interviewerArchetype: "staff EM",
          dimensions: [
            { key: "structure", anchorBelow: "—", anchorAt: "STAR-shaped", anchorAbove: "—" },
            { key: "depth", anchorBelow: "—", anchorAt: "probes assumptions", anchorAbove: "—" },
            { key: "role-fit", anchorBelow: "—", anchorAt: "matches scope", anchorAbove: "—" },
            { key: "company-fit", anchorBelow: "—", anchorAt: "informed about Stripe", anchorAbove: "—" },
          ],
        },
        prestigeSignals: {},
      },
      news: { bullets: [{ headline: "Q4 results", summary: "Revenue up 30%.", sourceUrl: "x.com" }] },
    });
    expect(prompt).toMatch(/staff EM at Stripe/);
    expect(prompt).toMatch(/Sam/);
    expect(prompt).toMatch(/Walk me through a system you scaled/);
    expect(prompt).toMatch(/STAR-shaped/);
    expect(prompt).toMatch(/Q4 results/);
    expect(prompt).toMatch(/googleSearch/);
    expect(prompt).toMatch(/Never break character/);
  });
});

describe("InterviewRubricSchema", () => {
  it("accepts a complete rubric with 4 dimensions, 3 exercises, and verbatim quotes", () => {
    const ok = {
      overallScore: 3.5,
      oneLineVerdict: "Strong on structure; tighten company-specific framing.",
      dimensions: [
        { key: "structure", score: 4, whatWorked: "Used STAR.", whatToFix: "—" },
        { key: "depth", score: 3, whatWorked: "—", whatToFix: "Probe own assumptions." },
        { key: "role-fit", score: null, whatWorked: "—", whatToFix: "Not enough signal." },
        { key: "company-fit", score: 3, whatWorked: "—", whatToFix: "Cite specifics." },
      ],
      bestMoment: { quote: "I led the migration from MySQL to Postgres.", why: "Concrete, scoped, owned." },
      biggestMiss: { quote: "I'd do something with caching.", why: "Vague.", betterAnswerSketch: "Name the caches, the layer, the eviction policy." },
      nextStepExercises: [
        { title: "STAR drill", why: "Tighten depth.", how: "Write 3 STAR stories." },
        { title: "Read Stripe blog", why: "Company specificity.", how: "Read 2 posts." },
        { title: "Mock again", why: "Reps.", how: "Run 2 more mocks this week." },
      ],
    };
    expect(() => InterviewRubricSchema.parse(ok)).not.toThrow();
  });
});

describe("enforceVerbatimQuotes", () => {
  it("returns ok when both quotes are present in transcript", () => {
    const r = enforceVerbatimQuotes({
      transcript: "Hello. I led the migration from MySQL to Postgres. Then I'd do something with caching.",
      bestQuote: "I led the migration from MySQL to Postgres.",
      missQuote: "I'd do something with caching.",
    });
    expect(r.ok).toBe(true);
  });

  it("returns the offending quote when one is hallucinated", () => {
    const r = enforceVerbatimQuotes({
      transcript: "Some other text entirely.",
      bestQuote: "A quote that isn't here.",
      missQuote: "Neither is this one.",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContain("A quote that isn't here.");
      expect(r.missing).toContain("Neither is this one.");
    }
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm vitest run lib/ai/prompts/interviewer.test.ts
```

Expected: cannot resolve module `./interviewer`.

- [ ] **Step 3: Implement `lib/ai/prompts/interviewer.ts`**

Create `lib/ai/prompts/interviewer.ts`:

```ts
import { z } from "zod";

/**
 * Schemas, prompts, and helpers for the interview simulation feature.
 *
 * Three logical chunks colocated in one file because they share constants
 * and the calibration story is only readable when you can see them
 * side-by-side:
 *   1. InterviewSynthesisSchema + buildSynthesisPrompt — turn raw Exa
 *      research into a structured `interviewBundle` (+ prose + news).
 *   2. buildInterviewerPrompt — build the Gemini Live system instruction
 *      that drives the actual mock interview.
 *   3. InterviewRubricSchema + buildRubricPrompt + enforceVerbatimQuotes
 *      — post-call grading against the same bundle, with a hallucinated-
 *      quote check.
 *
 * Per .claude/rules/ai-sdk-patterns.md: Zod schemas avoid .min/.max/.int
 * because Gemini structured-output rejects bound constraints. Bounds are
 * encoded in prompt text.
 */

// ─── 1. Synthesis ─────────────────────────────────────────────────────────

const RoundSchema = z.object({
  name: z.string(),
  durationMinutes: z.number().optional(),
  focus: z.string(),
  interviewerArchetype: z.string(),
});

const SignatureQuestionSchema = z.object({
  question: z.string(),
  rationale: z.string(),
});

const DimensionSchema = z.object({
  key: z.string(),
  anchorBelow: z.string(),
  anchorAt: z.string(),
  anchorAbove: z.string(),
});

const RubricSchema = z.object({
  rigor: z.number(),
  rigorRationale: z.string(),
  interviewerArchetype: z.string(),
  dimensions: z.array(DimensionSchema),
});

const PrestigeSignalsSchema = z.object({
  employeeBand: z.string().optional(),
  fundingOrPublic: z.string().optional(),
  brandMentions: z.number().optional(),
  glassdoorDifficulty: z.number().optional(),
});

const NewsBulletSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  sourceUrl: z.string(),
  publisher: z.string().optional(),
  publishedAt: z.number().optional(),
});

export const InterviewBundleSchema = z.object({
  rounds: z.array(RoundSchema),
  signatureQuestions: z.array(SignatureQuestionSchema),
  rubric: RubricSchema,
  prestigeSignals: PrestigeSignalsSchema,
});

export const InterviewSynthesisSchema = z.object({
  interviewBundle: InterviewBundleSchema,
  interviewProse: z.string(),
  recentNews: z.object({ bullets: z.array(NewsBulletSchema) }),
});

export type InterviewBundle = z.infer<typeof InterviewBundleSchema>;
export type InterviewSynthesis = z.infer<typeof InterviewSynthesisSchema>;
export type NewsBullets = z.infer<typeof InterviewSynthesisSchema>["recentNews"];

export type ExaSlice = { answer: string; citations: Array<{ url: string; title?: string; publisher?: string; fetchedAt: number }> };

export type SynthesisPromptArgs = {
  companyName: string;
  roleTitle: string;
  exaResults: {
    loop?: ExaSlice;
    questions?: ExaSlice;
    rigor?: ExaSlice;
    prestigeSignals?: ExaSlice;
  };
  newsAnswer?: ExaSlice;
};

export function buildSynthesisPrompt(args: SynthesisPromptArgs): string {
  const sections: string[] = [];

  sections.push(`You are synthesizing research into a structured interview bundle for a mock-interview simulator.`);
  sections.push(`The bundle calibrates how an AI interviewer will conduct, and later grade, a mock interview for a ${args.roleTitle} role at ${args.companyName}.`);
  sections.push("");
  sections.push("== Output requirements ==");
  sections.push("Return JSON matching the provided schema. Constraints (encoded here, not the schema):");
  sections.push("- `interviewBundle.rounds`: 3 to 5 entries describing the typical loop.");
  sections.push("- `interviewBundle.signatureQuestions`: 5 to 8 entries. Use questions actually reported by candidates where the research supports it; otherwise generate role-appropriate ones grounded in the research.");
  sections.push("- `interviewBundle.rubric.dimensions`: exactly 4 dimensions with keys 'structure', 'depth', 'role-fit', 'company-fit'.");
  sections.push("- `interviewBundle.rubric.rigor`: an integer 1-5.");
  sections.push("- `interviewBundle.rubric.rigorRationale`: ONE sentence that cites the specific prestige signals that drove the score (e.g. 'public company with 8k employees and a Glassdoor difficulty of 4.1').");
  sections.push("- `interviewProse`: a 2-4 sentence human-readable summary suitable for the existing `interview` field.");
  if (args.newsAnswer) {
    sections.push("- `recentNews.bullets`: 3 to 6 bullets from the news research, each with a headline, one-sentence summary, and source URL.");
  } else {
    sections.push("- `recentNews.bullets`: return [] (news research was not refreshed this run).");
  }
  sections.push("");
  sections.push("== Calibration anchors ==");
  sections.push("Derive `rigor` from the prestige signals you receive — NOT from the company name. Anchors:");
  sections.push("- <50 employees, no household name → rigor 2-3 (less calibrated process).");
  sections.push("- 50-500 employees, modest brand → rigor 3.");
  sections.push("- 500-5k employees, recognised in domain → rigor 3-4.");
  sections.push("- 5k+ employees AND brand mentions >50, OR public, OR famously selective → rigor 4-5.");
  sections.push("- Glassdoor difficulty score (when present) is the strongest single signal; weight it heaviest.");
  sections.push("");
  sections.push("Each dimension's `anchorAt` should describe what a 3 looks like at THIS company specifically (the bar for 'meets expectations' here, not in general). `anchorBelow` and `anchorAbove` describe weaker / stronger answers within that calibration.");
  sections.push("");
  sections.push("Each round in `rounds` should have an `interviewerArchetype` like 'recruiter', 'hiring manager', 'engineering manager', 'staff engineer', 'bar raiser', 'principal', etc. The whole-loop `rubric.interviewerArchetype` should be the dominant one — this is the persona the live interviewer adopts.");
  sections.push("");
  sections.push(`== Research input ==`);
  sections.push(`Company: ${args.companyName}`);
  sections.push(`Role: ${args.roleTitle}`);
  sections.push("");
  if (args.exaResults.loop) {
    sections.push("--- Loop structure (Exa research) ---");
    sections.push(args.exaResults.loop.answer || "(no usable result)");
    sections.push("");
  }
  if (args.exaResults.questions) {
    sections.push("--- Reported questions (Exa research) ---");
    sections.push(args.exaResults.questions.answer || "(no usable result)");
    sections.push("");
  }
  if (args.exaResults.rigor) {
    sections.push("--- Difficulty / selectivity (Exa research) ---");
    sections.push(args.exaResults.rigor.answer || "(no usable result)");
    sections.push("");
  }
  if (args.exaResults.prestigeSignals) {
    sections.push("--- Company size & brand (Exa research) ---");
    sections.push(args.exaResults.prestigeSignals.answer || "(no usable result)");
    sections.push("");
  }
  if (args.newsAnswer) {
    sections.push("--- Recent news (Exa research, last 90 days) ---");
    sections.push(args.newsAnswer.answer || "(no usable result)");
    sections.push("");
  }

  return sections.join("\n");
}

// ─── 2. Live interviewer prompt ───────────────────────────────────────────

export type CandidateContext = {
  firstName: string;
  currentTitle?: string;
  yearsExperience?: number;
  topSkills?: string[];
  narrative?: string;
  resumeExcerpt?: string;
};

export type PostingContext = {
  title: string;
  city?: string;
  excerpt?: string;
};

export type CompanyContext = {
  name: string;
};

export type InterviewerPromptArgs = {
  candidate: CandidateContext;
  posting: PostingContext;
  company: CompanyContext;
  bundle: InterviewBundle;
  news?: NewsBullets;
};

export function buildInterviewerPrompt(args: InterviewerPromptArgs): string {
  const { candidate, posting, company, bundle, news } = args;
  const archetype = bundle.rubric.interviewerArchetype;
  const anchorAtBullets = bundle.rubric.dimensions
    .map((d) => `  - ${d.key}: ${d.anchorAt}`)
    .join("\n");
  const candidateLines: string[] = [];
  if (candidate.currentTitle) candidateLines.push(`Current role: ${candidate.currentTitle}`);
  if (candidate.yearsExperience != null) candidateLines.push(`Experience: ${candidate.yearsExperience} years`);
  if (candidate.topSkills?.length) candidateLines.push(`Top skills: ${candidate.topSkills.slice(0, 5).join(", ")}`);
  if (candidate.narrative) candidateLines.push(`Narrative: ${candidate.narrative}`);
  if (candidate.resumeExcerpt) candidateLines.push(`Resume excerpt:\n${candidate.resumeExcerpt.slice(0, 800)}`);

  const newsBullets = news?.bullets?.length
    ? news.bullets.slice(0, 3).map((b) => `  - ${b.headline}: ${b.summary}`).join("\n")
    : "  (no recent news captured)";

  const loopBullets = bundle.rounds
    .map((r) => `  - ${r.name} (${r.interviewerArchetype}) — ${r.focus}`)
    .join("\n");

  const signatureSpine = bundle.signatureQuestions
    .map((q) => `  - "${q.question}"`)
    .join("\n");

  return [
    `**Persona:**`,
    `You are a ${archetype} at ${company.name}, interviewing ${candidate.firstName} for the ${posting.title} position. Your tone matches how this company actually conducts this loop, based on candidate accounts.`,
    ``,
    `Calibration: this loop runs at rigor ${bundle.rubric.rigor}/5 (${bundle.rubric.rigorRationale}). Hold the bar at that level — your bar is not "hard" or "easy" in the abstract, it is what excellence looks like at ${company.name} for this role. Reference frame for what a 3 means here:`,
    anchorAtBullets,
    ``,
    `**About ${candidate.firstName}:**`,
    candidateLines.length ? candidateLines.join("\n") : "(no candidate profile available — ask open questions to learn the basics first)",
    ``,
    `**About this role:**`,
    `${posting.title} at ${company.name}${posting.city ? ` · ${posting.city}` : ""}`,
    posting.excerpt ? posting.excerpt.slice(0, 500) : "",
    ``,
    `**Recent at ${company.name}** (use sparingly — only if the candidate brings it up or asks "what do you know about us recently"):`,
    newsBullets,
    ``,
    `**Likely loop structure** — you are simulating ONE round of this loop; pick whichever feels most useful given the candidate's background:`,
    loopBullets,
    ``,
    `**Conversational rules:**`,
    `1. Open with a 30-second warm hello. One ice-breaker. Then transition.`,
    `2. One question per turn. Wait for the full answer. Probe with follow-ups when answers are vague — don't accept hand-waving at this rigor.`,
    `3. Use these signature questions as your spine. Ask 2-4 of them verbatim or near-verbatim across the conversation; mix in your own follow-ups based on candidate answers:`,
    signatureSpine,
    `4. Mid-call, if the candidate references current events about ${company.name} you don't already know from the brief above, you may call googleSearch ONCE to fetch context. Do not search proactively.`,
    `5. Cap each spoken response at ~25 seconds.`,
    `6. Around minute 12-13, signal you're wrapping up: "Before we close, what questions do you have for me?" Answer honestly from the hiring-manager POV. End by thanking them and naming one specific thing they did well.`,
    ``,
    `**Tool usage:**`,
    `- googleSearch: only when the candidate references something about ${company.name} you cannot answer from the brief. One search per call max.`,
    ``,
    `**Guardrails:**`,
    `- Never break character. You are the interviewer, not an AI.`,
    `- Never mention the rigor score, the rubric, or that this is a simulation.`,
    `- Never repeat what the candidate said back to them.`,
    `- If the candidate asks for feedback during the call, defer: "I'll have thoughts at the end — let's keep going."`,
  ].join("\n");
}

// ─── 3. Post-call rubric ──────────────────────────────────────────────────

const RubricDimensionResultSchema = z.object({
  key: z.string(),
  score: z.number().nullable(),
  whatWorked: z.string(),
  whatToFix: z.string(),
});

const NextStepExerciseSchema = z.object({
  title: z.string(),
  why: z.string(),
  how: z.string(),
});

export const InterviewRubricSchema = z.object({
  overallScore: z.number(),
  oneLineVerdict: z.string(),
  dimensions: z.array(RubricDimensionResultSchema),
  bestMoment: z.object({ quote: z.string(), why: z.string() }),
  biggestMiss: z.object({
    quote: z.string(),
    why: z.string(),
    betterAnswerSketch: z.string(),
  }),
  nextStepExercises: z.array(NextStepExerciseSchema),
});

export type InterviewRubric = z.infer<typeof InterviewRubricSchema>;

export type RubricPromptArgs = {
  candidate: CandidateContext;
  posting: PostingContext;
  company: CompanyContext;
  bundle: InterviewBundle;
  transcript: string;
  /** Optional correction echo for retry attempts — listed quotes were not found verbatim. */
  failedQuotes?: string[];
};

export function buildRubricPrompt(args: RubricPromptArgs): string {
  const { candidate, posting, company, bundle, transcript } = args;
  const anchorBlock = bundle.rubric.dimensions
    .map((d) => `- ${d.key}\n  Below (1-2): ${d.anchorBelow}\n  At (3): ${d.anchorAt}\n  Above (4-5): ${d.anchorAbove}`)
    .join("\n");

  const sections: string[] = [];
  sections.push(`You are grading a mock interview for the ${posting.title} role at ${company.name}.`);
  sections.push(`Calibration: rigor ${bundle.rubric.rigor}/5 (${bundle.rubric.rigorRationale}).`);
  sections.push(`A 3 means "meets the bar at ${company.name} for this role" — NOT "good in general".`);
  sections.push(``);
  sections.push(`== Output schema requirements ==`);
  sections.push(`- nextStepExercises: exactly 3 entries.`);
  sections.push(`- dimensions: exactly 4 entries with keys: structure, depth, role-fit, company-fit (matching the bundle).`);
  sections.push(`- overallScore: weighted average of the 4 dimension scores (treat null as not contributing). Round to one decimal.`);
  sections.push(`- oneLineVerdict: a single sentence the candidate sees above the fold.`);
  sections.push(``);
  sections.push(`== Verbatim-quote rule (critical) ==`);
  sections.push(`bestMoment.quote and biggestMiss.quote MUST be substrings of the transcript exactly as the candidate spoke them. Do not paraphrase. If you cannot find a verbatim quote that supports the point you'd like to make, lower the score for that dimension instead of fabricating a quote.`);
  sections.push(``);
  sections.push(`If the candidate barely answered a dimension (e.g. interview ended before depth questions came up), score it null and say so in whatToFix — do not guess.`);
  sections.push(``);
  if (args.failedQuotes?.length) {
    sections.push(`== CORRECTION ==`);
    sections.push(`On the previous attempt these quotes were NOT verbatim substrings of the transcript:`);
    args.failedQuotes.forEach((q) => sections.push(`  - ${q}`));
    sections.push(`Pick replacement quotes that ARE present in the transcript below. If no suitable verbatim quote exists, lower the score and say so.`);
    sections.push(``);
  }
  sections.push(`== Dimension anchors (use these, not a generic standard) ==`);
  sections.push(anchorBlock);
  sections.push(``);
  sections.push(`== Candidate ==`);
  sections.push(`${candidate.firstName}${candidate.currentTitle ? ` (${candidate.currentTitle})` : ""}${candidate.yearsExperience != null ? ` · ${candidate.yearsExperience} yrs` : ""}`);
  if (candidate.narrative) sections.push(candidate.narrative);
  sections.push(``);
  sections.push(`== Transcript ==`);
  sections.push(transcript);
  return sections.join("\n");
}

export type EnforceQuotesArgs = {
  transcript: string;
  bestQuote: string;
  missQuote: string;
};

export type EnforceQuotesResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function enforceVerbatimQuotes(args: EnforceQuotesArgs): EnforceQuotesResult {
  const missing: string[] = [];
  if (!args.transcript.includes(args.bestQuote)) missing.push(args.bestQuote);
  if (!args.transcript.includes(args.missQuote)) missing.push(args.missQuote);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm vitest run lib/ai/prompts/interviewer.test.ts
```

Expected: all describes pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/prompts/interviewer.ts lib/ai/prompts/interviewer.test.ts
git commit -m "feat(interviewSim): synthesis + interviewer + rubric prompts and schemas

- InterviewSynthesisSchema turns Exa research into a structured bundle
- buildInterviewerPrompt builds the Gemini Live system instruction
- InterviewRubricSchema + buildRubricPrompt grade the call
- enforceVerbatimQuotes validates rubric quotes against the transcript

All Zod schemas avoid bound constraints (Gemini structured-output compat).
Bounds are encoded in prompt text per .claude/rules/ai-sdk-patterns.md."
```

---

## Task 5: `convex/interviewSim.ts` — V8 surface (context loader, status doc, internal mutations)

**Files:**
- Create: `convex/interviewSim.ts`

The V8 surface owns persistence: row creation, prep-status writes the dialog subscribes to, and the context-load query the Node action calls.

**Status doc model:** the prep-status state lives on a temporary `interview_prep_status` table keyed on a client-generated `prepSessionId` (UUID generated by the CTA before it mints). The dialog subscribes to it via `subscribeToPrep(prepSessionId)`. Once the call is `ready`, the dialog switches to subscribing to the `voice_calls` row by `sessionId`. The status doc gets garbage-collected after 1 hour by setting `expiresAt` and a future cleanup cron — that cron is out of scope for this PR; for MVP rows accumulate harmlessly.

- [ ] **Step 1: Add `interview_prep_status` to `convex/schema.ts`**

After the `voice_calls` table block (around line 1080), add:

```ts
  // Transient status doc the InterviewSimDialog subscribes to during the
  // research → mint phase. Created by interviewSimNode.mintInterviewSession,
  // patched as research progresses, then read once during Phase 1 of the
  // dialog. Old rows accumulate harmlessly until a future cleanup cron.
  interview_prep_status: defineTable({
    prepSessionId: v.string(),
    userId: v.id("users"),
    jobPostingId: v.id("job_postings"),
    status: v.union(
      v.literal("researching"),
      v.literal("synthesizing"),
      v.literal("minting_token"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    detail: v.optional(v.string()),       // e.g. company name for the human-readable line
    voiceCallId: v.optional(v.id("voice_calls")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_prepSessionId", ["prepSessionId"])
    .index("by_userId_created", ["userId", "createdAt"]),
```

Push:

```bash
npx convex dev --once
```

Expected: clean.

- [ ] **Step 2: Create `convex/interviewSim.ts`**

```ts
/**
 * Interview-simulation V8 surface (per-job-posting mock interview).
 *
 * Parallel to convex/jobVoice.ts (per-job deep-dive). Owns:
 *   - prep-status doc creation + patching (subscribed to by the dialog)
 *   - voice_calls row creation with surface: "interview_job"
 *   - context-load internal query for the Node mint action
 *
 * Reuses existing voiceCalls.appendMessage + voiceCalls.finalize — those
 * are surface-agnostic (lookup by sessionId). voiceCalls.finalize is
 * extended in this PR to dispatch interview rows to
 * interviewSimNode.processInterviewAnalysis.
 */

import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

// ── Prep status: write side (internal) ────────────────────────────────────

export const _createPrepStatus = internalMutation({
  args: {
    prepSessionId: v.string(),
    userId: v.id("users"),
    jobPostingId: v.id("job_postings"),
    detail: v.optional(v.string()),
  },
  returns: v.id("interview_prep_status"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("interview_prep_status", {
      prepSessionId: args.prepSessionId,
      userId: args.userId,
      jobPostingId: args.jobPostingId,
      status: "researching",
      detail: args.detail,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const _patchPrepStatus = internalMutation({
  args: {
    prepSessionId: v.string(),
    status: v.union(
      v.literal("researching"),
      v.literal("synthesizing"),
      v.literal("minting_token"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    detail: v.optional(v.string()),
    voiceCallId: v.optional(v.id("voice_calls")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("interview_prep_status")
      .withIndex("by_prepSessionId", (q) =>
        q.eq("prepSessionId", args.prepSessionId),
      )
      .unique();
    if (!row) return null;
    await ctx.db.patch(row._id, {
      status: args.status,
      ...(args.detail !== undefined ? { detail: args.detail } : {}),
      ...(args.voiceCallId !== undefined ? { voiceCallId: args.voiceCallId } : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ── Prep status: read side (public, subscribed to by the dialog) ──────────

export const subscribeToPrep = query({
  args: { prepSessionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(
        v.literal("researching"),
        v.literal("synthesizing"),
        v.literal("minting_token"),
        v.literal("ready"),
        v.literal("failed"),
      ),
      detail: v.optional(v.string()),
      voiceCallId: v.optional(v.id("voice_calls")),
      error: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("interview_prep_status")
      .withIndex("by_prepSessionId", (q) =>
        q.eq("prepSessionId", args.prepSessionId),
      )
      .unique();
    if (!row) return null;

    // Auth: only the user who started the prep can subscribe.
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user || user._id !== row.userId) return null;

    return {
      status: row.status,
      detail: row.detail,
      voiceCallId: row.voiceCallId,
      error: row.error,
    };
  },
});

// ── Row creator (called from the Node mint action) ────────────────────────

export const _createInterviewSession = internalMutation({
  args: {
    userId: v.id("users"),
    jobPostingId: v.id("job_postings"),
    sessionId: v.string(),
    title: v.string(),
    voiceId: v.string(),
    model: v.string(),
    authMode: v.union(v.literal("ephemeral"), v.literal("apiKey")),
  },
  returns: v.id("voice_calls"),
  handler: async (ctx, args): Promise<Id<"voice_calls">> => {
    const now = Date.now();
    return await ctx.db.insert("voice_calls", {
      userId: args.userId,
      surface: "interview_job",
      jobPostingId: args.jobPostingId,
      sessionId: args.sessionId,
      title: args.title,
      voiceProvider: "gemini",
      voiceId: args.voiceId,
      model: args.model,
      authMode: args.authMode,
      status: "active",
      messages: [],
      totalDurationSeconds: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ── Persistence helpers for the synthesis action ─────────────────────────

export const _patchCompanyResearchNews = internalMutation({
  args: {
    companyId: v.id("companies"),
    bullets: v.array(v.object({
      headline: v.string(),
      summary: v.string(),
      sourceUrl: v.string(),
      publisher: v.optional(v.string()),
      publishedAt: v.optional(v.number()),
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("company_research")
      .withIndex("by_companyId", (q) => q.eq("companyId", args.companyId))
      .unique();
    const now = Date.now();
    if (!row) {
      await ctx.db.insert("company_research", {
        companyId: args.companyId,
        status: "complete",
        recentNews: { bullets: args.bullets, fetchedAt: now },
      });
      return null;
    }
    await ctx.db.patch(row._id, {
      recentNews: { bullets: args.bullets, fetchedAt: now },
    });
    return null;
  },
});

export const _patchInterviewBundle = internalMutation({
  args: {
    companyId: v.id("companies"),
    roleArchetypeSlug: v.string(),
    interviewProse: v.string(),
    interviewBundle: v.any(),  // shape validated by InterviewSynthesisSchema in the action
    citations: v.optional(v.any()),
    costCents: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("company_role_research")
      .withIndex("by_companyId_archetype", (q) =>
        q.eq("companyId", args.companyId).eq("roleArchetypeSlug", args.roleArchetypeSlug),
      )
      .unique();
    const now = Date.now();
    if (!row) {
      await ctx.db.insert("company_role_research", {
        companyId: args.companyId,
        roleArchetypeSlug: args.roleArchetypeSlug,
        status: "complete",
        attempts: 1,
        lastResearchedAt: now,
        costCents: args.costCents,
        interview: args.interviewProse,
        interviewBundle: { ...args.interviewBundle, generatedAt: now },
        citations: args.citations,
      });
      return null;
    }
    await ctx.db.patch(row._id, {
      status: "complete",
      lastResearchedAt: now,
      costCents: (row.costCents ?? 0) + (args.costCents ?? 0),
      interview: args.interviewProse,
      interviewBundle: { ...args.interviewBundle, generatedAt: now },
      ...(args.citations ? { citations: { ...row.citations, ...args.citations } } : {}),
    });
    return null;
  },
});

// ── Context loader for mintInterviewSession ───────────────────────────────

export const _gatherInterviewContext = internalQuery({
  args: {
    jobPostingId: v.id("job_postings"),
    tokenIdentifier: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      user: v.any(),
      profile: v.any(),
      enrichment: v.any(),
      posting: v.any(),
      company: v.any(),
      companyResearch: v.any(),
      companyRoleResearch: v.any(),
      cacheKeySlug: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx, args.tokenIdentifier);
    if (!user) return null;

    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) {
      return {
        user, profile: null, enrichment: null, posting: null, company: null,
        companyResearch: null, companyRoleResearch: null, cacheKeySlug: "",
      };
    }

    const company = await ctx.db.get(posting.companyId);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    const enrichment = profile
      ? await ctx.db
          .query("profile_enrichments")
          .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
          .first()
      : null;

    const companyResearch = await ctx.db
      .query("company_research")
      .withIndex("by_companyId", (q) => q.eq("companyId", posting.companyId))
      .unique();

    // Cache key — use roleArchetypeSlug when present; otherwise synthesize a
    // stable slug from companyId + normalized title so postings sharing a
    // title at the same company share the bundle.
    const cacheKeySlug =
      posting.roleArchetypeSlug ??
      `untyped-${normalizeForSlug(posting.title)}`;

    const companyRoleResearch = await ctx.db
      .query("company_role_research")
      .withIndex("by_companyId_archetype", (q) =>
        q.eq("companyId", posting.companyId).eq("roleArchetypeSlug", cacheKeySlug),
      )
      .unique();

    return {
      user,
      profile,
      enrichment,
      posting,
      company,
      companyResearch,
      companyRoleResearch,
      cacheKeySlug,
    };
  },
});

// ── helpers ───────────────────────────────────────────────────────────────

async function resolveUser(
  ctx: QueryCtx,
  tokenIdentifier: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
}

function normalizeForSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
```

- [ ] **Step 3: Push and verify**

```bash
npx convex dev --once
```

Expected: clean. New module appears in `convex/_generated/api.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts convex/interviewSim.ts convex/_generated/
git commit -m "feat(interviewSim): V8 surface (prep-status, row creator, context loader)"
```

---

## Task 6: `convex/interviewSimNode.ts` — Node mint action + research synthesis

**Files:**
- Create: `convex/interviewSimNode.ts`

This is the heaviest task. Three internal/exported functions:
- `mintInterviewSession` (entry, action) — auth, cache check, dispatch synthesis if stale, build prompt, mint Live token, create row.
- `_synthesizeInterviewResearch` (internal action) — Exa burst + LLM synthesis + persistence.
- `processInterviewAnalysis` (internal action) — post-call rubric grading; called from `voiceCalls.finalize` (Task 7).

- [ ] **Step 1: Implement the file**

```ts
"use node";

/**
 * Interview-simulation Node-runtime surface.
 *
 * Single client entry point: mintInterviewSession.
 *   1. Auth + load context.
 *   2. Refresh stale research (interviewBundle, news) in parallel inside
 *      _synthesizeInterviewResearch.
 *   3. Build the interviewer system prompt.
 *   4. Mint a Gemini Live ephemeral token (tools: [{ googleSearch: {} }]).
 *   5. Create the voice_calls row with surface: "interview_job".
 *
 * processInterviewAnalysis runs after voiceCalls.finalize for interview rows
 * (dispatched in Task 7). Generates the rubric with verbatim-quote retries.
 */

import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { GoogleGenAI } from "@google/genai";
import { generateText, Output } from "ai";
import { chatModel } from "../lib/ai/providers";
import { CONTENT_MODEL_ID } from "../lib/ai/prompts/career-guides";
import {
  buildInterviewQueries,
  buildNewsQuery,
  isBundleStale,
  isNewsStale,
} from "./lib/interviewResearch";
import {
  InterviewSynthesisSchema,
  InterviewRubricSchema,
  buildSynthesisPrompt,
  buildInterviewerPrompt,
  buildRubricPrompt,
  enforceVerbatimQuotes,
  type CandidateContext,
} from "../lib/ai/prompts/interviewer";
import { exaAnswer, type Citation } from "../lib/server/exa";

const LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = "Aoede";
const TOKEN_USES = 1;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const NEW_SESSION_TTL_MS = 2 * 60 * 1000;

const SYNTHESIS_TIMEOUT_MS = 90_000;
const ANALYSIS_TIMEOUT_MS = 90_000;
const RATE_LIMIT_PER_DAY = 5;

// ─── mintInterviewSession (client entry) ──────────────────────────────────

export const mintInterviewSession = action({
  args: {
    jobPostingId: v.id("job_postings"),
    prepSessionId: v.string(), // client-generated UUID for the status doc
    voiceId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      callId: v.id("voice_calls"),
      sessionId: v.string(),
      auth: v.object({
        type: v.union(v.literal("ephemeral_token"), v.literal("api_key")),
        value: v.string(),
      }),
      sessionConfig: v.object({
        model: v.string(),
        voice: v.string(),
        systemInstruction: v.string(),
      }),
    }),
    v.object({
      ok: v.literal(false),
      reason: v.union(
        v.literal("anonymous"),
        v.literal("posting-not-found"),
        v.literal("posting-not-ready"),
        v.literal("rate-limited"),
        v.literal("research-failed"),
        v.literal("no-api-key"),
      ),
    }),
  ),
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<
    | {
        ok: true;
        callId: Id<"voice_calls">;
        sessionId: string;
        auth: { type: "ephemeral_token" | "api_key"; value: string };
        sessionConfig: { model: string; voice: string; systemInstruction: string };
      }
    | { ok: false; reason: "anonymous" | "posting-not-found" | "posting-not-ready" | "rate-limited" | "research-failed" | "no-api-key" }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, reason: "anonymous" };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[interviewSim:mint] GEMINI_API_KEY missing");
      return { ok: false, reason: "no-api-key" };
    }

    const bundle = await ctx.runQuery(internal.interviewSim._gatherInterviewContext, {
      jobPostingId: args.jobPostingId,
      tokenIdentifier: identity.tokenIdentifier,
    });
    if (!bundle) return { ok: false, reason: "anonymous" };
    if (!bundle.posting || !bundle.company) return { ok: false, reason: "posting-not-found" };
    if (bundle.posting.contentStatus !== "complete" || !bundle.posting.content) {
      return { ok: false, reason: "posting-not-ready" };
    }

    // Per-day rate limit (5 / 24h, by user).
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recent = await ctx.runQuery(internal.interviewSim._countRecentInterviews, {
      userId: bundle.user._id,
      since,
    });
    if (recent >= RATE_LIMIT_PER_DAY) {
      return { ok: false, reason: "rate-limited" };
    }

    // Create the prep status doc so the dialog can subscribe immediately.
    await ctx.runMutation(internal.interviewSim._createPrepStatus, {
      prepSessionId: args.prepSessionId,
      userId: bundle.user._id,
      jobPostingId: args.jobPostingId,
      detail: bundle.company.nameRaw,
    });

    const bundleStale = isBundleStale(
      bundle.companyRoleResearch?.interviewBundle?.generatedAt,
    );
    const newsStale = isNewsStale(bundle.companyResearch?.recentNews?.fetchedAt);

    if (bundleStale || newsStale) {
      await ctx.runAction(internal.interviewSimNode._synthesizeInterviewResearch, {
        prepSessionId: args.prepSessionId,
        companyId: bundle.company._id,
        companyName: bundle.company.nameRaw,
        roleTitle: bundle.posting.title,
        cacheKeySlug: bundle.cacheKeySlug,
        runBundle: bundleStale,
        runNews: newsStale,
      });
    }

    // Re-fetch context now that synthesis may have populated the bundle.
    const refreshed = await ctx.runQuery(internal.interviewSim._gatherInterviewContext, {
      jobPostingId: args.jobPostingId,
      tokenIdentifier: identity.tokenIdentifier,
    });
    const interviewBundle = refreshed?.companyRoleResearch?.interviewBundle ?? fallbackBundle();
    const news = refreshed?.companyResearch?.recentNews;

    await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
      prepSessionId: args.prepSessionId,
      status: "minting_token",
    });

    // Build the system instruction.
    const candidate: CandidateContext = {
      firstName: bundle.user.firstName ?? bundle.user.name ?? "there",
      currentTitle: bundle.profile?.currentTitle,
      yearsExperience: bundle.profile?.yearsExperience,
      topSkills: bundle.profile?.topSkills,
      narrative: bundle.enrichment?.narrative,
      resumeExcerpt: bundle.profile?.resumeExcerpt?.slice(0, 800),
    };
    const systemInstruction = buildInterviewerPrompt({
      candidate,
      posting: { title: bundle.posting.title, city: bundle.posting.city, excerpt: bundle.posting.content?.slice(0, 500) },
      company: { name: bundle.company.nameRaw },
      bundle: interviewBundle,
      news,
    });

    // Mint the Gemini Live token (ephemeral first, API-key fallback).
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    let credential: { type: "ephemeral_token" | "api_key"; value: string };
    let authMode: "ephemeral" | "apiKey";
    try {
      const token = await client.authTokens.create({
        config: {
          uses: TOKEN_USES,
          expireTime: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
          newSessionExpireTime: new Date(Date.now() + NEW_SESSION_TTL_MS).toISOString(),
          // Constrain to the system instruction + tool list. Live config
          // assembly happens client-side via the existing useInterviewCall
          // hook (Task 11) — same pattern as jobVoiceNode.
        },
      });
      if (!token.name) throw new Error("empty_token_name");
      credential = { type: "ephemeral_token", value: token.name };
      authMode = "ephemeral";
    } catch (err) {
      console.warn("[interviewSim:mint] ephemeral mint failed, falling back to API key", err instanceof Error ? err.message : String(err));
      credential = { type: "api_key", value: apiKey };
      authMode = "apiKey";
    }

    const voiceId = args.voiceId ?? DEFAULT_VOICE;
    const sessionId = crypto.randomUUID();
    const title = `Mock interview: ${bundle.posting.title} at ${bundle.company.nameRaw}`;

    const callId = await ctx.runMutation(internal.interviewSim._createInterviewSession, {
      userId: bundle.user._id,
      jobPostingId: args.jobPostingId,
      sessionId,
      title,
      voiceId,
      model: LIVE_MODEL,
      authMode,
    });

    await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
      prepSessionId: args.prepSessionId,
      status: "ready",
      voiceCallId: callId,
    });

    return {
      ok: true,
      callId,
      sessionId,
      auth: credential,
      sessionConfig: {
        model: LIVE_MODEL,
        voice: voiceId,
        systemInstruction,
      },
    };
  },
});

// Internal counter query referenced above. Defined here in this file rather
// than interviewSim.ts because keeping the rate-limit logic adjacent to the
// rate-check it gates makes the policy easier to reason about.
import { internalQuery } from "./_generated/server";
export const _countRecentInterviews = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("voice_calls")
      .withIndex("by_user_created", (q) =>
        q.eq("userId", args.userId).gte("createdAt", args.since),
      )
      .collect();
    return rows.filter((r) => r.surface === "interview_job").length;
  },
});

// ─── _synthesizeInterviewResearch ─────────────────────────────────────────

export const _synthesizeInterviewResearch = internalAction({
  args: {
    prepSessionId: v.string(),
    companyId: v.id("companies"),
    companyName: v.string(),
    roleTitle: v.string(),
    cacheKeySlug: v.string(),
    runBundle: v.boolean(),
    runNews: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (!args.runBundle && !args.runNews) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SYNTHESIS_TIMEOUT_MS);

    try {
      const queries = buildInterviewQueries({
        companyName: args.companyName,
        roleTitle: args.roleTitle,
      });
      const newsQuery = buildNewsQuery({ companyName: args.companyName });

      type Slice = { answer: string; citations: Citation[]; costCents: number } | null;
      const fetchOne = async (q: string): Promise<Slice> => {
        try {
          const r = await exaAnswer(q, { signal: controller.signal });
          return { answer: r.answer, citations: r.citations, costCents: r.costCents };
        } catch (err) {
          console.error("[interviewSim:exa]", err instanceof Error ? err.message : String(err));
          return null;
        }
      };

      const [loop, questions, rigor, prestige, news] = await Promise.all([
        args.runBundle ? fetchOne(queries.loop) : Promise.resolve(null),
        args.runBundle ? fetchOne(queries.questions) : Promise.resolve(null),
        args.runBundle ? fetchOne(queries.rigor) : Promise.resolve(null),
        args.runBundle ? fetchOne(queries.prestigeSignals) : Promise.resolve(null),
        args.runNews ? fetchOne(newsQuery) : Promise.resolve(null),
      ]);

      let totalCostCents = 0;
      for (const r of [loop, questions, rigor, prestige, news]) {
        if (r) totalCostCents += r.costCents;
      }

      // News-only refresh path: write bullets directly from Exa, no LLM call.
      if (!args.runBundle && args.runNews && news) {
        const bullets = parseNewsBulletsFromExa(news.answer, news.citations).slice(0, 6);
        await ctx.runMutation(internal.interviewSim._patchCompanyResearchNews, {
          companyId: args.companyId,
          bullets,
        });
        return null;
      }

      // Bundle synthesis (also produces news bullets when news ran).
      const bundleAnyOk = loop || questions || rigor || prestige;
      if (!bundleAnyOk) {
        // Total Exa failure — write a generic-but-honest fallback so we don't
        // refetch on every call within 30d, and so the user can still proceed.
        await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
          prepSessionId: args.prepSessionId,
          status: "synthesizing",
          detail: "Falling back to a generic interviewer brief",
        });
        await ctx.runMutation(internal.interviewSim._patchInterviewBundle, {
          companyId: args.companyId,
          roleArchetypeSlug: args.cacheKeySlug,
          interviewProse: `We couldn't fetch live research for ${args.companyName}. The interview will use a generic ${args.roleTitle} loop calibrated to the role.`,
          interviewBundle: {
            ...fallbackBundle(),
            modelUsed: "fallback",
          },
          costCents: totalCostCents,
        });
        return null;
      }

      await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
        prepSessionId: args.prepSessionId,
        status: "synthesizing",
      });

      const synthesisPrompt = buildSynthesisPrompt({
        companyName: args.companyName,
        roleTitle: args.roleTitle,
        exaResults: {
          loop: loop ?? undefined,
          questions: questions ?? undefined,
          rigor: rigor ?? undefined,
          prestigeSignals: prestige ?? undefined,
        },
        newsAnswer: news ?? undefined,
      });

      const { experimental_output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        experimental_output: Output.object({ schema: InterviewSynthesisSchema }),
        prompt: synthesisPrompt,
        abortSignal: controller.signal,
      });

      const out = experimental_output;
      // Persist bundle.
      await ctx.runMutation(internal.interviewSim._patchInterviewBundle, {
        companyId: args.companyId,
        roleArchetypeSlug: args.cacheKeySlug,
        interviewProse: out.interviewProse,
        interviewBundle: { ...out.interviewBundle, modelUsed: CONTENT_MODEL_ID },
        citations: collectCitations({ loop, questions, rigor, prestige }),
        costCents: totalCostCents,
      });

      // Persist news (when present).
      if (out.recentNews?.bullets?.length) {
        await ctx.runMutation(internal.interviewSim._patchCompanyResearchNews, {
          companyId: args.companyId,
          bullets: out.recentNews.bullets.slice(0, 6),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[interviewSim:synthesis] failed", msg);
      await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
        prepSessionId: args.prepSessionId,
        status: "failed",
        error: msg,
      });
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

// ─── processInterviewAnalysis (post-call rubric) ──────────────────────────

export const processInterviewAnalysis = internalAction({
  args: { callId: v.id("voice_calls") },
  returns: v.null(),
  handler: async (ctx: ActionCtx, args): Promise<null> => {
    const call = await ctx.runQuery(internal.voiceCalls._getCallById, {
      callId: args.callId,
    });
    if (!call) return null;
    if (call.surface !== "interview_job") return null;
    if (call.messages.length < 4) return null;

    // Reload the bundle the call was grounded in.
    const posting = await ctx.runQuery(internal.interviewSim._getPostingWithCompanyAndBundle, {
      jobPostingId: call.jobPostingId!,
    });
    if (!posting?.bundle) return null;

    const transcript = formatTranscript(call.messages);
    const candidateBrief: CandidateContext = posting.candidate;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
    try {
      let attempt = 0;
      let failedQuotes: string[] | undefined;
      let rubric: import("../lib/ai/prompts/interviewer").InterviewRubric | null = null;

      while (attempt < 2) {
        attempt += 1;
        const prompt = buildRubricPrompt({
          candidate: candidateBrief,
          posting: { title: posting.postingTitle, city: posting.city, excerpt: undefined },
          company: { name: posting.companyName },
          bundle: posting.bundle,
          transcript,
          failedQuotes,
        });
        const { experimental_output } = await generateText({
          model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
          experimental_output: Output.object({ schema: InterviewRubricSchema }),
          prompt,
          abortSignal: controller.signal,
        });
        rubric = experimental_output;

        const check = enforceVerbatimQuotes({
          transcript,
          bestQuote: rubric.bestMoment.quote,
          missQuote: rubric.biggestMiss.quote,
        });
        if (check.ok) break;
        failedQuotes = check.missing;
      }

      if (!rubric) return null;

      // If verbatim check failed twice, strip the offending quote fields.
      const stripped = await stripFailedQuotesIfStillBad(transcript, rubric);

      await ctx.runMutation(internal.voiceCalls._patchAnalysis, {
        callId: args.callId,
        aiSummary: stripped,
      });
    } catch (err) {
      console.error("[interviewSim:analysis] failed", err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

// ─── helpers ──────────────────────────────────────────────────────────────

function formatTranscript(
  messages: Array<{ role: string; content: string }>,
): string {
  return messages
    .map((m) => `${m.role === "user" ? "Candidate" : "Interviewer"}: ${m.content}`)
    .join("\n");
}

function fallbackBundle() {
  return {
    rounds: [
      { name: "Recruiter screen", focus: "Mutual fit + basic background", interviewerArchetype: "recruiter" },
      { name: "Hiring manager", focus: "Experience and motivation", interviewerArchetype: "hiring manager" },
      { name: "Role-specific deep dive", focus: "Skills relevant to the role", interviewerArchetype: "senior practitioner" },
    ],
    signatureQuestions: [
      { question: "Tell me about yourself.", rationale: "Generic opener." },
      { question: "Why are you interested in this role?", rationale: "Tests motivation." },
      { question: "Walk me through a project you're proud of.", rationale: "Tests depth." },
      { question: "Tell me about a time you handled a difficult situation.", rationale: "Behavioral." },
      { question: "What questions do you have for me?", rationale: "Closer." },
    ],
    rubric: {
      rigor: 3,
      rigorRationale: "Generic fallback — no live research available.",
      interviewerArchetype: "hiring manager",
      dimensions: [
        { key: "structure", anchorBelow: "Rambling.", anchorAt: "STAR or similar.", anchorAbove: "Crisp + quantified." },
        { key: "depth", anchorBelow: "Surface-only.", anchorAt: "Adequate detail.", anchorAbove: "Probes own assumptions." },
        { key: "role-fit", anchorBelow: "Misaligned.", anchorAt: "Plausible match.", anchorAbove: "Strong evidence." },
        { key: "company-fit", anchorBelow: "Generic.", anchorAt: "Aware of the company.", anchorAbove: "Specific + informed." },
      ],
    },
    prestigeSignals: {},
    generatedAt: Date.now(),
    modelUsed: "fallback",
  };
}

function collectCitations(slices: Record<string, { citations: Citation[] } | null>) {
  const out: Record<string, Citation[]> = {};
  const interviewCitations: Citation[] = [];
  for (const k of Object.keys(slices)) {
    const c = slices[k]?.citations ?? [];
    interviewCitations.push(...c);
  }
  if (interviewCitations.length) out.interview = interviewCitations.slice(0, 12);
  return out;
}

function parseNewsBulletsFromExa(answer: string, citations: Citation[]) {
  // Heuristic: split prose answer by sentence, pair sequentially with
  // citations until exhausted. Conservative to avoid hallucinated headlines —
  // if Exa returns no citations, return [].
  if (!citations.length) return [];
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const bullets: Array<{
    headline: string;
    summary: string;
    sourceUrl: string;
    publisher?: string;
    publishedAt?: number;
  }> = [];
  for (let i = 0; i < Math.min(sentences.length, citations.length); i++) {
    const s = sentences[i];
    const c = citations[i];
    bullets.push({
      headline: c.title.length > 100 ? `${c.title.slice(0, 97)}…` : c.title,
      summary: s.length > 200 ? `${s.slice(0, 197)}…` : s,
      sourceUrl: c.url,
      publisher: c.publisher,
    });
  }
  return bullets;
}

async function stripFailedQuotesIfStillBad(
  transcript: string,
  rubric: import("../lib/ai/prompts/interviewer").InterviewRubric,
) {
  const check = enforceVerbatimQuotes({
    transcript,
    bestQuote: rubric.bestMoment.quote,
    missQuote: rubric.biggestMiss.quote,
  });
  if (check.ok) return rubric;
  return {
    ...rubric,
    bestMoment: { quote: "", why: rubric.bestMoment.why },
    biggestMiss: { quote: "", why: rubric.biggestMiss.why, betterAnswerSketch: rubric.biggestMiss.betterAnswerSketch },
  };
}
```

- [ ] **Step 2: Add the `_getPostingWithCompanyAndBundle` query referenced in `processInterviewAnalysis`** to `convex/interviewSim.ts`

Append to `convex/interviewSim.ts`:

```ts
// Bundled query for processInterviewAnalysis — single round-trip.
export const _getPostingWithCompanyAndBundle = internalQuery({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.union(
    v.null(),
    v.object({
      postingTitle: v.string(),
      city: v.optional(v.string()),
      companyName: v.string(),
      bundle: v.union(v.null(), v.any()),
      candidate: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) return null;
    const company = await ctx.db.get(posting.companyId);
    if (!company) return null;

    const slug = posting.roleArchetypeSlug ?? `untyped-${posting.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 64)}`;
    const role = await ctx.db
      .query("company_role_research")
      .withIndex("by_companyId_archetype", (q) =>
        q.eq("companyId", posting.companyId).eq("roleArchetypeSlug", slug),
      )
      .unique();

    return {
      postingTitle: posting.title,
      city: posting.city,
      companyName: company.nameRaw,
      bundle: role?.interviewBundle ?? null,
      candidate: { firstName: "Candidate" }, // fuller candidate brief loaded
                                             // from the call's userId in a
                                             // future iteration; rubric prompt
                                             // tolerates a thin candidate.
    };
  },
});
```

(The thin `candidate` brief is intentional for MVP — the rubric prompt grades against the bundle, not against the candidate's profile. A richer brief is a small follow-up; doing it now requires another join in this query and bloats the diff.)

- [ ] **Step 3: Verify `_getCallById` and `_patchAnalysis` exist on `voiceCalls`**

Run:

```bash
grep -n "_getCallById\|_patchAnalysis" convex/voiceCalls.ts
```

Expected: both should be defined. If not, halt and report.

- [ ] **Step 4: Push and verify**

```bash
npx convex dev --once
```

Expected: clean. New module appears in `convex/_generated/api.d.ts`. TypeScript compiles.

- [ ] **Step 5: Commit**

```bash
git add convex/interviewSimNode.ts convex/interviewSim.ts convex/_generated/
git commit -m "feat(interviewSim): Node mint action + research synthesis + post-call rubric

- mintInterviewSession: auth, cache check, parallel-stale refresh, mint, row insert
- _synthesizeInterviewResearch: 5 parallel Exa queries, single LLM synthesis, atomic write
- processInterviewAnalysis: rubric grading with verbatim-quote retry + strip fallback
- 5 / 24h per-user rate limit
- Generic fallback bundle when all Exa queries fail (lets the user proceed)"
```

---

## Task 7: Branch `voiceCalls.finalize` to dispatch interview analysis

**Files:**
- Modify: `convex/voiceCalls.ts:152-186`

`voiceCalls.finalize` currently always schedules `voiceCallsNode.processCallAnalysis`. Interview rows need `interviewSimNode.processInterviewAnalysis` instead. Dispatch on `surface`.

- [ ] **Step 1: Update the dispatcher**

In `convex/voiceCalls.ts`, find the block at lines 176-182 inside `finalize`:

```ts
    if (args.status === "completed" && row.messages.length >= 2) {
      await ctx.scheduler.runAfter(
        0,
        internal.voiceCallsNode.processCallAnalysis,
        { callId: row._id },
      );
    }
```

Replace with:

```ts
    if (args.status === "completed" && row.messages.length >= 2) {
      // Surface-aware dispatch. Interview rows need a different rubric
      // (verbatim-quote enforcement, calibrated against the bundle); other
      // surfaces continue to use the deep-dive summary pipeline.
      if (row.surface === "interview_job") {
        if (row.messages.length >= 4) {
          await ctx.scheduler.runAfter(
            0,
            internal.interviewSimNode.processInterviewAnalysis,
            { callId: row._id },
          );
        }
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.voiceCallsNode.processCallAnalysis,
          { callId: row._id },
        );
      }
    }
```

- [ ] **Step 2: Push and verify**

```bash
npx convex dev --once
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add convex/voiceCalls.ts
git commit -m "feat(voiceCalls): dispatch interview rows to interviewSim post-call analysis"
```

---

## Task 8: `useInterviewCall.ts` — clone `useJobVoiceCall` and retarget

**Files:**
- Create: `components/jobs/voice/interview/useInterviewCall.ts`

Cloning is intentional: the existing hook is ~300 lines of WebSocket + PCM plumbing that's identical between surfaces and works correctly. Refactoring it to be parameterized risks regression in the working deep-dive path; cloning isolates the new feature. A unification refactor is a follow-up once both paths are battle-tested.

- [ ] **Step 1: Read the existing hook to clone**

```bash
wc -l components/jobs/voice/useJobVoiceCall.ts
```

Expected: ~300 lines.

- [ ] **Step 2: Copy + retarget**

```bash
mkdir -p components/jobs/voice/interview
cp components/jobs/voice/useJobVoiceCall.ts components/jobs/voice/interview/useInterviewCall.ts
```

- [ ] **Step 3: Edit `components/jobs/voice/interview/useInterviewCall.ts`** with these substitutions (use `sed` or your editor):

Substitutions to apply:

| Find | Replace |
|---|---|
| `useJobVoiceCall` | `useInterviewCall` |
| `JobCallState` | `InterviewCallState` |
| `JobTranscriptEntry` | `InterviewTranscriptEntry` |
| `UseJobVoiceCallArgs` | `UseInterviewCallArgs` |
| `UseJobVoiceCallReturn` | `UseInterviewCallReturn` |
| `api.jobVoiceNode.mintJobSession` | `api.interviewSimNode.mintInterviewSession` |
| (the doc-comment header) | replace with the comment block below |

Top-of-file comment:

```ts
/**
 * Realtime voice hook for the interview-simulation feature.
 *
 * Cloned from useJobVoiceCall — the WebSocket + PCM plumbing is identical
 * to the deep-dive call. The differences:
 *   - mints from api.interviewSimNode.mintInterviewSession (passing
 *     prepSessionId so the server can write status updates the dialog
 *     subscribes to)
 *   - returns the same shape as useJobVoiceCall so the dialog body can
 *     stay near-identical
 *
 * A unification refactor (extract the WebSocket loop into a shared base
 * hook taking a `mintActionRef`) is a deliberate post-MVP follow-up.
 */
```

The `mintInterviewSession` action takes a `prepSessionId` arg the deep-dive does not. Find the `useAction` invocation in the hook (the line that calls `mint` with `{ jobPostingId, voiceId }`) and update it:

```ts
const prepSessionIdRef = useRef<string | null>(null);
// ... in startCall, before calling mint:
if (!prepSessionIdRef.current) {
  prepSessionIdRef.current = crypto.randomUUID();
}
const result = await mint({
  jobPostingId: args.jobPostingId,
  prepSessionId: prepSessionIdRef.current,
  voiceId: args.voiceId,
});
```

Add `prepSessionId` to `UseInterviewCallReturn` so the dialog can subscribe to the prep status doc:

```ts
export type UseInterviewCallReturn = {
  // ... existing fields ...
  prepSessionId: string | null;
};
```

And in the hook return:

```ts
return {
  // ... existing fields ...
  prepSessionId: prepSessionIdRef.current,
};
```

Also handle the new `reason` values in the `ok: false` branch — when `reason === "rate-limited"` or `reason === "research-failed"`, set `error` to a user-facing string and short-circuit:

```ts
if (!result.ok) {
  const reasonMap: Record<typeof result.reason, string> = {
    anonymous: "Please sign in to start an interview.",
    "posting-not-found": "We couldn't find this posting.",
    "posting-not-ready": "This posting is still being prepared.",
    "rate-limited": "You've run 5 mock interviews today. Come back tomorrow.",
    "research-failed": "We couldn't research this company right now.",
    "no-api-key": "Voice service is unavailable. Please try again shortly.",
  };
  setError(reasonMap[result.reason]);
  setCallState("error");
  return;
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors involving `useInterviewCall.ts`.

- [ ] **Step 5: Commit**

```bash
git add components/jobs/voice/interview/useInterviewCall.ts
git commit -m "feat(interviewSim): useInterviewCall hook (cloned from useJobVoiceCall)"
```

---

## Task 9: `InterviewPrepProgress.tsx` — Phase 1 UI

**Files:**
- Create: `components/jobs/voice/interview/InterviewPrepProgress.tsx`

A pure presentation component: receives the prep status from a parent that subscribes to `interviewSim.subscribeToPrep`. Uses lucide icons only.

- [ ] **Step 1: Implement**

```tsx
"use client";

import { Loader2, Search, FileText, Sparkles, Phone, AlertCircle } from "lucide-react";

export type PrepStatus =
  | "researching"
  | "synthesizing"
  | "minting_token"
  | "ready"
  | "failed";

type Props = {
  status: PrepStatus;
  detail?: string;
  error?: string;
  companyName?: string;
};

const STEPS: Array<{
  status: PrepStatus;
  label: (companyName?: string) => string;
  Icon: typeof Loader2;
}> = [
  {
    status: "researching",
    label: (c) => (c ? `Reviewing how ${c} interviews for this role…` : "Reviewing how this company interviews for this role…"),
    Icon: Search,
  },
  {
    status: "synthesizing",
    label: () => "Tuning your interviewer…",
    Icon: Sparkles,
  },
  {
    status: "minting_token",
    label: () => "Connecting…",
    Icon: Phone,
  },
];

const ORDER: Record<PrepStatus, number> = {
  researching: 0,
  synthesizing: 1,
  minting_token: 2,
  ready: 3,
  failed: -1,
};

export function InterviewPrepProgress({ status, detail, error, companyName }: Props) {
  if (status === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-mute" strokeWidth={1.5} />
        <p className="text-sm text-ink">We couldn't prepare your interviewer.</p>
        {error && <p className="text-[12px] text-mute">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-6">
      {STEPS.map((step) => {
        const idx = ORDER[step.status];
        const cur = ORDER[status];
        const done = cur > idx;
        const active = cur === idx;
        const upcoming = cur < idx;
        return (
          <div key={step.status} className="flex items-center gap-3">
            <span
              aria-hidden
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
                done ? "bg-ink/10" : active ? "bg-ink" : "bg-paper-raised"
              }`}
            >
              {active ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-paper" strokeWidth={2} />
              ) : (
                <step.Icon
                  className={`h-3.5 w-3.5 ${done ? "text-ink" : "text-mute"}`}
                  strokeWidth={1.75}
                />
              )}
            </span>
            <p
              className={`text-[13px] ${
                upcoming ? "text-mute" : "text-ink"
              }`}
            >
              {step.label(companyName ?? detail)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/jobs/voice/interview/InterviewPrepProgress.tsx
git commit -m "feat(interviewSim): InterviewPrepProgress UI"
```

---

## Task 10: `InterviewLiveCall.tsx` — Phase 2 wrapper

**Files:**
- Create: `components/jobs/voice/interview/InterviewLiveCall.tsx`

Thin wrapper around `useInterviewCall` that mirrors the body of `JobVoiceCallDialog` for the live-call portion (Rive halo, transcript toggle, status, controls). The dialog (Task 12) owns the modal chrome and phase routing.

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRive, useStateMachineInput } from "@rive-app/react-webgl2";
import type { Id } from "@/convex/_generated/dataModel";
import { useInterviewCall } from "./useInterviewCall";
import { VoiceCallHeader } from "@/components/career-guides/voice-call/VoiceCallHeader";
import { VoiceCallAnimation } from "@/components/career-guides/voice-call/VoiceCallAnimation";
import { VoiceCallTranscription } from "@/components/career-guides/voice-call/VoiceCallTranscription";
import { VoiceCallStatus } from "@/components/career-guides/voice-call/VoiceCallStatus";
import { VoiceCallControls } from "@/components/career-guides/voice-call/VoiceCallControls";
import { useCallTimer } from "@/components/career-guides/voice-call/useCallTimer";

type Props = {
  jobPostingId: Id<"job_postings">;
  callTitle: string;
  voiceId?: string;
  onEnded: (callId: Id<"voice_calls"> | null) => void;
  onPrepSessionId: (id: string) => void;
};

export function InterviewLiveCall({
  jobPostingId,
  callTitle,
  voiceId,
  onEnded,
  onPrepSessionId,
}: Props) {
  const call = useInterviewCall({ jobPostingId, voiceId });
  const [showTranscription, setShowTranscription] = useState(false);
  const [hasReportedEnded, setHasReportedEnded] = useState(false);

  const timer = useCallTimer({
    callState: call.callState,
    isAITalking: call.isAITalking,
    userSpeaking: call.userSpeaking,
  });

  const { rive, RiveComponent } = useRive({
    src: "/halo-2.0.riv",
    stateMachines: "default",
    autoplay: true,
  });
  const listeningInput = useStateMachineInput(rive, "default", "listening");
  const thinkingInput = useStateMachineInput(rive, "default", "thinking");
  const speakingInput = useStateMachineInput(rive, "default", "speaking");

  const isListening =
    call.callState === "connected" && call.userSpeaking && !call.isAITalking;
  const isThinking =
    call.callState === "connecting" ||
    (call.callState === "connected" && !call.userSpeaking && !call.isAITalking);
  const isSpeaking = call.callState === "connected" && call.isAITalking;

  useEffect(() => {
    if (listeningInput) listeningInput.value = isListening;
    if (thinkingInput) thinkingInput.value = isThinking;
    if (speakingInput) speakingInput.value = isSpeaking;
  }, [isListening, isThinking, isSpeaking, listeningInput, thinkingInput, speakingInput]);

  // Auto-start on mount.
  useEffect(() => {
    void call.startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface prep session id upward as soon as we have it.
  useEffect(() => {
    if (call.prepSessionId) onPrepSessionId(call.prepSessionId);
  }, [call.prepSessionId, onPrepSessionId]);

  // Notify parent when the call ends so it can advance to Phase 3.
  useEffect(() => {
    if ((call.callState === "ended" || call.callState === "error") && !hasReportedEnded) {
      setHasReportedEnded(true);
      onEnded(call.callId ?? null);
    }
  }, [call.callState, call.callId, hasReportedEnded, onEnded]);

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-hidden p-4 sm:p-6">
      <VoiceCallHeader
        guideTitle={callTitle}
        duration={timer.duration}
        formatDuration={timer.formatDuration}
      />

      {!showTranscription ? (
        <VoiceCallAnimation RiveComponent={RiveComponent} rive={rive} />
      ) : (
        <VoiceCallTranscription
          messages={call.transcript}
          currentAssistantUtterance={call.currentAssistantUtterance}
          callState={call.callState}
        />
      )}

      {(call.callState === "connected" || call.callState === "connecting") && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowTranscription((v) => !v)}
            className="rounded-pill bg-paper-raised px-4 py-1.5 text-[12px] font-medium text-mute transition-colors duration-200 hover:bg-ink/5 hover:text-ink"
          >
            {showTranscription ? "Show animation" : "Show transcript"}
          </button>
        </div>
      )}

      <VoiceCallStatus statusText={statusFor(call.callState)} error={call.error} />

      <VoiceCallControls
        callState={call.callState}
        isMuted={call.isMuted}
        isProcessing={false}
        onToggleMute={call.toggleMute}
        onEndCall={async () => {
          await call.endCall();
        }}
        onClose={() => void 0}
      />
    </div>
  );
}

function statusFor(state: string): string {
  switch (state) {
    case "idle":
      return "Ready to connect";
    case "connecting":
      return "Connecting to your interviewer…";
    case "connected":
      return "Interview in progress";
    case "ended":
      return "Interview complete";
    case "error":
      return "Connection error";
    default:
      return "";
  }
}
```

Note: `useInterviewCall` doesn't expose `callId` in the cloned hook by default; if it doesn't, add it (it should be returned from the mint result already). If you find it isn't surfaced, add `callId: callIdRef.current` to the returned object in `useInterviewCall.ts`.

- [ ] **Step 2: Commit**

```bash
git add components/jobs/voice/interview/InterviewLiveCall.tsx
git commit -m "feat(interviewSim): InterviewLiveCall wrapper"
```

---

## Task 11: `InterviewFeedback.tsx` — Phase 3 rubric render

**Files:**
- Create: `components/jobs/voice/interview/InterviewFeedback.tsx`

Subscribes to the `voice_calls` row by call id. Renders the rubric when `aiSummary` populates; skeleton otherwise. Layout per the spec.

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ChevronDown, Loader2, MessageSquareQuote, Sparkles, Target, X } from "lucide-react";
import { useState } from "react";
import type { InterviewRubric } from "@/lib/ai/prompts/interviewer";

type Props = {
  callId: Id<"voice_calls">;
  onClose: () => void;
};

export function InterviewFeedback({ callId, onClose }: Props) {
  const call = useQuery(api.voiceCalls.getCallById, { callId });
  const summary = call?.aiSummary as InterviewRubric | undefined;

  if (!call) return null;
  if (call.messages.length < 4) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <Target className="h-8 w-8 text-mute" strokeWidth={1.5} />
        <p className="text-sm text-ink">Call ended before we had enough to grade.</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-pill bg-ink px-4 py-1.5 text-[13px] font-medium text-paper hover:bg-ink-deep"
        >
          Close
        </button>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-mute" strokeWidth={1.5} />
        <p className="text-sm text-ink">Analyzing your interview…</p>
        <p className="text-[12px] text-mute">Usually 10–15 seconds.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] uppercase tracking-wide text-mute">Mock interview · {call.title}</p>
          <p className="mt-1 text-[28px] font-medium leading-none text-ink [font-family:var(--font-serif)]">
            {summary.overallScore.toFixed(1)}<span className="text-[18px] text-mute">/5</span>
          </p>
          <p className="mt-2 text-[14px] text-ink">{summary.oneLineVerdict}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-mute hover:text-ink">
          <X className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {summary.dimensions.map((d) => (
          <div key={d.key} className="border-hairline rounded-card border bg-paper-raised p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium capitalize text-ink">{d.key.replace(/-/g, " ")}</p>
              <p className="text-[16px] font-medium text-ink">
                {d.score == null ? <span className="text-mute">—</span> : `${d.score}/5`}
              </p>
            </div>
            {d.whatWorked && d.whatWorked !== "—" && (
              <p className="mt-2 text-[12px] text-ink">
                <span className="font-medium">Worked:</span> {d.whatWorked}
              </p>
            )}
            {d.whatToFix && d.whatToFix !== "—" && (
              <p className="mt-1 text-[12px] text-mute">
                <span className="font-medium">To fix:</span> {d.whatToFix}
              </p>
            )}
          </div>
        ))}
      </div>

      {summary.bestMoment.quote && (
        <Card icon={Sparkles} title="Best moment">
          <blockquote className="rounded-card bg-paper-raised p-3 font-mono text-[12px] text-ink">
            "{summary.bestMoment.quote}"
          </blockquote>
          <p className="mt-2 text-[12px] text-mute">{summary.bestMoment.why}</p>
        </Card>
      )}

      {summary.biggestMiss.quote && (
        <Card icon={MessageSquareQuote} title="Biggest miss">
          <blockquote className="rounded-card bg-paper-raised p-3 font-mono text-[12px] text-ink">
            "{summary.biggestMiss.quote}"
          </blockquote>
          <p className="mt-2 text-[12px] text-mute">{summary.biggestMiss.why}</p>
          <p className="mt-2 text-[12px] text-ink">
            <span className="font-medium">A stronger answer might:</span> {summary.biggestMiss.betterAnswerSketch}
          </p>
        </Card>
      )}

      <div>
        <p className="text-[13px] font-medium text-ink">Three things to do next</p>
        <div className="mt-2 flex flex-col gap-2">
          {summary.nextStepExercises.map((e, i) => (
            <Exercise key={i} title={e.title} why={e.why} how={e.how} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, children }: { icon: typeof X; title: string; children: React.ReactNode }) {
  return (
    <div className="border-hairline rounded-card border p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Exercise({ title, why, how }: { title: string; why: string; how: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-hairline rounded-card border bg-paper-raised">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <span className="text-[13px] font-medium text-ink">{title}</span>
        <ChevronDown
          className={`h-4 w-4 text-mute transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div className="border-t-hairline border-t px-3 pb-3 pt-2">
          <p className="text-[12px] text-mute">{why}</p>
          <p className="mt-1 text-[12px] text-ink">{how}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify `voiceCalls.getCallById` is a public query**

Run:

```bash
grep -n "export const getCallById\|export const getCall " convex/voiceCalls.ts
```

If `getCallById` is not currently public, add a public wrapper to `convex/voiceCalls.ts`:

```ts
export const getCallById = query({
  args: { callId: v.id("voice_calls") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return null;
    const row = await ctx.db.get(args.callId);
    if (!row || row.userId !== user._id) return null;
    return row;
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add components/jobs/voice/interview/InterviewFeedback.tsx convex/voiceCalls.ts
git commit -m "feat(interviewSim): InterviewFeedback rubric UI"
```

---

## Task 12: `InterviewSimDialog.tsx` — modal orchestrator (3 phases)

**Files:**
- Create: `components/jobs/voice/interview/InterviewSimDialog.tsx`

Owns modal chrome and phase routing. Three phases: prep (subscribed via `subscribeToPrep`), live (delegated to `InterviewLiveCall`), feedback (delegated to `InterviewFeedback`).

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Id } from "@/convex/_generated/dataModel";
import { InterviewPrepProgress, type PrepStatus } from "./InterviewPrepProgress";
import { InterviewLiveCall } from "./InterviewLiveCall";
import { InterviewFeedback } from "./InterviewFeedback";

type Props = {
  jobPostingId: Id<"job_postings">;
  callTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voiceId?: string;
  companyName?: string;
};

type Phase = "prep" | "live" | "feedback";

export function InterviewSimDialog({
  jobPostingId,
  callTitle,
  open,
  onOpenChange,
  voiceId,
  companyName,
}: Props) {
  const [phase, setPhase] = useState<Phase>("prep");
  const [prepSessionId, setPrepSessionId] = useState<string | null>(null);
  const [endedCallId, setEndedCallId] = useState<Id<"voice_calls"> | null>(null);

  // Subscribe to the prep status doc once we have a prepSessionId.
  const prep = useQuery(
    api.interviewSim.subscribeToPrep,
    prepSessionId ? { prepSessionId } : "skip",
  );

  // Reset state when the dialog closes.
  useEffect(() => {
    if (!open) {
      setPhase("prep");
      setPrepSessionId(null);
      setEndedCallId(null);
    }
  }, [open]);

  // Auto-advance from prep → live as soon as the server reports ready.
  // The live call is mounted from open=true; the prep progress just
  // determines what we render in the dialog body until ready.
  const liveReady = prep?.status === "ready";

  // The InterviewLiveCall reports the call id when the call ends; we then
  // flip to phase=feedback.
  const handleEnded = (id: Id<"voice_calls"> | null) => {
    setEndedCallId(id);
    setPhase("feedback");
  };

  const dialogTitleText =
    phase === "feedback" ? `Mock interview feedback: ${callTitle}` : `Mock interview: ${callTitle}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block close while live (the InterviewLiveCall handles end-call
        // gracefully; we just stop the user from accidentally torpedoing
        // their interview with a click outside).
        if (!next && phase === "live") return;
        onOpenChange(next);
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-black/40" />
        <DialogContent
          showCloseButton={false}
          className="mx-auto w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-2xl border-0 p-0 shadow-2xl sm:rounded-3xl"
        >
          <DialogTitle className="sr-only">{dialogTitleText}</DialogTitle>

          <div className="relative flex min-h-[600px] max-h-[90vh] flex-col bg-paper">
            {/* Phase 1: prep — visible until liveReady && phase==="prep" */}
            {phase === "prep" && !liveReady && (
              <InterviewPrepProgress
                status={(prep?.status ?? "researching") as PrepStatus}
                detail={prep?.detail}
                error={prep?.error}
                companyName={companyName}
              />
            )}

            {/* Phase 1→2 transition: render the live call as soon as ready,
                or always (mounting it kicks off the mint flow that writes
                the prep status). */}
            {(phase === "prep" && liveReady) || phase === "live" ? (
              <InterviewLiveCall
                jobPostingId={jobPostingId}
                callTitle={callTitle}
                voiceId={voiceId}
                onEnded={handleEnded}
                onPrepSessionId={(id) => {
                  setPrepSessionId(id);
                  if (phase === "prep" && liveReady) setPhase("live");
                }}
              />
            ) : null}

            {/* Mount-once invisible bootstrapper: the InterviewLiveCall will
                START the prep on mount because useInterviewCall.startCall
                runs immediately. We mount it offscreen during prep so the
                mint kicks off; once liveReady flips we hoist it into view. */}
            {phase === "prep" && !liveReady && (
              <div className="sr-only" aria-hidden>
                <InterviewLiveCall
                  jobPostingId={jobPostingId}
                  callTitle={callTitle}
                  voiceId={voiceId}
                  onEnded={() => void 0}
                  onPrepSessionId={(id) => setPrepSessionId(id)}
                />
              </div>
            )}

            {phase === "feedback" && endedCallId && (
              <InterviewFeedback
                callId={endedCallId}
                onClose={() => onOpenChange(false)}
              />
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
```

> Note on the "mount-once invisible bootstrapper" pattern: `useInterviewCall.startCall` triggers the mint, which writes the prep status the dialog subscribes to. We need it mounted to start the flow. During prep we render `InterviewPrepProgress` (visible) and `InterviewLiveCall` (offscreen, sr-only). When the server flips status to `ready`, the live call swaps in. This avoids a double-mount race.

- [ ] **Step 2: Commit**

```bash
git add components/jobs/voice/interview/InterviewSimDialog.tsx
git commit -m "feat(interviewSim): InterviewSimDialog (3-phase modal orchestrator)"
```

---

## Task 13: `InterviewSimCallTile.tsx` — listing CTA tile

**Files:**
- Create: `components/jobs/voice/interview/InterviewSimCallTile.tsx`

Sibling of `JobVoiceCallTile`. Distinct icon (`Mic`), distinct copy, anonymous variant links to sign-in.

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Mic } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import { InterviewSimDialog } from "./InterviewSimDialog";

type Variant = "aside" | "byline-inline";

type Props = {
  jobPostingId: Id<"job_postings">;
  callTitle: string;
  companyName: string;
  listingPath: string;
  variant: Variant;
  className?: string;
};

export function InterviewSimCallTile({
  jobPostingId,
  callTitle,
  companyName,
  listingPath,
  variant,
  className,
}: Props) {
  const { isLoaded, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);

  const signInHref = useMemo(() => {
    const qs = new URLSearchParams({ redirect_url: listingPath });
    return `/sign-in?${qs.toString()}`;
  }, [listingPath]);

  if (variant === "byline-inline") {
    if (!isLoaded) return null;
    if (!isSignedIn) {
      return (
        <Link
          href={signInHref}
          className={cn(
            "lg:hidden inline-flex items-center gap-1 text-[13px] font-medium text-ink/85 underline-offset-4 transition-colors hover:text-ink hover:underline",
            className,
          )}
        >
          <Mic aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          Sign in to mock interview
          <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        </Link>
      );
    }
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "lg:hidden inline-flex items-center gap-1 text-[13px] font-medium text-ink/85 underline-offset-4 transition-colors hover:text-ink hover:underline",
            className,
          )}
        >
          <Mic aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          Mock interview
          <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        </button>
        <InterviewSimDialog
          jobPostingId={jobPostingId}
          callTitle={callTitle}
          companyName={companyName}
          open={open}
          onOpenChange={setOpen}
        />
      </>
    );
  }

  // ── aside variant ─────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "border-hairline bg-paper-raised rounded-card border p-4",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="bg-ink mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        >
          <Mic className="h-3.5 w-3.5 text-paper" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">Mock interview</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-mute">
            Realistic 10–15 minute simulation, calibrated to how {companyName} actually interviews for this role.
          </p>
        </div>
      </div>

      <div className="mt-3.5">
        {!isLoaded && (
          <button
            type="button"
            disabled
            className="inline-flex h-8 w-full items-center justify-center rounded-pill border border-hairline bg-paper px-3 text-[12px] font-medium text-mute"
            aria-hidden
          >
            Loading…
          </button>
        )}
        {isLoaded && !isSignedIn && (
          <Link
            href={signInHref}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-pill border border-hairline bg-paper px-3 text-[12px] font-medium text-ink transition-colors hover:bg-paper-raised"
          >
            Sign in to start
            <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
          </Link>
        )}
        {isLoaded && isSignedIn && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-pill bg-ink px-3 text-[12px] font-medium text-paper transition-colors hover:bg-ink-deep"
          >
            Start mock interview
            <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {isLoaded && isSignedIn && (
        <InterviewSimDialog
          jobPostingId={jobPostingId}
          callTitle={callTitle}
          companyName={companyName}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/jobs/voice/interview/InterviewSimCallTile.tsx
git commit -m "feat(interviewSim): InterviewSimCallTile (CTA, anonymous + signed-in variants)"
```

---

## Task 14: Wire `InterviewSimCallTile` into `JobPostingArticle.tsx`

**Files:**
- Modify: `components/jobs/JobPostingArticle.tsx`

Two placements (matches the existing `JobVoiceCallTile` placement):
- Byline-inline at ~line 552
- Aside at ~line 682

- [ ] **Step 1: Add import**

At the top of `components/jobs/JobPostingArticle.tsx`, alongside `JobVoiceCallTile`:

```ts
import { InterviewSimCallTile } from "./voice/interview/InterviewSimCallTile";
```

- [ ] **Step 2: Add the byline-inline placement after the existing JobVoiceCallTile (around line 552-558)**

Find:

```tsx
        {!isArchived && listingPath && callTitle && (
          <>
            <MetaSeparator />
            <JobVoiceCallTile
              jobPostingId={posting._id}
              callTitle={callTitle}
              listingPath={listingPath}
              variant="byline-inline"
            />
          </>
        )}
```

Replace with:

```tsx
        {!isArchived && listingPath && callTitle && (
          <>
            <MetaSeparator />
            <JobVoiceCallTile
              jobPostingId={posting._id}
              callTitle={callTitle}
              listingPath={listingPath}
              variant="byline-inline"
            />
            <MetaSeparator />
            <InterviewSimCallTile
              jobPostingId={posting._id}
              callTitle={callTitle}
              companyName={posting.companyNameRaw ?? posting.companyName ?? "this company"}
              listingPath={listingPath}
              variant="byline-inline"
            />
          </>
        )}
```

> Note: `posting.companyNameRaw` / `posting.companyName` field name varies by where `JobPostingArticle` is composed. Check the existing code for which field carries the human-readable company name. If neither exists, derive it from a passed-in `company` prop.

- [ ] **Step 3: Add the aside placement after the existing JobVoiceCallTile (around line 681-688)**

Find:

```tsx
      {!isArchived && (
        <JobVoiceCallTile
          jobPostingId={posting._id}
          callTitle={callTitle}
          listingPath={listingPath}
          variant="aside"
        />
      )}
```

Replace with:

```tsx
      {!isArchived && (
        <>
          <JobVoiceCallTile
            jobPostingId={posting._id}
            callTitle={callTitle}
            listingPath={listingPath}
            variant="aside"
          />
          <InterviewSimCallTile
            jobPostingId={posting._id}
            callTitle={callTitle}
            companyName={posting.companyNameRaw ?? posting.companyName ?? "this company"}
            listingPath={listingPath}
            variant="aside"
          />
        </>
      )}
```

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit
```

If a missing-field error fires for `companyNameRaw`: locate the existing prop that carries the company name in this component and use that instead. The existing aside JobVoiceCallTile composition already derives `callTitle` from a similar source — follow the same path.

- [ ] **Step 5: Commit**

```bash
git add components/jobs/JobPostingArticle.tsx
git commit -m "feat(jobs): render InterviewSimCallTile next to JobVoiceCallTile"
```

---

## Task 15: Voice-call history list — distinguish `interview_job` rows

**Files:**
- Modify: locate via `grep -rn "voice_calls\|VoiceCallHistory" app/ components/` and find the existing list component

The spec calls for a 5-line render branch. Specifics depend on where the list lives (likely `app/workspace/...` or `components/career-guides/voice-call/...`).

- [ ] **Step 1: Find the history list**

```bash
grep -rln "surface" app/ components/ | xargs grep -l "voice_calls\|VoiceCallHistory" 2>/dev/null
```

- [ ] **Step 2: Add a "Mock interview" chip for `surface === "interview_job"`** rows

In the row renderer, add a chip alongside the existing surface chips:

```tsx
{call.surface === "interview_job" && (
  <span className="inline-flex items-center rounded-pill bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink">
    Mock interview
  </span>
)}
```

If no chips exist today: just label the row title with a "Mock interview · " prefix when `surface === "interview_job"`.

- [ ] **Step 3: Commit**

```bash
git add <the modified file>
git commit -m "feat(voice-history): label interview_job rows as Mock interview"
```

If the workspace doesn't currently have a voice-call history list: skip this task and note it in the next task's smoke checklist as "history surfacing deferred — no list exists yet".

---

## Task 16: `convex/interviewSim.test.ts` — synthesis + rubric integration tests

**Files:**
- Create: `convex/interviewSim.test.ts`

The Vitest tests in Task 3 + Task 4 covered pure helpers. Now we test that the synthesis prompt + LLM call actually produce a parseable bundle (against the dev backend, real LLM).

- [ ] **Step 1: Implement integration tests**

```ts
import { describe, it, expect } from "vitest";
import { generateText, Output } from "ai";
import { chatModel } from "../lib/ai/providers";
import { CONTENT_MODEL_ID } from "../lib/ai/prompts/career-guides";
import {
  InterviewSynthesisSchema,
  InterviewRubricSchema,
  buildSynthesisPrompt,
  buildRubricPrompt,
  enforceVerbatimQuotes,
} from "../lib/ai/prompts/interviewer";

const SLOW = 60_000;

const fixtureExa = (answer: string) => ({
  answer,
  citations: [{ url: "https://example.com", title: answer.slice(0, 40), fetchedAt: Date.now() }],
});

describe("synthesis prompt against real LLM", () => {
  it("produces a bundle with rigor 4-5 for a famous, large company", async () => {
    const prompt = buildSynthesisPrompt({
      companyName: "Stripe",
      roleTitle: "Senior Software Engineer",
      exaResults: {
        loop: fixtureExa("Stripe interviews include a recruiter screen, a take-home, a system design, a pair programming session, and a values round."),
        questions: fixtureExa("Common questions include 'tell me about a system you scaled' and 'walk me through how you'd design a payment processor'."),
        rigor: fixtureExa("Glassdoor lists Stripe interview difficulty around 4.1/5. Stripe is widely considered very selective."),
        prestigeSignals: fixtureExa("Stripe is a private company with around 8000 employees and a valuation in the tens of billions; the brand is widely recognised in tech."),
      },
      newsAnswer: undefined,
    });
    const { experimental_output } = await generateText({
      model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
      experimental_output: Output.object({ schema: InterviewSynthesisSchema }),
      prompt,
    });
    expect(experimental_output.interviewBundle.rubric.rigor).toBeGreaterThanOrEqual(4);
    expect(experimental_output.interviewBundle.rounds.length).toBeGreaterThanOrEqual(3);
    expect(experimental_output.interviewBundle.signatureQuestions.length).toBeGreaterThanOrEqual(5);
    expect(experimental_output.interviewBundle.rubric.dimensions).toHaveLength(4);
    const dimKeys = experimental_output.interviewBundle.rubric.dimensions.map((d) => d.key);
    expect(new Set(dimKeys)).toEqual(new Set(["structure", "depth", "role-fit", "company-fit"]));
  }, SLOW);

  it("produces a bundle with rigor 2-3 for a tiny seed-stage shop", async () => {
    const prompt = buildSynthesisPrompt({
      companyName: "Acme Seed Co",
      roleTitle: "Founding Engineer",
      exaResults: {
        loop: fixtureExa("Acme Seed Co is a 6-person seed-stage startup. Their interview is one founder chat plus a pair coding session."),
        questions: fixtureExa("They ask 'tell me about yourself' and 'what excites you about the early-stage problem space'."),
        rigor: fixtureExa("No Glassdoor reviews available."),
        prestigeSignals: fixtureExa("6 employees, $2M seed round, no notable brand recognition outside their immediate niche."),
      },
      newsAnswer: undefined,
    });
    const { experimental_output } = await generateText({
      model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
      experimental_output: Output.object({ schema: InterviewSynthesisSchema }),
      prompt,
    });
    expect(experimental_output.interviewBundle.rubric.rigor).toBeLessThanOrEqual(3);
    expect(experimental_output.interviewBundle.rubric.rigorRationale).toMatch(/seed|small|early|6/i);
  }, SLOW);
});

describe("rubric prompt against real LLM", () => {
  it("returns null score for a dimension that wasn't covered in the call", async () => {
    const transcript = [
      "Interviewer: Tell me about yourself.",
      "Candidate: I'm Sam, an engineer.",
      "Interviewer: Cool. Why are you interested in this role?",
      "Candidate: Sounds good.",
      "Interviewer: Thanks for your time.",
    ].join("\n");
    const bundle = {
      rounds: [{ name: "Behavioral", focus: "Mutual fit", interviewerArchetype: "hiring manager" }],
      signatureQuestions: [{ question: "Tell me about yourself.", rationale: "Opener" }],
      rubric: {
        rigor: 3,
        rigorRationale: "Generic.",
        interviewerArchetype: "hiring manager",
        dimensions: [
          { key: "structure", anchorBelow: "Rambling", anchorAt: "STAR", anchorAbove: "Crisp" },
          { key: "depth", anchorBelow: "Surface", anchorAt: "Adequate", anchorAbove: "Probing" },
          { key: "role-fit", anchorBelow: "Misaligned", anchorAt: "Plausible", anchorAbove: "Strong evidence" },
          { key: "company-fit", anchorBelow: "Generic", anchorAt: "Aware", anchorAbove: "Specific + informed" },
        ],
      },
      prestigeSignals: {},
    };
    const prompt = buildRubricPrompt({
      candidate: { firstName: "Sam" },
      posting: { title: "Engineer" },
      company: { name: "Acme" },
      bundle,
      transcript,
    });
    const { experimental_output } = await generateText({
      model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
      experimental_output: Output.object({ schema: InterviewRubricSchema }),
      prompt,
    });
    // At least one dimension should be null because the call was so short.
    expect(experimental_output.dimensions.some((d) => d.score == null)).toBe(true);
  }, SLOW);

  it("quotes verbatim from the transcript", async () => {
    const transcript = [
      "Interviewer: Walk me through a system you scaled.",
      "Candidate: I led the migration from MySQL to Postgres for our payments service. We moved 50 million rows over a weekend with zero downtime by using logical replication and a phased cutover.",
      "Interviewer: Nice. What was the hardest part?",
      "Candidate: The hardest part was reconciling sequence values for the auto-increment columns mid-cutover.",
      "Interviewer: Thanks for your time.",
    ].join("\n");
    const bundle = {
      rounds: [{ name: "Technical", focus: "Depth", interviewerArchetype: "staff engineer" }],
      signatureQuestions: [{ question: "Walk me through a system you scaled.", rationale: "—" }],
      rubric: {
        rigor: 4,
        rigorRationale: "—",
        interviewerArchetype: "staff engineer",
        dimensions: [
          { key: "structure", anchorBelow: "—", anchorAt: "STAR", anchorAbove: "—" },
          { key: "depth", anchorBelow: "—", anchorAt: "Adequate", anchorAbove: "—" },
          { key: "role-fit", anchorBelow: "—", anchorAt: "Plausible", anchorAbove: "—" },
          { key: "company-fit", anchorBelow: "—", anchorAt: "Aware", anchorAbove: "—" },
        ],
      },
      prestigeSignals: {},
    };
    const prompt = buildRubricPrompt({
      candidate: { firstName: "Sam" },
      posting: { title: "Staff Engineer" },
      company: { name: "Acme" },
      bundle,
      transcript,
    });
    const { experimental_output } = await generateText({
      model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
      experimental_output: Output.object({ schema: InterviewRubricSchema }),
      prompt,
    });
    const check = enforceVerbatimQuotes({
      transcript,
      bestQuote: experimental_output.bestMoment.quote,
      missQuote: experimental_output.biggestMiss.quote,
    });
    expect(check.ok).toBe(true);
  }, SLOW);
});
```

- [ ] **Step 2: Run the integration tests**

These tests hit a real LLM through OpenRouter (`OPENROUTER_API_KEY` must be in `.env.local`). They are slow (~30-60s each). Per CLAUDE.md, mocking is forbidden — these are integration tests by design.

```bash
pnpm vitest run convex/interviewSim.test.ts
```

Expected: all 4 tests pass. If a test fails because the LLM produced something unexpected, re-read its assertion — these probe behavior the prompt should enforce. If the prompt isn't strict enough, tighten it in `lib/ai/prompts/interviewer.ts` and rerun.

- [ ] **Step 3: Commit**

```bash
git add convex/interviewSim.test.ts
git commit -m "test(interviewSim): integration tests for synthesis + rubric prompts"
```

---

## Task 17: End-to-end smoke + final commit

**Files:** none

- [ ] **Step 1: Type-check the whole repo**

```bash
pnpm tsc --noEmit
```

Expected: no errors. Fix any that surface before continuing.

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all tests pass. (Some integration tests are slow.)

- [ ] **Step 3: Convex perf audit on changed files** (per `.claude/rules/convex-patterns.md`)

Invoke `convex-performance-audit` on the new convex modules:

```
Skill: convex-performance-audit
Files to audit: convex/interviewSim.ts, convex/interviewSimNode.ts, convex/lib/interviewResearch.ts
```

Address any flagged issues in-place (e.g. missing index, expensive `.collect()`).

- [ ] **Step 4: UI audit on the new components** (per `.claude/rules/ui-quality.md`)

Invoke `/audit` against `components/jobs/voice/interview/`. Address any P0/must-fix items.

- [ ] **Step 5: Manual end-to-end smoke**

Run the dev stack:

```bash
pnpm dev
```

Open a job listing while signed in. Verify:
1. Both CTA tiles render side by side in the desktop aside, both render in the byline on mobile (375px viewport).
2. Tap "Start mock interview" — the modal opens, prep progress advances live ("Reviewing how X interviews…" → "Tuning your interviewer…" → "Connecting…").
3. Live call starts, microphone permission prompt fires once, halo animation responds to speaking/thinking/listening states.
4. End the call after ~30 seconds with at least 4 message turns.
5. Phase 3 renders the analyzing skeleton, then the rubric (~10–15s after end).
6. Verbatim quotes (if present) appear in monospace cards.
7. Click "Close" — modal closes; refreshing the listing keeps the row in voice-call history (with "Mock interview" chip if the history list was found in Task 15).

If any step fails, debug and fix before proceeding. Per `superpowers:verification-before-completion`, do NOT mark this task complete based on intent — only on actual observed behavior.

- [ ] **Step 6: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(interviewSim): smoke-test fixes"
```

Or skip if the smoke run was clean.

- [ ] **Step 7: Note Discover-impact addressed**

Per CLAUDE.md cross-feature rule: this feature does not touch `profile_embeddings`, `career_guides`, or matching → no `discover_canvas` recompute needed. (Already noted in the spec; restating here as the verification evidence.)

---

## Plan complete

The feature is shippable from Task 17. Future iterations:
- **Cache-warming cron** — pre-fetch `interviewBundle` for popular (company, role) pairs ahead of demand. Requires updating the deployment allow-list pattern in `convex/lib/env.ts`.
- **Workspace history list filter** — dedicated "Mock interviews" tab in the workspace.
- **Hook unification** — refactor `useJobVoiceCall` + `useInterviewCall` into a shared base hook taking a `mintActionRef`.
- **Richer candidate brief in `_getPostingWithCompanyAndBundle`** — currently a thin `{ firstName: "Candidate" }`; expand to include the same compact brief used by `mintInterviewSession`.
- **Multi-round interviews** — simulate the full loop sequentially (one round per call), grouped under one "interview series" parent row.
