# Interview simulation — design

**Date:** 2026-05-08
**Status:** approved (brainstorm); awaiting written-spec review before implementation plan

## Problem

Signed-in users on a job listing can already start a *deep-dive* voice call ("Talk through this role"). What they cannot do is **practice the actual interview** for that posting. V1 had this. V2 should match it and clearly beat it.

V1's biggest sin was deriving difficulty from a hardcoded company allow-list (`if (companyName.includes("google")) return "faang"`). It also chose interviewer personality at random and had no real grounding in how the company actually interviews. V2 will be data-driven end-to-end: the interviewer's rigor, archetype, signature questions, and grading rubric all come from real research synthesized fresh per (company, role) and cached for 30 days.

## Goals

- Realistic 10–15 minute mock interview launched from any job listing in one tap.
- Interviewer persona, rigor, and signature questions grounded in actual research about how this company interviews for this role.
- Mid-call live grounding via Gemini Live's `googleSearch` tool so the interviewer can answer "what's new at the company" questions without hallucinating.
- Post-call structured feedback graded against company-specific anchors (not a generic 1–5 scale), with verbatim transcript quotes for the best moment and biggest miss, plus three concrete next-step exercises.
- Reuse the existing `voice_calls` infrastructure (token mint, transcript persistence, finalize, abort) — only the prompt, tool config, and post-call analysis are new.

## Non-goals (MVP)

- Career-guide–anchored interviews (no specific company).
- Standalone "practice anywhere" picker outside listings.
- User-configurable interview type / length / difficulty.
- Cache-warming crons.
- A separate interview-history surface in the workspace beyond letting the new rows render in the existing voice-call list.

## Decisions captured during brainstorm

| Question | Decision |
|---|---|
| Entry surface | Job listing only (MVP) |
| Difficulty model | Pure data-driven from research signals — no hardcoded company list |
| Pre-flight UX | One-tap, fully auto, with progress states ("Researching X…", "Tuning your interviewer…") |
| Research storage | Extend `company_role_research.interviewBundle` (30-day TTL) + recent news on `company_research.recentNews` (7-day TTL) |
| Feedback shape | Structured rubric + targeted coaching, with verbatim quotes pulled from transcript |
| Live grounding | Pre-loaded research + Gemini Live `googleSearch` tool enabled |
| Architecture | Approach A — new `surface: "interview_job"` on `voice_calls`, new domain files, share helpers via `convex/lib/voice/` |

## Architecture

### Server-side lifecycle (Convex)

1. **`interviewSim.startSession`** (Node action) — single client entry point.
   - Auth gate (`getUserIdentity`).
   - Loads cached `company_role_research.interviewBundle`. On miss / `lastResearchedAt < now - 30d` → schedules `_synthesizeInterviewResearch` (internal Node action) inline. Same call also refreshes `company_research.recentNews` if `recentNews.fetchedAt < now - 7d`. Both refreshes run in parallel inside the synthesis action.
   - Writes status updates to a session-scoped doc the dialog subscribes to (so the user sees live "Researching X…" / "Pulling news…" / "Tuning interviewer…" progress).
   - Builds the interviewer system prompt from the bundle + candidate profile (`lib/ai/prompts/interviewer.ts`).
   - Mints the Gemini Live ephemeral token with `tools: [{ googleSearch: {} }]` enabled.
   - Inserts the `voice_calls` row with `surface: "interview_job"` via internal mutation, returns `{ sessionId, ephemeralToken, model, voiceId, callTitle }`.

2. **During the call** — exact same machinery as today's deep-dive (`useJobVoiceCall` hook, `_appendMessage` mutation). When the model calls `googleSearch`, the resulting grounding metadata is preserved on the assistant message via a new optional `groundingCitations` field on the message shape. Surface-agnostic; existing pipeline picks it up.

3. **On call end / abort** — existing `_finalizeSession` mutation reused. Status flips to `completed` / `interrupted`. Then `interviewSim.processInterviewAnalysis` (NEW Node action) is scheduled. It runs `generateText` + `Output.object(InterviewRubricSchema)` against the transcript + the same `interviewBundle` the call was grounded in. Result lands in `voice_calls.aiSummary` (already typed `v.any()`).

### Why this shape

- Reuses every piece of expensive infrastructure (token mint, transcript persistence, abort, scheduling).
- Single `startSession` action means the client never has to orchestrate research → mint → connect — one round trip, server-driven.
- Research synthesis is its own internal action so a future cron could warm the cache for popular (company, role) pairs without touching the call path.
- Status updates via subscription means the "preparing" state is real progress, not a fake spinner.

## Data model

All schema changes are **additive optionals** — no widen/migrate/narrow needed. Existing readers ignore new fields.

### A. `voice_calls` — extend the surface discriminator

```ts
surface: v.optional(
  v.union(
    v.literal("guide"),
    v.literal("compass"),
    v.literal("job"),
    v.literal("interview_job"),  // NEW
  ),
),
```

`jobPostingId` is already optional and indexed (`by_jobPosting`). Interview rows reuse it. Rubric lands in the existing `aiSummary: v.any()`.

Add one optional field to message entries so search-grounded turns carry their citations:

```ts
messages: v.array(
  v.object({
    id: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
    transcriptConfidence: v.optional(v.number()),
    groundingCitations: v.optional(  // NEW — only set on Gemini-grounded turns
      v.array(v.object({
        url: v.string(),
        title: v.optional(v.string()),
      })),
    ),
  }),
),
```

### B. `company_role_research` — add structured interview bundle

Existing `interview` (string) stays as the human-readable summary other consumers already read. Add a parallel structured field used by the simulator and graded-feedback path:

```ts
// Existing prose field — untouched
interview: v.optional(v.string()),

// NEW — structured form synthesized in the same Exa pass
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
    rigor: v.number(),                           // 1–5
    rigorRationale: v.string(),                  // 1-line audit trail
    interviewerArchetype: v.string(),            // dominant style for the loop
    dimensions: v.array(v.object({
      key: v.string(),                           // "structure" | "depth" | "role-fit" | "company-fit"
      anchorBelow: v.string(),                   // what 1–2 looks like at THIS company
      anchorAt: v.string(),                      // what a 3 looks like
      anchorAbove: v.string(),                   // what 4–5 looks like
    })),
  }),
  prestigeSignals: v.object({
    employeeBand: v.optional(v.string()),        // "<50" | "50-500" | "500-5k" | "5k-50k" | "50k+"
    fundingOrPublic: v.optional(v.string()),
    brandMentions: v.optional(v.number()),
    glassdoorDifficulty: v.optional(v.number()), // 1–5 if Exa surfaced it
  }),
  generatedAt: v.number(),
  modelUsed: v.string(),
})),
```

### C. `company_research` — add recent news

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

News lives on `company_research` (not `company_role_research`) because it's company-wide. Independent `fetchedAt` because news goes stale on a different cadence (7 days) than culture/financials (existing 30+ days).

### Cache freshness

| Bundle | TTL | Refresh trigger |
|---|---|---|
| `company_role_research.interviewBundle` | 30 days | Cache miss or `lastResearchedAt < now - 30d` |
| `company_research.recentNews` | 7 days | Cache miss or `recentNews.fetchedAt < now - 7d` |
| `company_role_research.interview` (prose) | 30 days (existing) | Same pass; written together |

If both bundles are stale and the user starts an interview, both refreshes happen in parallel inside `_synthesizeInterviewResearch`.

## Research synthesis pipeline

This is where we beat V1 — by replacing `if (companyName.includes("google"))` with real signals.

### Stage 1 — Exa burst (parallel)

Up to five queries fire in `Promise.all` via the existing `exaAnswer` helper (already used in `companyResearch.ts`). Selective firing per cache state — if only news is stale we fire query 5 alone; if only the bundle is stale we fire 1–4. Both stale → all five in one burst:

| Query | Purpose | Feeds |
|---|---|---|
| "Interview process for {role} at {company}: rounds, format, what to expect" | Loop structure | `rounds[]` |
| "{company} {role} interview questions candidates have shared" | Real questions | `signatureQuestions[]` |
| "Glassdoor / levels.fyi interview difficulty for {company}, especially {role}" | Calibration anchor | `prestigeSignals.glassdoorDifficulty` |
| "{company} company size, funding stage, public/private, brand recognition" | Prestige inputs | `prestigeSignals.employeeBand`, `fundingOrPublic`, `brandMentions` |
| "Recent news about {company} in the last 90 days" (with `startPublishedDate` filter) | News bullets | `recentNews.bullets[]` |

### Stage 2 — LLM synthesis (one call, conditional)

Synthesis runs only when at least one of queries 1–4 fired (i.e. the bundle is stale or missing). News-only refreshes skip synthesis entirely — the news bullets are written from Exa raw results (`headline`, `summary`, `sourceUrl`, `publishedAt`) without a second LLM call.

When it runs: a single `generateText` + `Output.object(InterviewSynthesisSchema)` call against **Gemini 3.1 Pro on OpenRouter** (matches the existing `Output.object` pattern that works on Vertex; avoids the Bedrock-routing dead-end documented in project memory). The prompt receives all Exa results + their citations and produces:

```ts
{
  interviewBundle: { rounds, signatureQuestions, rubric, prestigeSignals },
  interviewProse: string,        // for the existing `interview` field
  recentNews: { bullets },        // present only if news query fired
}
```

The model is instructed to derive `rigor` (1–5) **from the prestige signals it just received**, not from company name pattern matching. Prompt anchors:

- Employee band <50 + no household name → rigor 2–3 (early stage, less calibrated process)
- Employee band 5k+ AND brand mentions >50 OR public → rigor 4–5
- Glassdoor difficulty (when available) is the strongest single signal; the model is told to weight it heaviest
- `rigorRationale` MUST cite which signals drove the score (one sentence; lands in the bundle for auditability)

`interviewerArchetype` is derived per-loop from the `rounds` data (e.g. system-design round → "staff engineering manager"; values/principles round → "bar raiser"). The whole-loop `rubric.interviewerArchetype` is the dominant one, used as the live call's persona.

**Schema constraints encoded in prompt, not Zod** (per project memory on Gemini structured-output limits): "3–5 rounds", "5–8 signature questions", "exactly 4 dimensions" go in the prompt text. Zod stays free of `.min/.max/.int` because Gemini structured output rejects bound constraints.

### Stage 3 — Persistence

Single mutation writes everything atomically:

- `company_role_research`: `interview` (prose), `interviewBundle` (structured), `citations.interview`, `lastResearchedAt`, `costCents` (sum of Exa + LLM costs)
- `company_research`: `recentNews` (only if refreshed)

### Failure modes & fallbacks

| Failure | Behavior |
|---|---|
| All Exa queries fail | Generic-but-honest fallback bundle: rigor 3, generic dimensions, archetype "hiring manager", `prestigeSignals` empty, `interviewBundle.generatedAt` set so we don't refetch within 30d. Interview still runs; prompt is just less specific. Logged. |
| Some Exa queries fail | Synthesis runs on partial set; missing signals show as `undefined` in `prestigeSignals`. |
| LLM call fails | `company_role_research.status = "failed"`, `lastError` set, dialog shows one-shot retry. We do NOT block the user from a generic-bundle interview if they want to proceed. |
| Posting has no `roleArchetypeSlug` | Use `posting.title` for queries. Bundle still written; cache key becomes `slug = sha256(companyId + normalizedTitle).slice(0,16)` so other postings with the same title at the same company can share it. |

### Why one synthesis call instead of separate per-output calls

A single context lets the model cross-reference (e.g. "the recent layoff news lowers the inferred rigor" or "the system-design round mentioned in news should appear in `rounds[]`"). Two passes would re-pay the context-loading cost and lose this consistency.

### What this buys us over V1

- No company allow-list to maintain; works for any company on Earth.
- Rigor is auditable — `rigorRationale` + `prestigeSignals` are stored, replayable.
- Signature questions are real (Exa pulls from candidate-shared accounts), not invented.
- Per-round archetypes mean the live interviewer can switch tone if multiple rounds are simulated in one session later.

## Live interviewer prompt

`lib/ai/prompts/interviewer.ts` (new file). A single function `buildInterviewerPrompt({ candidate, posting, company, bundle, news })` returns the system instruction. Structure follows the existing `voiceAdviser.ts` skeleton (Persona → Conversational rules → Tool usage → Guardrails) so the post-call analyzer can rely on a consistent shape.

```
**Persona:**
You are {bundle.rubric.interviewerArchetype} at {company.name}, interviewing
{candidate.firstName} for the {posting.title} position. Your tone matches
how this company actually conducts this loop, based on candidate accounts.

Calibration: this loop runs at rigor {bundle.rubric.rigor}/5
({bundle.rubric.rigorRationale}). Hold the bar at that level — your bar is
not "hard" or "easy" in the abstract, it is what excellence looks like at
{company.name} for this role. Reference frame:
{bundle.rubric.dimensions[].anchorAt joined as bullets}

**About {candidate.firstName}:**
{compact candidate brief — current role, years, top 5 skills, 1-paragraph
narrative from profile_enrichment, 800-char resume excerpt}

**About this role:**
{posting.title} at {company.name} · {posting.city}
{compact 500-char posting excerpt}

**Recent at {company.name}** (use sparingly, only if candidate brings it up
or asks "what do you know about us recently"):
{news.bullets[].headline + summary, top 3}

**Likely loop structure** (you are simulating one round of this loop —
focus on whichever feels most useful given the candidate's background):
{bundle.rounds[].name + focus joined}

**Conversational rules:**
1. Open with a 30-second warm hello. One ice-breaker. Then transition.
2. One question per turn. Wait for the full answer. Probe with follow-ups
   when answers are vague — don't accept hand-waving at this rigor.
3. Pull from {bundle.signatureQuestions} as your spine. Ask 2–4 of them
   verbatim or near-verbatim across the conversation. Mix in your own
   follow-ups based on candidate answers.
4. Mid-call, if the candidate references current events about
   {company.name} you don't already know from the brief above, you may
   call googleSearch ONCE to fetch context. Do not search proactively.
5. Cap each spoken response at ~25 seconds.
6. Around minute 12–13, signal you're wrapping up: "Before we close, what
   questions do you have for me?" Answer honestly from the hiring-manager
   POV. End by thanking them and naming one specific thing they did well.

**Tool usage:**
- googleSearch: only when the candidate references something about
  {company.name} you cannot answer from the brief. One search per call max.

**Guardrails:**
- Never break character. You are the interviewer, not an AI.
- Never mention the rigor score, the rubric, or that this is a simulation.
- Never repeat what the candidate said back to them.
- If the candidate asks for feedback during the call, defer: "I'll have
  thoughts at the end — let's keep going."
```

**Token budget:** ~2.5k tokens system prompt (well under Gemini Live's 8k system-instruction cap). Built fresh per call from the cached bundle — no prompt caching needed since Gemini Live sessions are short-lived and the bundle changes per (user, posting).

## Post-call rubric

`convex/interviewSim.ts` → `processInterviewAnalysis` action. Scheduled by `_finalizeSession` once status flips to `completed` or `interrupted` AND `messages.length >= 4` (skip analysis for too-short calls; surface a "Call ended too early to grade" placeholder instead).

Inputs: full transcript, the same `interviewBundle` the call was grounded in, and a compact candidate brief (so "role-fit" comments can ground in what the candidate actually claims to have done).

Single `generateText` + `Output.object(InterviewRubricSchema)` call against Gemini 3.1 Pro on OpenRouter — same model + routing as synthesis.

### `InterviewRubricSchema` (Zod, in `lib/ai/prompts/interviewer.ts`)

```ts
{
  overallScore: number,                  // 1–5, weighted average
  oneLineVerdict: string,                // shown above the fold
  dimensions: array({
    key: string,                         // matches bundle.rubric.dimensions[].key
    score: number | null,                // null if dimension wasn't covered in call
    whatWorked: string,                  // 1–2 sentences, concrete
    whatToFix: string,                   // 1–2 sentences, concrete + actionable
  }),
  bestMoment: {
    quote: string,                       // verbatim from candidate transcript
    why: string,
  },
  biggestMiss: {
    quote: string,                       // verbatim
    why: string,
    betterAnswerSketch: string,          // ~3 sentences showing what good looked like
  },
  nextStepExercises: array({             // exactly 3 in the prompt instructions
    title: string,                       // "Drill STAR for ambiguity scenarios"
    why: string,
    how: string,                         // concrete, doable in <60min
  }),
}
```

### Calibration discipline in the prompt

- "Use the dimension anchors from `bundle.rubric.dimensions` as your only reference. A 3 means 'meets the bar at {company.name}', not 'good in general'."
- "When you quote `bestMoment.quote` or `biggestMiss.quote`, the string must appear verbatim in the transcript — do not paraphrase. If you cannot find a verbatim quote that supports the point, lower the score instead of fabricating one."
- "If the candidate barely answered a dimension (e.g. interview ended before depth questions), score it null and say so in `whatToFix` — do not guess."

### Verbatim-quote enforcement

After the LLM returns, the action runs `transcript.includes(bestMoment.quote)` and `transcript.includes(biggestMiss.quote)`. On mismatch (model hallucinated despite instructions), one regeneration attempt with the failed quote echoed back as a correction. Two strikes → strip the quote field but keep the rubric. Logged for prompt tuning.

### Why grade against the bundle, not a generic standard

This is the whole point of data-driven rigor. A 3 at a 25-person seed-stage startup ≠ a 3 at Stripe. The dimension anchors written into the bundle for THIS company become the calibration; the post-call grader reads them and applies them. V1 graded against a tier label; we grade against company-specific anchors that came from the same research that drove the live interview.

## UI

Components under `components/jobs/voice/interview/` (sibling to existing `voice/`):

```
components/jobs/voice/interview/
├── InterviewSimCallTile.tsx      # CTA tile — sibling of JobVoiceCallTile
├── InterviewSimDialog.tsx        # Modal owns all 3 phases
├── InterviewPrepProgress.tsx     # Phase 1 — live progress states
├── InterviewLiveCall.tsx         # Phase 2 — wraps useJobVoiceCall (retargeted)
├── InterviewFeedback.tsx         # Phase 3 — rubric render
└── useInterviewSim.ts            # Hook: subscribes to status doc, exposes phase
```

### Tile

`InterviewSimCallTile` — placed in the listing right column under the existing `JobVoiceCallTile`. Distinct visual weight (slightly stronger border, lucide `Mic` icon — no emoji per project rule), distinct copy:

> **Mock interview** — Realistic 10–15 minute simulation, calibrated to how {Company} actually interviews for this role.

Anonymous variant: same skeleton as the deep-dive tile, links to `/sign-in?redirect_url=…`.

### Dialog phases

Single dialog stays mounted across all phases so prep → live → feedback feels continuous (V1 broke these across screens; we don't).

**Phase 1 — Preparation** (Convex subscription–driven):

```ts
status:
  | "researching"             // Exa burst in flight (role + news, parallel)
  | "synthesizing"            // LLM bundle synthesis in flight
  | "minting_token"           // Gemini Live token mint in flight
  | "ready"                   // → auto-advance to Phase 2
  | "failed"                  // → "We couldn't reach our research source. [Retry]"
```

The dialog renders a single human-readable line per status (e.g. `researching` → "Reviewing how {Company} interviews for this role…"). Cache-hit path skips straight to `minting_token` — typical hit case is sub-second total. If only news is stale (bundle fresh), we go `researching → minting_token`, skipping `synthesizing` because news bullets are written directly from Exa raw results without a second LLM call.

**Phase 2 — Live call** — Reuses existing `useJobVoiceCall` hook unchanged. The hook is already surface-agnostic (it speaks to `voice_calls` rows by `sessionId`). Retarget is just passing `surface: "interview_job"` through `startSession`. Subtle difference: a small "Wrap up" hint surfaces around minute 12 (client-side timer; the prompt also instructs the model to wrap then, so they align without explicit signaling).

**Phase 3 — Feedback** — Rendered when `voice_calls.aiSummary` populates (Convex subscription on the row). Skeleton shown until then ("Analyzing your interview…", median ~10–15s after call ends).

Layout (top–down):

1. Header: company logo + role + duration + overall score (large)
2. One-line verdict
3. Dimension grid (4 cards, each with score + anchor tooltip + whatWorked / whatToFix)
4. "Best moment" + "Biggest miss" cards (quote in monospace; "why" beneath)
5. Three next-step exercises (collapsible)
6. Footer: "Run another mock interview" CTA + "Save to my interview log" (toggles future workspace surfacing affordance)

If the call was too short (`messages.length < 4`), Phase 3 shows the placeholder and no LLM call burns.

### Workspace history surfacing

Out of MVP scope per the entry-surface decision. Existing voice-call history view will pick up these rows because it queries `voice_calls` by user. We render `surface: "interview_job"` rows with a distinct "Mock interview" chip in the same list — a 5-line change in the existing list component, included in this PR.

## Error handling

| Failure | User sees | System does |
|---|---|---|
| All Exa queries fail | "We couldn't research this company right now. [Try anyway]" | If user proceeds: generic-bundle interview, logged. If retry: 1 backoff attempt then same fallback. |
| Some Exa queries fail | Silent — bundle just has fewer signals | `prestigeSignals` partial, logged |
| LLM synthesis fails | "Couldn't prepare your interviewer. [Retry]" | One retry with truncated context. Two strikes → fallback bundle, logged |
| Token mint fails (Gemini API down / quota) | "Voice service is unavailable right now." | No row inserted, no charge incurred. Retry button. |
| Mid-call WebSocket drop | Existing `useJobVoiceCall` reconnect path | Status flips to `interrupted` if reconnect fails |
| Post-call analysis fails | Phase 3: "Feedback couldn't be generated. [Retry analysis]" | `aiSummary` stays undefined. Retry schedules `processInterviewAnalysis` again — idempotent |
| Verbatim-quote check fails twice | Phase 3 renders rubric without quote cards; small "Quotes unavailable." note | Logged for prompt tuning |
| Call too short to grade | Phase 3 placeholder | No LLM call |

## Cost guardrails

- Per-user per-day rate limit on `startSession`: **5 interviews / 24h** (Convex-counted, by user). On 6th: "You've run 5 interviews today. Come back tomorrow." Generous for MVP, prevents griefing.
- Single retry budget per failure mode (not unlimited).
- Cache hit short-circuits the entire research stage — popular (company, role) combos pay near-zero per-interview cost.

## Observability

- `console.error` lines tagged `[interviewSim:<stage>]` for every failure path so dashboard filters work.
- `costCents` tracked on `company_role_research` (already exists) covers research; we add a `costCents` log line on each post-call analysis.
- Deployment allow-list guard from `.claude/rules/deployment-previews.md` is irrelevant — no crons. (Future cache-warming cron would go through `isCronAllowedDeployment()`.)

## Testing strategy

| Layer | What we test | How |
|---|---|---|
| Synthesis prompt | Rigor scoring monotonic in prestige signals; archetype matches loop structure; verbatim citations well-formed | `convex/interviewSim.test.ts` — fixture-based tests against the synthesis function (mock Exa response, hit real LLM in dev, snapshot the bundle). One snapshot per scenario: "early-stage startup", "FAANG", "mid-market enterprise", "European bank" |
| Rubric prompt | Verbatim-quote enforcement triggers on hallucinated quotes; `score: null` returned when dimension wasn't covered | Same file — fixture transcripts with planted "model will want to quote this but it's not in the transcript" cases |
| Pipeline | Cache hit/miss/stale paths for both 30d and 7d TTLs | Real Convex dev backend, no mocks (per CLAUDE.md) |
| UI phases | Each phase renders correctly; phase transitions on status changes | Component-level smoke + manual `/audit` per `ui-quality.md` |
| End-to-end | Real listing → prep → ~30s test interview → feedback renders | Manual smoke against dev backend before predeploy |

## Discover (Career Compass) impact

No impact. Interview sim doesn't touch `profile_embeddings`, `career_guides`, or matching. The new `voice_calls` rows could theoretically feed Discover later (e.g. "interviews you've practiced" as a new lane), but that's a future opt-in, not a forced recompute.

## Files touched (preview, not the implementation plan)

**New:**

- `convex/interviewSim.ts` — V8 surface (context loader, persistence helpers, `processInterviewAnalysis`)
- `convex/interviewSimNode.ts` — Node surface (`startSession`, `_synthesizeInterviewResearch`, token mint)
- `convex/lib/voice/` — extracted shared helpers (resolveUser, gemini token mint, common message helpers)
- `lib/ai/prompts/interviewer.ts` — interviewer prompt + rubric Zod schema
- `components/jobs/voice/interview/` — 6 files listed above
- `convex/interviewSim.test.ts` — synthesis + rubric prompt tests

**Modified:**

- `convex/schema.ts` — additive optionals on `voice_calls`, `company_role_research`, `company_research`
- `convex/companyResearch.ts` — extend role-research action to also produce structured bundle (or expose helpers used by synthesis action — to be decided in plan)
- Existing voice-call history list component — 5-line render branch for `interview_job`
- `app/jobs/listing/[city]/…` — render `InterviewSimCallTile` next to `JobVoiceCallTile`

## Open questions for the implementation plan

- Should `_synthesizeInterviewResearch` live in `interviewSimNode.ts` or extend `companyResearch.ts`? Leaning extend — single source of truth for "research about a company role" — but the new synthesis returns more outputs than the current action, so the API would change. Plan-time decision.
- Should the existing `companyResearch._researchCompanyRole` be deprecated in favour of the new combined synthesis, or kept alongside? Plan-time decision.
- Exact Convex doc / table for the prep-status subscription (transient — could be a row in a new `interview_prep_status` table keyed on sessionId, or a denormalized field on the `voice_calls` row written before the row's "active" lifecycle starts). Plan-time decision.
