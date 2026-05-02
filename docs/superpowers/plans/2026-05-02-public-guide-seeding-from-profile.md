# Public Career Guide Seeding from Profile Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user finishes profile review (`profiles.markReviewed`), automatically seed public career guides for the canonical job titles in their work history — single-flight, with semantic deduplication so two users with the same role (regardless of how they wrote it: "Sr SWE" vs "Senior Software Engineer") share one guide row.

**Architecture:** Three-layer dedup. (1) **Deterministic prefilter** — a static abbreviation/punctuation expander runs before any LLM call, so common variants collapse cheaply. (2) **LLM canonicalizer with deterministic cache** — a `title_canonicalizations` table keyed by the prefiltered raw title; cache hit returns instantly, cache miss calls the LLM once and writes the canonical title back. (3) **Row-level OCC dedup** — already implemented in `convex/careerGuides.ts:_requestGeneration` via the `by_slug` and `by_title_normalized` indexes. Concurrent setups race on the indexes; losers attach to the in-flight row. The canonicalizer is what makes layer 3 actually catch semantic duplicates rather than just exact-string duplicates.

We do **not** modify the existing `normalizeTitle` / `slugify` helpers — they're load-bearing for existing guide URLs. The new canonicalizer is upstream of the existing pipeline.

**Tech Stack:** Convex (schema, internalMutation, internalAction, scheduler), AI SDK v6 (`generateText` + `Output.object`), OpenRouter (Gemini 3.1 Pro per `.claude/rules/ai-sdk-patterns.md`), vitest + `convex-test` (per `package.json`).

---

## Out of scope

- **Discover snapshot recompute when seeded guides complete.** The existing `fanOutGuideUpdate` only invalidates users whose live snapshot already references a guide. New seeded guides won't auto-surface in the user's first snapshot. We schedule one snapshot regen at seeding time (which runs immediately and may catch some early completions) and document the gap. A proper "subscribe user X to guide G's completion" hook is a follow-up — see Task 9.
- **O*NET / SOC taxonomy mapping.** The cache + LLM approach is sufficient for MVP-grade dedup. A structured taxonomy is the long-term right answer (per CLAUDE.md operating principle 3) but not required to make duplicates impossible — the LLM cache already enforces "same input → same canonical title" by virtue of the cache.
- **Backfilling guides for existing reviewed profiles.** This plan only covers profiles reviewed *after* the feature ships. Backfill is one mutation per existing reviewed profile; trivial follow-up.

---

## File Structure

**Create:**
- `convex/lib/titleAbbreviations.ts` — pure, deterministic abbreviation/punctuation expander. Static dictionary + apply function. No Convex imports.
- `convex/lib/titleAbbreviations.test.ts` — unit tests for the expander.
- `convex/titleCanonicalization.ts` — Convex query/mutation/action trio: `_lookup` (internalQuery), `_writeThrough` (internalMutation, race-safe upsert), `getOrCreateCanonical` (internalAction, the public-internal entry point).
- `convex/titleCanonicalization.test.ts` — convex-test suite covering cache hit, cache miss + LLM call, concurrent-call race.
- `convex/profileGuideSeeding.ts` — internalAction `seedGuidesFromProfile({ userId })` and the seeding-flavored entry point `internal.careerGuides._requestGenerationForSeeding`.
- `convex/profileGuideSeeding.test.ts` — convex-test suite covering fan-out, intra-profile dedup, idempotency, concurrent profiles with overlapping titles.

**Modify:**
- `convex/schema.ts` — add `title_canonicalizations` table; add optional `guidesSeededAt` and `seedingGuideSlugs` fields to `profiles`.
- `convex/careerGuides.ts` — add a new internal entry point `_requestGenerationForSeeding({ title, userId })` that bypasses the IP rate limit and applies a per-user daily cap. Existing `_requestGeneration` is **not** modified.
- `convex/profiles.ts:markReviewed` (lines 267–283) — schedule `internal.profileGuideSeeding.seedGuidesFromProfile` after the existing `discover.scheduleSnapshotRegeneration` call.

---

## Task 0: Read load-bearing files and confirm test runner

**Files:**
- Read: `convex/careerGuides.ts:494-595` (current `_requestGeneration`)
- Read: `convex/profiles.ts:1-100, 267-283` (schema usage + `markReviewed`)
- Read: `convex/discover.ts:178-220, 1290-1340` (snapshot regen + `fanOutGuideUpdate`)
- Read: `convex/lib/normalize.ts` (existing helpers — must not be modified)
- Read: `convex/_generated/ai/guidelines.md` (per CLAUDE.md, Convex API rules override training data)
- Read: `.claude/rules/convex-patterns.md` (auth + index discipline)
- Read: `.claude/rules/ai-sdk-patterns.md` (model selection, structured output)

- [ ] **Step 1: Confirm vitest + convex-test wiring**

Run: `npm run test -- --reporter=verbose --run convex/lib/normalize 2>&1 | head -30`

Expected: either an existing test runs (capture the invocation pattern), or "no tests found" cleanly. If neither, locate any existing `*.test.ts` under `convex/` to copy its test-harness boilerplate.

- [ ] **Step 2: Confirm `convex-test` import shape**

Run: `grep -rn "from \"convex-test\"" convex/ | head -5`

Expected: at least one example like `import { convexTest } from "convex-test";`. If zero results, this codebase has no Convex tests yet — note that and follow the convex-test docs at https://docs.convex.dev/testing for the canonical setup. **Do not invent a test harness.**

- [ ] **Step 3: Read `_requestGeneration` and document its dedup invariants in plan comments**

No code change. Confirm:
- Slug uniqueness comes from the read-then-insert pattern at lines 516–559, protected by Convex's serializable transactions.
- "Failed" rows are intentionally reset and re-run — our seeding entry point should preserve this.
- Three downstream actions are scheduled: `generateContent`, `generateIllustration`, `generateSlotIllustration`, plus podcast scripting/TTS in a follow-up.

No commit (read-only).

---

## Task 1: Deterministic abbreviation expander

A static, pure-function expander. It collapses common abbreviations and punctuation noise so we don't pay an LLM call for "Sr SWE" vs "Senior Software Engineer". Its output is the **cache key** for the canonicalizer, never directly the slug.

**Files:**
- Create: `convex/lib/titleAbbreviations.ts`
- Test: `convex/lib/titleAbbreviations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/lib/titleAbbreviations.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { expandTitleAbbreviations } from "./titleAbbreviations";

describe("expandTitleAbbreviations", () => {
  it("expands seniority abbreviations", () => {
    expect(expandTitleAbbreviations("Sr Software Engineer")).toBe("senior software engineer");
    expect(expandTitleAbbreviations("Sr. Software Engineer")).toBe("senior software engineer");
    expect(expandTitleAbbreviations("Jr. Developer")).toBe("junior developer");
  });

  it("expands role abbreviations", () => {
    expect(expandTitleAbbreviations("SWE")).toBe("software engineer");
    expect(expandTitleAbbreviations("PM")).toBe("product manager");
    expect(expandTitleAbbreviations("PMM")).toBe("product marketing manager");
    expect(expandTitleAbbreviations("VP Engineering")).toBe("vice president engineering");
  });

  it("normalises whitespace and case", () => {
    expect(expandTitleAbbreviations("  Senior   Software   Engineer  ")).toBe("senior software engineer");
    expect(expandTitleAbbreviations("SENIOR SOFTWARE ENGINEER")).toBe("senior software engineer");
  });

  it("strips trailing roman-numeral / numeric levels", () => {
    expect(expandTitleAbbreviations("Software Engineer III")).toBe("software engineer");
    expect(expandTitleAbbreviations("Software Engineer 3")).toBe("software engineer");
    expect(expandTitleAbbreviations("Software Engineer II")).toBe("software engineer");
  });

  it("does not expand inside larger words", () => {
    // "PMo" is not "PM" → must not expand. Office of CTO, etc.
    expect(expandTitleAbbreviations("Office of CTO")).toBe("office of chief technology officer");
    expect(expandTitleAbbreviations("PMO Lead")).toBe("pmo lead");
  });

  it("handles empty input", () => {
    expect(expandTitleAbbreviations("")).toBe("");
    expect(expandTitleAbbreviations("   ")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run convex/lib/titleAbbreviations.test.ts`

Expected: FAIL with "Cannot find module './titleAbbreviations'" or similar.

- [ ] **Step 3: Write the implementation**

Create `convex/lib/titleAbbreviations.ts`:

```typescript
// Whole-word expansions. Order matters: longer keys first so "VP" doesn't
// shadow "VPE" if we add it. Apply each as `\b<key>\.?\b` (word boundary,
// optional trailing dot for "Sr.", "Jr."), case-insensitive.
const EXPANSIONS: Array<readonly [RegExp, string]> = [
  // Seniority
  [/\bsr\b\.?/gi, "senior"],
  [/\bjr\b\.?/gi, "junior"],
  [/\bassoc\b\.?/gi, "associate"],
  [/\basst\b\.?/gi, "assistant"],
  // Leadership
  [/\bvp\b\.?/gi, "vice president"],
  [/\bsvp\b\.?/gi, "senior vice president"],
  [/\bevp\b\.?/gi, "executive vice president"],
  [/\bcto\b\.?/gi, "chief technology officer"],
  [/\bceo\b\.?/gi, "chief executive officer"],
  [/\bcfo\b\.?/gi, "chief financial officer"],
  [/\bcoo\b\.?/gi, "chief operating officer"],
  [/\bcmo\b\.?/gi, "chief marketing officer"],
  [/\bcpo\b\.?/gi, "chief product officer"],
  // IC roles (longer first)
  [/\bpmm\b\.?/gi, "product marketing manager"],
  [/\btpm\b\.?/gi, "technical program manager"],
  [/\bswe\b\.?/gi, "software engineer"],
  [/\bsde\b\.?/gi, "software development engineer"],
  [/\bpm\b\.?/gi, "product manager"],
  [/\bem\b\.?/gi, "engineering manager"],
  [/\bux\b\.?/gi, "user experience"],
  [/\bui\b\.?/gi, "user interface"],
  [/\bqa\b\.?/gi, "quality assurance"],
  [/\bml\b\.?/gi, "machine learning"],
  [/\bai\b\.?/gi, "artificial intelligence"],
];

// Strip trailing seniority levels: "III", "II", "I" (roman) or "3", "2", "1".
// Only at the end of the string and only as standalone tokens.
const TRAILING_LEVEL = /\s+(?:i{1,3}|iv|v|[1-9])$/i;

export const expandTitleAbbreviations = (input: string): string => {
  let s = input.trim();
  if (!s) return "";

  for (const [pattern, replacement] of EXPANSIONS) {
    s = s.replace(pattern, replacement);
  }

  // Drop punctuation noise (commas, periods we missed) and collapse whitespace.
  s = s.replace(/[.,;:]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

  // Strip trailing level only after lowercasing so the regex anchors cleanly.
  s = s.replace(TRAILING_LEVEL, "").trim();

  return s;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run convex/lib/titleAbbreviations.test.ts`

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/titleAbbreviations.ts convex/lib/titleAbbreviations.test.ts
git commit -m "feat(canonicalize): deterministic title abbreviation expander

Pure rule-based prefilter that collapses common abbreviations and
seniority levels before LLM canonicalization. Used as the cache key
for title_canonicalizations to avoid LLM calls on common variants."
```

---

## Task 2: Schema additions for canonicalization cache

The cache table is keyed by the deterministic-prefilter output. Race-safety: we use a unique-ish lookup index plus read-then-insert in a serializable mutation, the same pattern `_requestGeneration` uses.

**Files:**
- Modify: `convex/schema.ts` (add new table + extend `profiles`)

- [ ] **Step 1: Invoke `convex-migration-helper` for guidance on additive schema**

This is purely additive (one new table; two new optional fields on `profiles`). Even so, per `.claude/rules/convex-patterns.md`, schema edits go through `convex-migration-helper`. Confirm with the skill that no widen-migrate-narrow phase is needed for adding optional fields, then proceed.

- [ ] **Step 2: Add the new table and fields to `convex/schema.ts`**

Within the `defineSchema({...})` block, add a new table:

```typescript
title_canonicalizations: defineTable({
  // The prefilter output (expandTitleAbbreviations result). Unique cache key.
  prefilteredKey: v.string(),
  // The raw title that originally produced this row (for debugging only).
  sourceTitle: v.string(),
  // The LLM-produced canonical title. This is what gets passed to
  // careerGuides._requestGeneration as the `title` arg, so the existing
  // slugify() pipeline produces a stable slug.
  canonicalTitle: v.string(),
  // The LLM model that produced the mapping (for audit / re-canonicalization).
  model: v.string(),
  // Confidence reported by the LLM (0..1). Below 0.5 → we still seed but flag
  // the row for manual review later.
  confidence: v.number(),
  createdAt: v.number(),
})
  .index("by_prefiltered_key", ["prefilteredKey"]),
```

In the existing `profiles` table definition, add two optional fields:

```typescript
// Set when seedGuidesFromProfile finishes for this profile. Idempotency gate:
// if set and equal to the latest experience-list checksum, we skip.
guidesSeededAt: v.optional(v.number()),
// Checksum of the experience array (sorted, normalized titles only) used for
// the most recent successful seeding pass. Re-seeds when this changes.
guidesSeedChecksum: v.optional(v.string()),
```

- [ ] **Step 3: Push schema and verify codegen**

Run: `npx convex dev --once`

Expected: schema deploys; `convex/_generated/api.d.ts` updates. **Note:** the auto-memory file `project_local_convex_codegen_blocked.md` flags that local codegen may need a hand-edit on Node 25 — if `--once` errors, follow the recovery steps in that memory.

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts convex/_generated/
git commit -m "feat(schema): add title_canonicalizations cache + profile seed gates

title_canonicalizations stores prefiltered-key → canonical-title mappings
so we LLM-canonicalize each unique prefiltered title at most once across
the whole user base. Profile fields gate idempotent re-seeding."
```

---

## Task 3: Cache lookup query and race-safe write-through mutation

Two thin Convex primitives: a query for cache lookup, and a mutation that performs read-then-insert under serializable semantics. Concurrent writes for the same key resolve to one row (loser reads the winner's row on retry and returns it).

**Files:**
- Create: `convex/titleCanonicalization.ts`
- Test: `convex/titleCanonicalization.test.ts`

- [ ] **Step 1: Write the failing test for cache lookup + write-through**

Create `convex/titleCanonicalization.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

describe("titleCanonicalization", () => {
  it("_writeThrough inserts when no existing row", async () => {
    const t = convexTest(schema);
    const result = await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "senior software engineer",
      sourceTitle: "Sr. Software Engineer",
      canonicalTitle: "Senior Software Engineer",
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.95,
    });
    expect(result.canonicalTitle).toBe("Senior Software Engineer");
  });

  it("_writeThrough returns existing row instead of duplicating (single-flight)", async () => {
    const t = convexTest(schema);
    const first = await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "product manager",
      sourceTitle: "PM",
      canonicalTitle: "Product Manager",
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.9,
    });
    // Simulate a second writer with a slightly different proposed canonical.
    const second = await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "product manager",
      sourceTitle: "P.M.",
      canonicalTitle: "PM (Product Manager)", // different proposal
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.85,
    });
    // Second call returns the first writer's canonical — no duplicate.
    expect(second.canonicalTitle).toBe("Product Manager");
    expect(second.canonicalTitle).toBe(first.canonicalTitle);

    // Verify only one row exists.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("title_canonicalizations")
        .withIndex("by_prefiltered_key", (q) => q.eq("prefilteredKey", "product manager"))
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("_lookup returns null on miss and the row on hit", async () => {
    const t = convexTest(schema);
    const miss = await t.query(internal.titleCanonicalization._lookup, {
      prefilteredKey: "nonexistent",
    });
    expect(miss).toBeNull();

    await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "data scientist",
      sourceTitle: "Data Scientist",
      canonicalTitle: "Data Scientist",
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.99,
    });
    const hit = await t.query(internal.titleCanonicalization._lookup, {
      prefilteredKey: "data scientist",
    });
    expect(hit?.canonicalTitle).toBe("Data Scientist");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run convex/titleCanonicalization.test.ts`

Expected: FAIL — module/exports missing.

- [ ] **Step 3: Write the lookup query and write-through mutation**

Create `convex/titleCanonicalization.ts`:

```typescript
import { v } from "convex/values";
import { internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { expandTitleAbbreviations } from "./lib/titleAbbreviations";

export const _lookup = internalQuery({
  args: { prefilteredKey: v.string() },
  handler: async (ctx, { prefilteredKey }) => {
    return await ctx.db
      .query("title_canonicalizations")
      .withIndex("by_prefiltered_key", (q) => q.eq("prefilteredKey", prefilteredKey))
      .first();
  },
});

export const _writeThrough = internalMutation({
  args: {
    prefilteredKey: v.string(),
    sourceTitle: v.string(),
    canonicalTitle: v.string(),
    model: v.string(),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    // Read-then-insert under serializable transaction. If a concurrent writer
    // committed first, our commit will OCC-conflict and retry; on retry the
    // read finds the existing row and we return it.
    const existing = await ctx.db
      .query("title_canonicalizations")
      .withIndex("by_prefiltered_key", (q) => q.eq("prefilteredKey", args.prefilteredKey))
      .first();
    if (existing) {
      return {
        _id: existing._id,
        canonicalTitle: existing.canonicalTitle,
        confidence: existing.confidence,
        cached: true as const,
      };
    }
    const _id = await ctx.db.insert("title_canonicalizations", {
      prefilteredKey: args.prefilteredKey,
      sourceTitle: args.sourceTitle,
      canonicalTitle: args.canonicalTitle,
      model: args.model,
      confidence: args.confidence,
      createdAt: Date.now(),
    });
    return {
      _id,
      canonicalTitle: args.canonicalTitle,
      confidence: args.confidence,
      cached: false as const,
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run convex/titleCanonicalization.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/titleCanonicalization.ts convex/titleCanonicalization.test.ts
git commit -m "feat(canonicalize): cache lookup + race-safe write-through

_writeThrough uses Convex serializable read-then-insert so concurrent
writers for the same prefiltered key resolve to a single row. Losers
return the winner's canonical instead of inserting a duplicate."
```

---

## Task 4: LLM canonicalization action

The action that bridges cache misses to OpenRouter. **Read `.claude/rules/ai-sdk-patterns.md` before writing this code.** Use `chatModel` from `lib/ai/providers.ts` with `Output.object`. Per the AI rules, this is a background/batch surface, so use `generateText` (not `streamText`).

**Files:**
- Modify: `convex/titleCanonicalization.ts` (add `getOrCreateCanonical` action)
- Modify: `convex/titleCanonicalization.test.ts` (add cache-miss → LLM-call test using a stubbed model)

- [ ] **Step 1: Read project AI patterns**

Read: `lib/ai/providers.ts`, `.claude/rules/ai-sdk-patterns.md`. Confirm `chatModel(modelId)` is available and the canonical Gemini ID. Per `project_inference_model_gemini.md` memory, default is `google/gemini-3.1-pro-preview`. Confirm by reading providers.ts directly — do not trust memory. Also read `convex/_generated/ai/guidelines.md` for any Convex-specific structured-output gotchas.

Per `feedback_gemini_structured_output_schema_limits.md` memory: **Gemini structured output rejects bound/array-length constraints** — strip `.int()`, `.min()`, `.max()`, array-length from Zod for Gemini schemas. We'll encode bounds (e.g., confidence 0–1) in the prompt instead.

- [ ] **Step 2: Write the failing test for `getOrCreateCanonical`**

Append to `convex/titleCanonicalization.test.ts`:

```typescript
import { vi } from "vitest";

describe("getOrCreateCanonical", () => {
  it("returns cached canonical without LLM call on cache hit", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "senior software engineer",
      sourceTitle: "Sr SWE",
      canonicalTitle: "Senior Software Engineer",
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.95,
    });

    const result = await t.action(internal.titleCanonicalization.getOrCreateCanonical, {
      rawTitle: "Sr. SWE",
    });
    expect(result.canonicalTitle).toBe("Senior Software Engineer");
    expect(result.cached).toBe(true);
  });

  it("normalizes 'Sr. SWE' and 'Senior Software Engineer' to the same cache key", async () => {
    // Both inputs prefilter to "senior software engineer"; only one LLM call
    // ever happens (verified by inspecting the cache row count).
    const t = convexTest(schema);
    // Seed the cache as if the LLM had run once for the prefiltered key.
    await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "senior software engineer",
      sourceTitle: "Sr. SWE",
      canonicalTitle: "Senior Software Engineer",
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.95,
    });

    const r1 = await t.action(internal.titleCanonicalization.getOrCreateCanonical, {
      rawTitle: "Sr. SWE",
    });
    const r2 = await t.action(internal.titleCanonicalization.getOrCreateCanonical, {
      rawTitle: "Senior Software Engineer",
    });
    expect(r1.canonicalTitle).toBe(r2.canonicalTitle);
    expect(r1.cached).toBe(true);
    expect(r2.cached).toBe(true);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("title_canonicalizations").collect(),
    );
    expect(rows).toHaveLength(1);
  });

  // NOTE: We do not unit-test the cache-miss → real-LLM path here. That requires
  // a network call which violates test hygiene. The cache-miss code path is
  // covered by manual smoke testing in Task 9 and by the integration of
  // seedGuidesFromProfile in Task 6 (which can be exercised against a dev
  // Convex deployment with OPENROUTER_API_KEY set).
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- --run convex/titleCanonicalization.test.ts`

Expected: FAIL — `getOrCreateCanonical` not exported.

- [ ] **Step 4: Implement `getOrCreateCanonical`**

Append to `convex/titleCanonicalization.ts`:

```typescript
import { z } from "zod";
import { generateText, Output } from "ai";
import { chatModel } from "../lib/ai/providers";

// Gemini structured output: NO bound constraints (.min, .max, .int) — encode
// in the prompt instead. See feedback_gemini_structured_output_schema_limits.
const canonicalSchema = z.object({
  canonical_title: z.string().describe(
    "The canonical, fully-spelled-out, seniority-stripped form of this job title. " +
      "Examples: 'Senior Software Engineer' → 'Software Engineer'; 'Sr. PM' → 'Product Manager'; " +
      "'VP of Engineering' → 'Vice President of Engineering'. Use Title Case.",
  ),
  confidence: z.number().describe(
    "Your confidence in this canonicalization, from 0.0 to 1.0. " +
      "Use 1.0 for unambiguous mappings, 0.5 for guesses, below 0.5 if the input is too ambiguous to canonicalize.",
  ),
});

const CANONICAL_MODEL_ID = "google/gemini-3.1-pro-preview";

export const getOrCreateCanonical = internalAction({
  args: { rawTitle: v.string() },
  handler: async (ctx, { rawTitle }): Promise<{
    canonicalTitle: string;
    confidence: number;
    cached: boolean;
  }> => {
    const prefilteredKey = expandTitleAbbreviations(rawTitle);
    if (!prefilteredKey) {
      return { canonicalTitle: rawTitle.trim(), confidence: 0, cached: false };
    }

    // Cache lookup.
    const hit = await ctx.runQuery(internal.titleCanonicalization._lookup, {
      prefilteredKey,
    });
    if (hit) {
      return {
        canonicalTitle: hit.canonicalTitle,
        confidence: hit.confidence,
        cached: true,
      };
    }

    // Cache miss: call the LLM.
    const model = chatModel(CANONICAL_MODEL_ID);
    const { experimental_output } = await generateText({
      model,
      experimental_output: Output.object({ schema: canonicalSchema }),
      prompt:
        "Canonicalize this job title to its general, public, seniority-stripped form for use as a shared career-guide topic. " +
        "Strip seniority qualifiers (Junior, Senior, Lead, Staff, Principal, etc) UNLESS the seniority is part of the role itself (e.g. 'Vice President', 'Chief Technology Officer'). " +
        "Spell out abbreviations. Use Title Case. Confidence is 0.0–1.0.\n\n" +
        `Raw title: ${rawTitle}`,
      // Tight token budget: this is a one-line transform.
      maxOutputTokens: 200,
    });

    const canonical = experimental_output.canonical_title.trim();
    const confidence = experimental_output.confidence;

    // Write through. Race-safe: if another writer landed first, _writeThrough
    // returns their row.
    const written = await ctx.runMutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey,
      sourceTitle: rawTitle,
      canonicalTitle: canonical,
      model: CANONICAL_MODEL_ID,
      confidence,
    });

    return {
      canonicalTitle: written.canonicalTitle,
      confidence: written.confidence,
      cached: written.cached,
    };
  },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- --run convex/titleCanonicalization.test.ts`

Expected: 5 tests pass total (3 from Task 3 + 2 cache-hit tests added in Step 2).

- [ ] **Step 6: Commit**

```bash
git add convex/titleCanonicalization.ts convex/titleCanonicalization.test.ts
git commit -m "feat(canonicalize): LLM-backed getOrCreateCanonical action

Cache hit returns instantly. Miss calls Gemini 3.1 Pro via OpenRouter
with a tight Output.object schema, then write-throughs the result.
Race-safe: concurrent misses for the same prefiltered key resolve to
a single canonical via the _writeThrough OCC pattern."
```

---

## Task 5: Seeding-flavored entry point in careerGuides

The existing `_requestGeneration` rate-limits per `clientIp` and is meant for user-driven generation. Seeding fans out 5–10 titles per profile in a burst — would trip the limit. We add a sibling `_requestGenerationForSeeding` that:
- Takes a `userId` instead of `clientIp` for rate-limit bucket scoping.
- Applies a per-user daily seeding cap (e.g., 25 generations / 24h) instead of the IP burst cap.
- Otherwise reuses the *exact same* slug/titleNormalized dedup logic so the row-uniqueness invariant is preserved.

**Files:**
- Modify: `convex/careerGuides.ts` (add new export only; do not modify `_requestGeneration`)
- Test: extended in Task 6's test file

- [ ] **Step 1: Locate the rate-limit primitives in `convex/careerGuides.ts`**

Read the imports and the `tryConsumeRateLimit` / `GENERATE_RATE` definitions. Find the file that exports them (likely `convex/lib/rateLimit.ts` or similar). Note the args shape — we need a separate rate config for seeding.

Run: `grep -rn "tryConsumeRateLimit\|GENERATE_RATE" convex/`

Expected: locations of the rate-limit helper and the existing rate config.

- [ ] **Step 2: Define a seeding rate config**

In whichever file holds `GENERATE_RATE`, add (do not modify the existing one):

```typescript
// Per-user cap on system-driven seeding. Tuned for ~10 jobs × 1 generation
// each, with headroom for retries and re-seeds on profile edits.
export const SEED_RATE = {
  // Adjust the shape to match the helper's signature — e.g.:
  // limit: 25, windowMs: 24 * 60 * 60 * 1000,
  limit: 25,
  windowMs: 24 * 60 * 60 * 1000,
} as const;
```

If the helper takes a different shape, match it exactly — read the helper before writing the config.

- [ ] **Step 3: Add `_requestGenerationForSeeding` to `convex/careerGuides.ts`**

Append after `_requestGeneration` (around line 595+):

```typescript
export const _requestGenerationForSeeding = internalMutation({
  args: { title: v.string(), userId: v.id("users") },
  handler: async (
    ctx,
    args,
  ): Promise<{ slug: string } | { error: string }> => {
    const limit = await tryConsumeRateLimit(ctx, {
      key: `seed:${args.userId}`,
      ...SEED_RATE,
    });
    if (!limit.ok) {
      return { error: "Per-user seed rate limit hit." };
    }

    const slug = slugify(args.title);
    const titleNormalized = normalizeTitle(args.title);
    if (!slug || !titleNormalized) {
      return { error: "Invalid title." };
    }

    // The exact same dedup pattern as _requestGeneration. This is the
    // row-level guarantee: concurrent seeders racing on the same slug
    // resolve to one row via OCC + the by_slug index.
    const existingBySlug = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    const existingByTitle =
      existingBySlug ??
      (await ctx.db
        .query("career_guides")
        .withIndex("by_title_normalized", (q) =>
          q.eq("titleNormalized", titleNormalized),
        )
        .first());

    if (existingByTitle && existingByTitle.contentStatus !== "failed") {
      return { slug: existingByTitle.slug };
    }

    const now = Date.now();
    const initialSlotIllustrations = buildInitialSlotIllustrations();

    let guideId;
    if (existingByTitle) {
      guideId = existingByTitle._id;
      await ctx.db.patch(guideId, {
        contentStatus: "generating",
        illustrationStatus: "generating",
        illustrationStorageId: undefined,
        slotIllustrations: initialSlotIllustrations,
        content: undefined,
        updatedAt: now,
      });
    } else {
      guideId = await ctx.db.insert("career_guides", {
        slug,
        title: args.title,
        titleNormalized,
        contentStatus: "generating",
        illustrationStatus: "generating",
        slotIllustrations: initialSlotIllustrations,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.careerGuides.generateContent, {
      guideId,
      title: args.title,
    });
    await ctx.scheduler.runAfter(0, internal.careerGuides.generateIllustration, {
      guideId,
      title: args.title,
    });
    await ctx.scheduler.runAfter(0, internal.careerGuides.generateSlotIllustration, {
      guideId,
      title: args.title,
    });

    return { slug };
  },
});
```

If `_requestGeneration` schedules additional downstream actions (podcast scripting, etc.) at lines 566–595+, **mirror those exactly** in this new entry point. Re-read the original to verify nothing is missed.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add convex/careerGuides.ts convex/lib/rateLimit.ts
git commit -m "feat(career-guides): seeding-scoped generation entry point

_requestGenerationForSeeding mirrors _requestGeneration's slug-dedup
pipeline but rate-limits per userId (not per IP) with a per-day cap
suited to bursty profile-seeding fan-out. Existing IP-rate-limited
entry point is unchanged and still used for user-driven generation."
```

---

## Task 6: Profile guide seeding fan-out action

The orchestrator: read profile, dedupe titles, canonicalize each, dedupe canonicals, fan out to `_requestGenerationForSeeding`. Idempotent via `guidesSeededAt` + `guidesSeedChecksum`.

**Files:**
- Create: `convex/profileGuideSeeding.ts`
- Test: `convex/profileGuideSeeding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/profileGuideSeeding.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal, api } from "./_generated/api";

const seedProfile = async (
  t: ReturnType<typeof convexTest>,
  experience: Array<{ title: string; company: string; startDate: string; endDate?: string; description?: string }>,
) => {
  return await t.run(async (ctx) => {
    // Insert a fake user + profile with the given experience array.
    const userId = await ctx.db.insert("users", {
      // Match the actual users-table shape — read convex/schema.ts before this step.
      clerkId: `clerk_test_${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
    });
    const profileId = await ctx.db.insert("profiles", {
      userId,
      experience,
      schools: [],
      skills: [],
      reviewed: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { userId, profileId };
  });
};

describe("seedGuidesFromProfile", () => {
  it("dedupes titles within a single profile (e.g. three 'Software Engineer' roles → one guide)", async () => {
    const t = convexTest(schema);
    // Pre-seed the canonicalization cache so we don't hit the LLM.
    await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "software engineer",
      sourceTitle: "Software Engineer",
      canonicalTitle: "Software Engineer",
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.99,
    });

    const { userId } = await seedProfile(t, [
      { title: "Software Engineer", company: "A", startDate: "2018-01" },
      { title: "Software Engineer", company: "B", startDate: "2020-01" },
      { title: "Software Engineer", company: "C", startDate: "2022-01" },
    ]);

    await t.action(internal.profileGuideSeeding.seedGuidesFromProfile, { userId });

    const guides = await t.run(async (ctx) =>
      ctx.db.query("career_guides").collect(),
    );
    expect(guides).toHaveLength(1);
    expect(guides[0].title).toBe("Software Engineer");
  });

  it("two concurrent profiles with overlapping titles produce one guide row per canonical", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "product manager",
      sourceTitle: "PM",
      canonicalTitle: "Product Manager",
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.99,
    });

    const { userId: user1 } = await seedProfile(t, [
      { title: "PM", company: "A", startDate: "2018-01" },
    ]);
    const { userId: user2 } = await seedProfile(t, [
      { title: "Product Manager", company: "B", startDate: "2019-01" },
    ]);

    await Promise.all([
      t.action(internal.profileGuideSeeding.seedGuidesFromProfile, { userId: user1 }),
      t.action(internal.profileGuideSeeding.seedGuidesFromProfile, { userId: user2 }),
    ]);

    const guides = await t.run(async (ctx) =>
      ctx.db
        .query("career_guides")
        .withIndex("by_title_normalized", (q) =>
          q.eq("titleNormalized", "product manager"),
        )
        .collect(),
    );
    expect(guides).toHaveLength(1);
  });

  it("is idempotent — re-running on an unchanged profile creates no new guides", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "data scientist",
      sourceTitle: "Data Scientist",
      canonicalTitle: "Data Scientist",
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.99,
    });

    const { userId } = await seedProfile(t, [
      { title: "Data Scientist", company: "A", startDate: "2020-01" },
    ]);

    await t.action(internal.profileGuideSeeding.seedGuidesFromProfile, { userId });
    await t.action(internal.profileGuideSeeding.seedGuidesFromProfile, { userId });

    const guides = await t.run(async (ctx) =>
      ctx.db.query("career_guides").collect(),
    );
    expect(guides).toHaveLength(1);
  });

  it("caps at 10 most recent jobs (sorted by endDate desc, currentRole first)", async () => {
    // Pre-seed 12 distinct canonicalizations.
    const t = convexTest(schema);
    const titles = Array.from({ length: 12 }, (_, i) => `Role ${i}`);
    for (const title of titles) {
      await t.mutation(internal.titleCanonicalization._writeThrough, {
        prefilteredKey: title.toLowerCase(),
        sourceTitle: title,
        canonicalTitle: title,
        model: "google/gemini-3.1-pro-preview",
        confidence: 0.99,
      });
    }

    const experience = titles.map((title, i) => ({
      title,
      company: `Co${i}`,
      // Older roles first; we expect the top 10 by recency to win.
      startDate: `${2010 + i}-01`,
      endDate: `${2010 + i}-12`,
    }));
    const { userId } = await seedProfile(t, experience);

    await t.action(internal.profileGuideSeeding.seedGuidesFromProfile, { userId });

    const guides = await t.run(async (ctx) =>
      ctx.db.query("career_guides").collect(),
    );
    expect(guides).toHaveLength(10);
    // Newest 10 win: "Role 2" through "Role 11".
    const guideTitles = guides.map((g) => g.title).sort();
    expect(guideTitles).not.toContain("Role 0");
    expect(guideTitles).not.toContain("Role 1");
    expect(guideTitles).toContain("Role 11");
  });
});
```

**Note on the test scaffolding:** the `seedProfile` helper calls `ctx.db.insert("users", ...)` and `ctx.db.insert("profiles", ...)` with stub data. Read `convex/schema.ts` for the actual users + profiles table shape and adjust the inserts to satisfy validators. If `users` requires more fields, populate them.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run convex/profileGuideSeeding.test.ts`

Expected: FAIL — `seedGuidesFromProfile` not exported.

- [ ] **Step 3: Implement `seedGuidesFromProfile`**

Create `convex/profileGuideSeeding.ts`:

```typescript
import { v } from "convex/values";
import { internalAction, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { expandTitleAbbreviations } from "./lib/titleAbbreviations";
import { createHash } from "node:crypto";

const MAX_JOBS_PER_SEED = 10;

const checksumOf = (canonicalTitles: string[]): string => {
  const sorted = [...canonicalTitles].sort().join("|");
  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
};

// Most recent first. Treats missing endDate as "current" (sorts to top).
const sortByRecency = <T extends { endDate?: string; startDate: string }>(
  jobs: T[],
): T[] =>
  [...jobs].sort((a, b) => {
    const aKey = a.endDate ?? "9999-99";
    const bKey = b.endDate ?? "9999-99";
    if (aKey !== bKey) return bKey.localeCompare(aKey);
    return b.startDate.localeCompare(a.startDate);
  });

export const _loadProfileForSeeding = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const _markSeeded = internalMutation({
  args: {
    profileId: v.id("profiles"),
    checksum: v.string(),
    seededSlugs: v.array(v.string()),
  },
  handler: async (ctx, { profileId, checksum, seededSlugs }) => {
    await ctx.db.patch(profileId, {
      guidesSeededAt: Date.now(),
      guidesSeedChecksum: checksum,
      seedingGuideSlugs: seededSlugs,
    });
  },
});

export const seedGuidesFromProfile = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ seededSlugs: string[]; skipped: boolean }> => {
    const profile = await ctx.runQuery(internal.profileGuideSeeding._loadProfileForSeeding, {
      userId,
    });
    if (!profile) return { seededSlugs: [], skipped: true };

    // Take top-N most recent jobs.
    const recent = sortByRecency(profile.experience).slice(0, MAX_JOBS_PER_SEED);

    // First pass: dedupe by deterministic prefilter so we don't call the LLM twice
    // for "Sr SWE" and "Senior Software Engineer" within the same profile.
    const seenPrefilter = new Set<string>();
    const uniqueRawTitles: string[] = [];
    for (const job of recent) {
      if (!job.title) continue;
      const key = expandTitleAbbreviations(job.title);
      if (!key) continue;
      if (seenPrefilter.has(key)) continue;
      seenPrefilter.add(key);
      uniqueRawTitles.push(job.title);
    }

    // Canonicalize each (cache hits return instantly; misses share the cache for
    // future profiles). Run with bounded concurrency — Convex actions can run
    // promises concurrently but we don't want to overwhelm OpenRouter.
    const canonicalResults = await Promise.all(
      uniqueRawTitles.map((rawTitle) =>
        ctx.runAction(internal.titleCanonicalization.getOrCreateCanonical, { rawTitle }),
      ),
    );

    // Second pass: dedupe by canonical title (LLM may map two different
    // prefilters to the same canonical, e.g. "lead engineer" and "engineering lead").
    const seenCanonical = new Map<string, string>();
    for (const r of canonicalResults) {
      if (r.confidence < 0.3) continue; // Skip low-confidence
      seenCanonical.set(r.canonicalTitle.toLowerCase(), r.canonicalTitle);
    }

    // Idempotency check: if the canonical set hasn't changed, no-op.
    const canonicalTitles = Array.from(seenCanonical.values());
    const checksum = checksumOf(canonicalTitles);
    if (profile.guidesSeedChecksum === checksum) {
      return { seededSlugs: profile.seedingGuideSlugs ?? [], skipped: true };
    }

    // Fan out to the seeding-scoped generation entry point. Each call is
    // independently OCC-deduped at the row level via slug index.
    const generationResults = await Promise.all(
      canonicalTitles.map((title) =>
        ctx.runMutation(internal.careerGuides._requestGenerationForSeeding, {
          title,
          userId,
        }),
      ),
    );

    const seededSlugs = generationResults
      .filter((r): r is { slug: string } => "slug" in r)
      .map((r) => r.slug);

    await ctx.runMutation(internal.profileGuideSeeding._markSeeded, {
      profileId: profile._id,
      checksum,
      seededSlugs,
    });

    return { seededSlugs, skipped: false };
  },
});
```

Add `seedingGuideSlugs: v.optional(v.array(v.string()))` to the `profiles` table validators in `convex/schema.ts` (in addition to the two fields added in Task 2). Re-run `npx convex dev --once`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run convex/profileGuideSeeding.test.ts`

Expected: 4 tests pass.

If the canonicalization-confidence filter (`< 0.3`) interacts badly with cached test data (confidence 0.99), all should pass. If a test fails with "0 guides", debug the `seenCanonical` filter.

- [ ] **Step 5: Commit**

```bash
git add convex/profileGuideSeeding.ts convex/profileGuideSeeding.test.ts convex/schema.ts convex/_generated/
git commit -m "feat(seeding): seedGuidesFromProfile fans out canonical titles

Two-pass dedup (prefilter, then canonical), top-10 most-recent jobs,
checksum-based idempotency. Concurrent fan-outs across users with
overlapping titles resolve to one career_guides row per canonical
via the existing slug-OCC pattern in _requestGenerationForSeeding."
```

---

## Task 7: Wire seeding into `markReviewed`

The single hook into the existing flow. Profile review → discover snapshot regen (existing) + guide seeding (new), in parallel.

**Files:**
- Modify: `convex/profiles.ts` (lines 267–283 — the `markReviewed` mutation)

- [ ] **Step 1: Add the schedule call**

Edit `convex/profiles.ts:markReviewed` to schedule the seeding fan-out alongside the existing snapshot regen:

```typescript
export const markReviewed = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await userOwnedProfile(ctx);
    await ctx.db.patch(profile._id, { reviewed: true });

    await ctx.scheduler.runAfter(
      0,
      internal.discover.scheduleSnapshotRegeneration,
      {
        userId: profile.userId,
        dedupKey: "init",
        forceFreshReasons: false,
      },
    );

    // Seed public career guides for the canonical titles in this profile's
    // work history. Idempotent — re-running markReviewed is safe.
    await ctx.scheduler.runAfter(
      0,
      internal.profileGuideSeeding.seedGuidesFromProfile,
      { userId: profile.userId },
    );
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Run the full Convex test suite**

Run: `npm run test -- --run convex/`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add convex/profiles.ts
git commit -m "feat(profiles): trigger guide seeding on markReviewed

Profile review now fans out canonical-title-keyed career guide
generation in parallel with the existing discover snapshot regen.
Idempotent — re-reviewing a profile is a no-op."
```

---

## Task 8: Manual smoke test against dev Convex

End-to-end verification with real OpenRouter calls. Per `.claude/rules/convex-patterns.md`, Convex functions are not done until `convex-performance-audit` has run on the changed files.

- [ ] **Step 1: Start the dev environment**

Run: `npx convex dev --once && npm run dev`

Expected: Convex pushes the schema; Next.js starts on the project's dev port.

- [ ] **Step 2: Reset a test profile**

In a Convex dashboard query, find a test user's profile and clear `reviewed`, `guidesSeededAt`, `guidesSeedChecksum`. Or use `convex/profiles.ts:clear` if it suffices.

- [ ] **Step 3: Trigger profile review via the UI**

In the running app, sign in as the test user, upload a CV with at least 5 distinct job titles (mix of common abbreviations: "Sr SWE", "Software Engineer", "PM", "Senior PM", "Engineering Manager"), and click whatever UI control invokes `profiles.markReviewed`.

- [ ] **Step 4: Verify in the Convex dashboard**

Within ~60 seconds:
- `title_canonicalizations` table has rows for each unique prefilter (expect 4–5 rows for the test set above, since "Sr SWE" + "Software Engineer" share a prefilter).
- `career_guides` table has new rows with `contentStatus: "generating"` then transitioning to `"complete"`.
- Guide titles match the canonicalized form (e.g., "Senior Software Engineer", not "Sr SWE").
- `profiles.guidesSeededAt` and `profiles.guidesSeedChecksum` are set.

- [ ] **Step 5: Trigger again — verify idempotency**

Call `markReviewed` a second time (e.g., toggle reviewed off in the dashboard, then click review again).

Expected:
- `title_canonicalizations` row count unchanged.
- `career_guides` row count unchanged.
- `seedGuidesFromProfile` returns `{ skipped: true }` (visible in Convex logs).

- [ ] **Step 6: Concurrent-user test**

In a second incognito window, sign in as a different test user with a CV that contains at least one overlapping role (e.g., also "PM"). Trigger review.

Expected: no new `career_guides` row for "Product Manager" — the second user attaches to the first user's existing guide.

- [ ] **Step 7: Run convex-performance-audit**

Invoke the `convex-performance-audit` skill on the new files: `convex/titleCanonicalization.ts`, `convex/profileGuideSeeding.ts`, the changes in `convex/careerGuides.ts` and `convex/profiles.ts`. Address any P0/P1 findings.

Expected: no P0 findings; P1 findings either fixed in a follow-up commit or deferred with explicit justification.

- [ ] **Step 8: Commit any audit-driven fixes**

```bash
git add convex/
git commit -m "perf(seeding): address convex-performance-audit findings"
```

(Skip if no fixes needed.)

---

## Task 9: Document the Discover-recompute follow-up gap

This plan does not auto-recompute Discover snapshots when seeded guides finish. Document the gap so the next dev (or the user) picks it up.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-02-public-guide-seeding-from-profile.md` — add a "Follow-ups" section pointing at this gap.
- Update: `~/.claude/projects/-Users-aqilrouf-Documents-Projects-career-steer-v2/memory/project_discover_followups.md` — add the gap as a deferred idea.

- [ ] **Step 1: Append a Follow-ups section to this plan**

Add to the bottom of this file:

```markdown
## Follow-ups

- **Discover snapshot recompute on seeded-guide completion.** When a seeded guide transitions to `contentStatus: "complete"` and its embedding is upserted, the existing `fanOutGuideUpdate` only invalidates users whose live snapshot already references the guide. For a brand-new guide seeded by this user, no snapshot references it yet, so it won't auto-surface. Fix shape: either (a) extend `fanOutGuideUpdate` to also check `profiles.seedingGuideSlugs` for users awaiting their seeded guides, or (b) schedule a delayed `discover.scheduleSnapshotRegeneration` after `seedGuidesFromProfile` completes (e.g., 60–120s) on the assumption guides are done by then.
- **Backfill for existing reviewed profiles.** Run `seedGuidesFromProfile` once for every profile that has `reviewed: true` and `guidesSeededAt: undefined`.
- **O*NET / SOC taxonomy mapping.** Replace the LLM-canonicalizer with a structured-taxonomy lookup once we have a list of supported roles. Cache table can absorb the migration without schema change.
- **Per-user seeding rate-limit tuning.** `SEED_RATE` is set conservatively (25/24h). Tune after first week of production usage based on Convex insights.
```

- [ ] **Step 2: Update the project memory**

Append to `project_discover_followups.md` a one-liner pointing at the recompute gap with date `2026-05-02`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-02-public-guide-seeding-from-profile.md
git commit -m "docs(seeding): document discover-recompute follow-up gap"
```

---

## Verification before completion

Per `superpowers:verification-before-completion` and the project's path-based rules:

- [ ] All vitest tests pass: `npm run test -- --run`
- [ ] TypeScript clean: `npx tsc --noEmit`
- [ ] `convex-performance-audit` ran on changed Convex files; no P0 findings
- [ ] `/audit` ran on any UI surface affected (none expected — this plan is backend-only)
- [ ] Smoke test (Task 8) passed: end-to-end profile review → guide rows visible in dashboard with canonical titles
- [ ] Concurrent-user test (Task 8 Step 6) confirmed only one guide row per canonical title across two profiles
- [ ] Idempotency confirmed (Task 8 Step 5)

The "duplicates impossible" guarantee rests on three claims, each verified above:
1. **Same prefilter input → same cache key** — guaranteed by `expandTitleAbbreviations` being a pure deterministic function (Task 1 tests).
2. **Same cache key → same canonical title forever** — guaranteed by `_writeThrough` returning the existing row on subsequent calls (Task 3 tests).
3. **Same canonical title → same `career_guides` row** — guaranteed by the existing slug-OCC pattern preserved verbatim in `_requestGenerationForSeeding` (Task 5; Task 6 concurrent-profiles test).
