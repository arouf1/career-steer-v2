# Public Career Guide Seeding from Profile Setup — Shipped Plan

**Branch:** `feature/profile-guide-seeding`
**Date:** 2026-05-02

## What shipped

When a user finishes profile review (`profiles.markReviewed`), the system automatically seeds public career guides for the canonical job titles in their work history. Two users with the same role (regardless of how it was written: "Sr SWE" vs "Senior Software Engineer") share one guide row — duplicates are impossible by construction.

## Architecture (three-layer dedup, in order of cost)

1. **Deterministic prefilter** — `convex/lib/titleAbbreviations.ts`. Pure rule-based expander: "Sr." → "Senior", "SWE" → "Software Engineer", strips trailing "III"/"3", lowercases. Output is the cache key for layer 2.
2. **LLM canonicalizer with cache** — `convex/titleCanonicalization.ts`. `title_canonicalizations` table keyed by the prefilter output. Cache hit returns instantly; cache miss calls Gemini 3.1 Pro via OpenRouter and writes through a race-safe read-then-insert. Concurrent misses for the same key resolve to one row via Convex serializable transactions.
3. **Row-level OCC dedup** — existing pattern in `convex/careerGuides.ts:_requestGeneration`, mirrored verbatim in the new `_requestGenerationForSeeding`. Concurrent fan-outs for the same canonical title resolve to one `career_guides` row via the `by_slug` index.

The mirror in step 3 is verbatim of `_requestGeneration` lines 506–575 — so the entire downstream pipeline (content + Exa grounding, hero + slot illustrations, podcast script + Gemini TTS, embeddings, branches prewarm, deferred enrichment) is inherited by `_requestGenerationForSeeding` because every downstream action is fanned out by `guideId`, not by entry point. **A seeded guide is byte-for-byte identical to a user-searched guide.**

## Files changed

**Created:**
- `convex/lib/titleAbbreviations.ts` + `.test.ts`
- `convex/titleCanonicalization.ts` + `.test.ts`
- `convex/profileGuideSeeding.ts` + `.test.ts`

**Modified:**
- `convex/schema.ts` — add `title_canonicalizations` table; add `guidesSeededAt`, `guidesSeedChecksum`, `seedingGuideSlugs` optional fields to `profiles`
- `convex/careerGuides.ts` — append `_requestGenerationForSeeding` (existing `_requestGeneration` unchanged)
- `convex/profiles.ts:markReviewed` — schedule `internal.profileGuideSeeding.seedGuidesFromProfile`
- `convex/_generated/api.d.ts` — hand-edited to register new modules (Node 25 blocks local Convex codegen; cloud codegen will overwrite this on next deploy)

## Verification (automated)

- ✅ Vitest: 30/30 pass (`npm test`)
- ✅ Typecheck: clean (`npx tsc --noEmit`)
- ✅ `convex-performance-audit`: no P0/P1 issues; one P3 observation (profile doc widening from `_markSeeded`'s 3 new fields — minor, single-user reactive scope, not worth a sidecar at MVP scale)

## Smoke test (manual — required before merge to production)

The local Convex backend rejects Node 25 (per project memory `project_local_convex_codegen_blocked.md`). Run on Node 24 or against a cloud Convex deployment with `OPENROUTER_API_KEY` set:

1. `npx convex dev --once && npm run dev`
2. Sign in as test user A; upload CV with mixed abbreviations ("Sr SWE", "Software Engineer", "PM", "Senior PM", "Engineering Manager"); trigger profile review
3. Verify in Convex dashboard within ~60s: `title_canonicalizations` has ~4–5 rows; `career_guides` has new rows with canonicalized titles; `profile.guidesSeededAt` is set
4. Re-trigger review — `seedGuidesFromProfile` returns `{ skipped: true }`; row counts unchanged (idempotency)
5. Sign in as test user B (incognito) with overlapping role ("PM"); trigger review — no new `career_guides` row for "Product Manager" (cross-user dedup)

## Follow-ups

Recorded in `~/.claude/projects/.../memory/project_discover_followups.md` under "Profile-driven guide seeding (added 2026-05-02)":

- **Discover snapshot recompute when seeded guides complete** — existing `fanOutGuideUpdate` only invalidates users whose snapshot already references a guide; seeded guides won't auto-surface on first canvas view. Fix shape (a) extend fanout to check `profiles.seedingGuideSlugs`; (b) delayed snapshot regen post-seeding. (a) cleaner, (b) one line.
- **Backfill for existing reviewed profiles** — query `profiles` where `reviewed: true && guidesSeededAt: undefined`, fan out seeding. Trivial; do once recompute is wired.
- **O*NET / SOC structured taxonomy** as the long-term canonicalization layer (replaces LLM with deterministic mapping; schema unchanged).
- **Per-user seeding rate-limit tuning** — `SEED_RATE = 25/24h` is conservative; revisit with insights data.
- **Confidence-threshold tuning** — currently `MIN_CONFIDENCE = 0.3` silently skips low-confidence canonicalizations.
