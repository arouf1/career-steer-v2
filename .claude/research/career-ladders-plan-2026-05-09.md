# Career Ladders — first-class progression schema, ladder-aware dedup, Compass rewiring

## Context

Two problems sit on the same root: there is no data model for the relationship between roles on a career progression. The dedup bug ("Head of Product" → existing "Product Manager" guide) and the audit's P0 issues (empty Linear lane, sparse Adjacent lane, noisy Earlier lane on Career Compass — see `.claude/career-compass-audit-2026-05-09.md`) are different symptoms of the same missing concept: **career guides should know which ladder they sit on and at which rung.**

Without this, the algorithm is forced to guess relationships from embedding similarity (which conflates Product Manager and Sales Engineer because they share professional language) and the dedup LLM is forced to guess from prompt instructions (which collapses leadership tiers into the IC roles they manage). Both will keep failing in different shapes for different users until the data encodes the structure.

Adding **ladders as a first-class schema entity** turns multiple guess-driven heuristics into a single deterministic walk: the user's primary ladder rung is known, "next steps" is the next rung up, "earlier chapters" is the rungs below, "sideways moves" is the same tier on adjacent ladders, and dedup is "is this title a rung that already exists on a known ladder?". The 140-guide catalog gets backfilled onto ladders via an LLM classifier; new guides created on demand attach to a ladder at generation time.

Out of scope of this plan: the audit's other P1/P2 items (missing typicalCareerStage on 4 guides, dead `assignLane` code, seedingGuideSlugs only capturing one role). Those become much less load-bearing once ladders exist; revisit after Phase 4.

---

## Architecture decision — "ladders" not "edges"

Considered three shapes (self-pointer, typed edge table, ladders-as-entity). Choosing **ladders-as-entity** because:

- A guide can sit on multiple ladders (Engineering Manager belongs to both the Engineering ladder and the People-Management ladder); a self-pointer can't model that and a typed-edge table needs transitive walks to derive the ladder.
- "Walk up one rung" / "walk down one rung" / "list all peers at this tier" are all single index scans against `by_ladder, [ladderId, rung]` — no graph traversal.
- Future features (salary curve along the ladder, time-to-promotion estimate, "what to learn to climb") naturally extend from `(ladderId, rung)` and would need to be re-derived from edges otherwise.
- Same-tier across ladders ("Senior PM ↔ Senior Engineering Manager ↔ Senior Designer") becomes trivial — query `position.tier === "ic-senior"` across all ladders.

---

## Phased rollout (4 deploys)

The schema is fully additive (new tables, no changes to existing tables) so widen-migrate-narrow isn't needed in the strict sense. But Career Compass is a downstream consumer and a single PR that flips dedup *and* Compass simultaneously is too risky to ship. Phasing isolates blast radius:

- **Phase 1** — Schema + ladder seed + backfill of 140 guides. **Zero behavioural change.** Ships dark.
- **Phase 2** — Ladder-aware dedup in `requestGuideFromSearch`. Career Compass still uses today's embedding logic.
- **Phase 3** — Career Compass uses ladders for Linear / Adjacent / Earlier; transformational lane keeps embedding-based logic for cross-ladder discovery.
- **Phase 4** — Trigger snapshot recompute for all existing users (per the cross-feature impact rule in `CLAUDE.md`).

Each phase is independently shippable. Phase 1 is a no-op product-wise; Phase 2 fixes the reported bug; Phase 3 is the Career Compass re-render; Phase 4 propagates Phase 3 to every user.

---

## Phase 1 — Schema, seed, backfill

### Schema (`convex/schema.ts`)

Two new tables, both additive. No edits to existing tables in this phase.

```ts
career_ladders: defineTable({
  slug: v.string(),                 // "product-management"
  name: v.string(),                 // "Product Management"
  family: v.union(                  // matches profile_enrichments.functionalArea
    v.literal("product"),
    v.literal("engineering"),
    v.literal("design"),
    v.literal("data"),
    v.literal("marketing"),
    v.literal("sales"),
    v.literal("finance"),
    v.literal("legal"),
    v.literal("operations"),
    v.literal("people"),            // HR / talent / L&D
    v.literal("customer-success"),
    v.literal("research"),          // academia / R&D
    v.literal("healthcare"),
    v.literal("education"),
    v.literal("trades"),            // construction, electrical, etc.
    v.literal("creative"),          // writing, music, fine art
    v.literal("other"),             // catch-all; backfill assigns when no clear family
  ),
  description: v.string(),          // 1-sentence description of the ladder's scope
  createdAt: v.number(),
})
.index("by_slug", ["slug"])
.index("by_family", ["family"]);

career_guide_ladder_positions: defineTable({
  ladderId: v.id("career_ladders"),
  guideId:  v.id("career_guides"),
  rung: v.number(),                 // 0-indexed position on the ladder; sortable
  tier: v.union(                    // human-readable altitude — same vocabulary across ladders
    v.literal("ic-entry"),          // Junior X / Associate X / Trainee X
    v.literal("ic-mid"),            // X (plain title)
    v.literal("ic-senior"),         // Senior X / Staff X / Principal X / Lead X (IC)
    v.literal("manager"),           // X Manager (people lead, 3-7 reports)
    v.literal("head"),              // Head of X
    v.literal("director"),          // Director of X
    v.literal("vp"),                // VP of X / Vice President X
    v.literal("c-suite"),           // Chief X Officer / President
  ),
  // Optional: if multiple guides share a tier on the same ladder (e.g. two
  // flavours of "Senior PM"), specialisation distinguishes them.
  specialisation: v.optional(v.string()),
  assignedAt: v.number(),
  assignedBy: v.union(v.literal("backfill-llm"), v.literal("on-demand-llm"), v.literal("manual")),
})
.index("by_ladder", ["ladderId", "rung"])
.index("by_ladder_tier", ["ladderId", "tier"])
.index("by_guide", ["guideId"]);
```

A guide can have multiple `career_guide_ladder_positions` rows (Engineering Manager → Engineering ladder rung "manager" AND People-Management ladder rung "manager"). The `tier` enum is identical across ladders so cross-ladder peer queries are one index scan.

### Ladder seed catalog (`convex/migrations/seed_ladders.ts`)

Hand-curated initial ladder set, kept small and high-confidence. ~16 ladders × 4-7 rungs each. Stored as a TS constant in the migration file, inserted via internalMutation. Examples:

| Ladder | Rungs |
|---|---|
| Product Management | APM (ic-entry) → PM (ic-mid) → Senior PM (ic-senior) → Head of Product (head) → Director of Product (director) → VP Product (vp) → CPO (c-suite) |
| Software Engineering | Junior SWE → SWE → Senior SWE → Staff SWE → Principal SWE → Engineering Manager → Director of Engineering → VP Engineering → CTO |
| Design | Junior Designer → Designer → Senior Designer → Staff Designer → Design Manager → Head of Design → Director of Design → VP Design → CDO |
| Data Science | Data Analyst → Data Scientist → Senior Data Scientist → Staff Data Scientist → Data Science Manager → Head of Data → VP Data → Chief Data Officer |
| ... | (similar for Marketing, Sales, Finance, Legal, Operations, People, Customer Success, Research, Healthcare, Education, Trades, Creative) |

The People-Management ladder is cross-cutting: any X-Manager guide gets a position on both its functional ladder (Engineering Manager → Engineering) AND on People-Management ladder. This is what lets a Senior PM see "Senior Engineering Manager" as an Adjacent option — they're peers on the People-Management ladder at the "manager" tier.

### Backfill (`convex/migrations/backfill_guide_ladder_positions.ts`)

For each of the ~140 existing guides, an LLM classification call (Gemini Flash, structured output via `Output.object({ schema })`) takes the guide's title + first 200 chars of overview + `typicalCareerStage` and returns:

```ts
const LadderAssignmentSchema = z.object({
  primaryLadder: z.object({
    slug: z.string(),       // must match an existing career_ladders.slug
    rung: z.number(),
    tier: z.enum([...]),
    confidence: z.enum(["high", "medium", "low"]),
  }),
  secondaryLadder: z.object({...}).nullable(),  // for cross-cutting guides like X-Manager
  reasoning: z.string(),
});
```

Low-confidence assignments are written to a separate review queue table (`career_guide_ladder_review` — temporary, removed after Phase 1 sign-off) for human verification before insertion into `career_guide_ladder_positions`. High/medium confidence go straight in.

**Cost estimate:** 140 Gemini Flash calls, ~$0.05 total. Re-runnable.

### Files

| File | Change |
|---|---|
| `convex/schema.ts` | Add `career_ladders` and `career_guide_ladder_positions` tables (additive). |
| `convex/careerLadders.ts` *(new)* | CRUD + lookup queries: `getLadderBySlug`, `listLaddersByFamily`, `getPositionByGuide`, `walkUp(ladderId, fromRung)`, `walkDown(ladderId, fromRung)`, `peersAtTier(tier, excludeLadderId)`. |
| `convex/lib/ladders.ts` *(new)* | Pure helpers — tier ordering, rung comparison, etc. (no DB access). |
| `convex/migrations/seed_ladders.ts` *(new)* | One-shot internalMutation that inserts the 16 seed ladders + their rung labels. Idempotent (skip if `slug` already exists). |
| `convex/migrations/backfill_guide_ladder_positions.ts` *(new)* | One-shot internalAction that walks all `career_guides`, calls the LLM classifier, writes positions. Resumable on partial completion (skip guides that already have a position). |
| `lib/ai/prompts/career-ladders.ts` *(new)* | `buildLadderAssignmentPrompt(guide, ladders)` — used by the backfill action and later by on-demand generation. |
| `convex/careerLadders.test.ts` *(new)* | Unit tests for `walkUp` / `walkDown` / `peersAtTier`. |

### Phase 1 verification

- `pnpm test convex/careerLadders.test.ts` — pure-helper tests pass.
- After deploy + seed + backfill: dashboard query `career_guide_ladder_positions` shows ~140-180 rows (some guides have 1 position, X-Manager guides have 2).
- Spot-check: Aqil's seed guides (PM) should be at Product Management ladder, rung `ic-mid`, tier `ic-mid`. Operations Manager should be at Operations ladder, rung `manager`, AND at People-Management ladder, rung `manager`.
- Convex performance audit (`convex-performance-audit` skill): backfill is a one-shot batch action, not a hot path; new indexes are O(1) per lookup. Should pass cleanly.
- Phase 1 is shippable on its own — zero behavioural change to dedup or Compass.

---

## Phase 2 — Ladder-aware dedup

### `requestGuideFromSearch` rewrite (`convex/careerGuides.ts:1695-1737`)

Replace the current Tier-1 (lexical) → Tier-4 (LLM dedup) path with:

1. **Tier-1 lexical** (unchanged): `_findByExactTitle` → return if exact match exists.
2. **NEW Tier-2 ladder lookup**: call `findLadderRungForTitle(title, candidateLadders)` — an LLM classification (Gemini Flash, structured output) that takes the user's title + the list of all ladders + their rung labels, and returns:
   - `{ ladderSlug, rung, tier, isExistingRung: boolean, confidence }`
   - If `confidence === "high"` and `isExistingRung === true` → return the slug of the guide already at that rung (real dedup).
   - If `confidence === "high"` and `isExistingRung === false` → create a new guide AND attach it to the ladder at the suggested rung. The user gets their unique page; the ladder gets a new rung.
   - If `confidence < "high"` → fall through to Tier-3.
3. **Tier-3 LLM dedup** (today's Tier-4, with the rewritten prompt from the earlier plan as a safety net): only runs when ladder lookup is uncertain. With ladders in place, this should fire rarely.
4. **Tier-4 fallback**: `_requestGeneration` — create a new standalone guide (no ladder attachment). Logged for human review (probably a new ladder candidate).

The deterministic leadership-tier guard from the previous plan is no longer needed — ladders make it structural.

### On-demand ladder attachment

When Tier-2 creates a new guide (e.g. user types "Head of Product" → no existing Head-of-Product guide → ladder lookup says Product Management, rung `head`), the same `_requestGeneration` mutation also writes a `career_guide_ladder_positions` row with `assignedBy: "on-demand-llm"`. Atomic in a single mutation.

### Files

| File | Change |
|---|---|
| `convex/careerGuides.ts:1695-1737` | Rewrite `requestGuideFromSearch` to route through ladder lookup before falling back to LLM dedup. |
| `convex/careerGuides.ts` (around `_requestGeneration`) | Extend `_requestGeneration` to optionally accept `ladderAttachment: { ladderId, rung, tier }` and write the position row in the same mutation. |
| `lib/ai/prompts/career-ladders.ts` | Add `buildLadderLookupPrompt(query, ladders)` — separate from the backfill prompt because it gets a single query, not an existing guide. |
| `lib/ai/prompts/career-guides.ts:54-71` | Keep `buildDedupPrompt` for Tier-3 fallback but rewrite per the previous plan (leadership-tier-aware) — this is the safety net for low-confidence ladder lookups. |
| `convex/careerGuides.test.ts` | Add tests for ladder-aware dedup: Head of Product → new guide attached to Product ladder; Senior Software Engineer → existing SWE guide if no Senior SWE rung exists OR new Senior SWE attached if rung is empty; "Engineering Lead" (ambiguous) → falls through to Tier-3. |

### Phase 2 verification

End-to-end on dev backend, before/after table:

| Search query | Today's behaviour | Phase 2 behaviour |
|---|---|---|
| "Product Manager" (exact) | Returns existing `product-manager` (Tier-1) | Same — Tier-1 lexical, unchanged |
| "Head of Product" | **BUG: returns existing `product-manager`** (Tier-4 LLM dedup wrongly collapses) | Creates new `head-of-product`, attaches to Product Management ladder at rung `head` |
| "Director of Engineering" | Likely buggy (similar prompt path) | Creates new `director-of-engineering`, attaches to Engineering ladder at rung `director` |
| "VP Marketing" | Likely buggy | Creates new `vp-marketing`, attaches to Marketing ladder at rung `vp` |
| "CPO" | Currently no match → creates new but disconnected | Creates new `cpo`, attaches to Product Management ladder at rung `c-suite` |
| "Senior Software Engineer" | Returns existing `software-engineer` (good) | Returns existing `software-engineer` (Senior SWE rung doesn't exist as guide → real dedup) — preserves behaviour |
| "Engineering Lead" (ambiguous) | LLM dedup might collapse to wrong thing | Tier-2 ladder lookup low-confidence → falls to Tier-3 dedup → likely creates new guide, no incorrect collapse |

Manual repro: log in as Aqil, navigate to `/career-guides/`, type each query above, confirm the URL after generation matches the "Phase 2 behaviour" column.

`convex-performance-audit` skill: ladder lookup adds 1 LLM call per uncached on-demand request. Acceptable — this surface fires only when a user clicks Generate, not on every page view.

---

## Phase 3 — Career Compass uses ladders

### Lane bucketing rewrite (`convex/discover.ts:741-859`)

Replace the stage-comparison + wholeSim-floor gates with ladder walks:

```ts
// New Step 5: ladder-aware lane bucketing
const userLadderPosition = await ctx.runQuery(
  internal.careerLadders.getPositionByProfile,
  { profileId: args.profileId },
);

if (userLadderPosition) {
  // User is on a known ladder — use ladder-walk for linear/adjacent/earlier.
  const ladderId = userLadderPosition.ladderId;
  const userRung = userLadderPosition.rung;
  const userTier = userLadderPosition.tier;

  for (const c of surviving) {
    const candidatePositions = await readPositions(c.guideId);
    const sameLadderPos = candidatePositions.find((p) => p.ladderId === ladderId);

    if (sameLadderPos) {
      if (sameLadderPos.rung > userRung) byLane.linear.push(c);          // walk up
      else if (sameLadderPos.rung < userRung) byLane.earlier.push(c);    // walk down
      // sameLadderPos.rung === userRung → already on it; skip (it's the user's own role)
    } else {
      const peerPos = candidatePositions.find((p) => p.tier === userTier);
      if (peerPos) byLane.adjacent.push(c);                              // peer at same tier on a different ladder
      else byLane.transformational.push(c);                              // cross-ladder, cross-tier
    }
  }
} else {
  // User is not on a known ladder — fall back to today's embedding-based bucketing
  // (kept as-is from current discover.ts:837-858).
  // ...existing logic...
}
```

The LLM judge step is kept but its remit shrinks — it only adjudicates `transformational` candidates that the embedding pulled in for cross-ladder discovery.

The wholeSim / domainSim / arcSim scores are still computed (Step 2) and persisted on the snapshot — but they're now used only for *ranking within a lane*, not for *gating into a lane*. Strong / bridge / aspirational picks continue to use them; this preserves the ordering UX.

### User-to-ladder mapping (`convex/careerLadders.ts`)

```ts
export const getPositionByProfile = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .first();

    // Strategy: match the user's most-recent role title against ladder positions.
    // The seedingGuideSlugs already point at canonical past roles; the
    // most-recent one with a known ladder position is the user's primary ladder.
    for (const slug of profile?.seedingGuideSlugs ?? []) {
      const guide = await ctx.db.query("career_guides")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!guide) continue;
      const pos = await ctx.db.query("career_guide_ladder_positions")
        .withIndex("by_guide", (q) => q.eq("guideId", guide._id))
        .first();
      if (pos) return { ladderId: pos.ladderId, rung: pos.rung, tier: pos.tier };
    }

    // Fallback: classify the headline against ladders (LLM, cached on profile).
    return null;  // Phase 3 fallback — Phase 4 audit-followup may add LLM headline classification
  },
});
```

For Aqil specifically: `seedingGuideSlugs = ["product-manager"]` → looks up `product-manager` guide → finds its `career_guide_ladder_positions` row at Product Management ladder, rung `ic-mid`. **Then Aqil is a Senior PM, not a PM** — the audit's note about seeding only capturing one role becomes load-bearing here. Until that's fixed, Aqil's "current rung" is misread as `ic-mid` not `ic-senior`. Documented as known limitation; Phase 4 audit-followup includes fixing seeding to capture the user's CURRENT role title (not just past ones), which then pins the right rung.

### Files

| File | Change |
|---|---|
| `convex/discover.ts:741-859` | Ladder-aware bucketing branch with embedding fallback for unmapped users. |
| `convex/discover.ts` (Step 5b) | Judge call only runs for `transformational` candidates (cross-ladder); skipped for ladder-walked candidates because the structural relationship is reliable. |
| `convex/careerLadders.ts` | Add `getPositionByProfile` query (described above). |
| `convex/lib/discoverThresholds.ts` | Keep `LANE_BUDGET` and `ASPIRATIONAL_RERANK_TOP_N` — still used for slot picking. The `LANE_WHOLE_SIM_FLOOR` and `LANE_DOMAIN_SIM_FLOOR` constants get repurposed: only used in the embedding-fallback path (unmapped users) and for the transformational lane's quality gate. |
| `convex/lib/discoverScoring.ts` | Delete dead code: `assignLane()` and the orphaned `LANE_THRESHOLDS` reference (audit P2). The `STAGE_RANK` and `compareStages` functions remain — used by the embedding-fallback path. |
| `convex/discover.test.ts` | Add tests for the ladder-walk path: user on Product ladder at `ic-senior` → snapshot has Head of Product in linear, APM/PM in earlier, Senior Eng Mgr / Senior Designer in adjacent. |

### Phase 3 verification

For Aqil specifically (verify against the audit baseline):

| Lane | Audit baseline (today) | Phase 3 expected |
|---|---|---|
| Linear | **0 cards** | Head of Product, Director of Product, VP Product, CPO (all from Product ladder, rungs > Aqil's) |
| Adjacent | 2 cards (Operations Mgr, Principal ML Eng — accidental peers) | Senior Engineering Mgr, Senior Designer, Senior Data Scientist, Senior Marketing Mgr, etc. (all peers at `ic-senior` tier on adjacent ladders) — assuming the seed catalog has them; if not, falls through to embedding-similarity within lane |
| Earlier | 20 cards (mostly noisy mid-career pivots) | Product Manager, Associate Product Manager (clean walk-down on Product ladder); embedding-similar pivots demoted to transformational |
| Transformational | 20 cards | Cross-ladder/cross-tier candidates (Construction PM, Investment Banker, etc.) — same as today, embedding-driven |

`convex-performance-audit` skill: ladder walks are O(rungs in ladder) ~ 5-10 rows per query, indexed. Should be faster than today's wholeSim sort over 200 candidates for the in-lane decision.

UI quality (`/audit` and `/critique` per `.claude/rules/ui-quality.md`): no UI changes in Phase 3 — the snapshot shape (`discover_canvases.lanes[*].cards[*]`) stays the same. The DiscoverCanvas component reads the same fields, just gets cleaner data.

---

## Phase 4 — Snapshot recompute for all users

Per the cross-feature impact rule in `CLAUDE.md`, any change to the matching pipeline that materially affects what Discover shows requires an explicit recompute plan. Phase 3 is exactly that change.

### Recompute strategy

Full recompute (not incremental) because lane semantics change materially. Use the existing `internal.discover.scheduleSnapshotRegeneration` debounce/dedup machinery (`discover.ts:378-450`) rather than writing new fan-out code:

```ts
// convex/migrations/recompute_all_snapshots_phase4.ts
export const recomputeAll = internalAction({
  handler: async (ctx) => {
    const profiles = await ctx.runQuery(internal.profiles._listAllProfileIds);
    for (const { profileId, userId } of profiles) {
      await ctx.runMutation(internal.discover.scheduleSnapshotRegeneration, {
        profileId,
        userId,
        dedupKey: "phase-4-ladder-recompute",
      });
      // The 30s debounce in scheduleSnapshotRegeneration prevents a thundering herd;
      // intentional pacing keeps the OpenRouter / Cohere / Gemini bills bounded.
    }
  },
});
```

Run via `npx convex run migrations/recompute_all_snapshots_phase4:recomputeAll` after Phase 3 ships to dev/prod. Idempotent — re-running just produces the same snapshots.

### Phase 4 verification

- After recompute: Aqil's `discover_canvases` row has `generatedAt` newer than the audit baseline timestamp, and the lane content matches the Phase 3 expected table above.
- No `discover_canvases` rows stuck in `status: "generating"` after 5 minutes (sweep cron `sweepFailedSnapshots` in `discover.ts:1846` handles stragglers).
- OpenRouter dashboard shows expected token spike during the recompute window, then back to baseline.

---

## Cross-cutting concerns

### Migrations discipline

Per `.claude/rules/convex-patterns.md`: schema changes go through `convex-migration-helper`. This plan's schema additions are purely additive (no field removals, no required fields on existing tables) so widen-migrate-narrow simplifies to "add tables → backfill → use." But the backfill itself benefits from `@convex-dev/migrations` patterns:
- Resumability (skip rows already processed)
- Pagination (don't load all 140 guides into one mutation)
- Status tracking (separate `migration_runs` row to record progress)

Use the migration component skill when writing `backfill_guide_ladder_positions.ts`.

### Deployment previews

Per `.claude/rules/deployment-previews.md`: the additive schema change is shared-backend-safe (no field removals, no breaking changes). PRs share the dev backend (`pleasant-pigeon-988`) per project policy; do NOT spawn a Convex preview backend for this branch. Schema validation in dev catches any typos before Phase 1 hits prod.

### Auth / security

No auth changes. New tables are read by internal queries from Convex actions only; no public queries on `career_ladders` or `career_guide_ladder_positions` until Phase 3 (when the Compass UI reads positions transitively via the snapshot). Even then, no PII; ladder data is curriculum metadata.

### AI SDK usage

All new LLM calls (backfill classifier, ladder lookup, ladder assignment) use the project-standard pattern from `.claude/rules/ai-sdk-patterns.md`:
```ts
const { output } = await generateText({
  model: chatModel(VALIDATION_MODEL_ID, { zdr: true }),
  output: Output.object({ schema }),
  prompt,
});
```
ZDR on by default. Gemini Flash for cost/latency on classification surfaces, Gemini Pro for content generation. No new providers, no embeddings work in this plan.

### Discover impact tracking

Phase 1: no impact. Phase 2: no Discover impact (dedup is generation-side). Phase 3: full impact — handled by Phase 4 recompute. Snapshot schema (`discover_canvases.lanes[*].cards[*]`) is unchanged so the React canvas reads the same shape.

---

## Files summary (all phases)

| File | Phase | Type |
|---|---|---|
| `convex/schema.ts` | 1 | edit (additive) |
| `convex/careerLadders.ts` | 1 (queries), 3 (getPositionByProfile) | new |
| `convex/lib/ladders.ts` | 1 | new |
| `convex/migrations/seed_ladders.ts` | 1 | new |
| `convex/migrations/backfill_guide_ladder_positions.ts` | 1 | new |
| `convex/migrations/recompute_all_snapshots_phase4.ts` | 4 | new |
| `lib/ai/prompts/career-ladders.ts` | 1 (assignment), 2 (lookup) | new |
| `lib/ai/prompts/career-guides.ts` | 2 (rewrite buildDedupPrompt as Tier-3 fallback) | edit |
| `convex/careerGuides.ts:1695-1737` | 2 | edit (rewrite `requestGuideFromSearch`) |
| `convex/careerGuides.ts` (`_requestGeneration`) | 2 | edit (accept ladder attachment) |
| `convex/discover.ts:741-859` | 3 | edit (ladder-walk path + embedding fallback) |
| `convex/discover.ts` (Step 5b judge) | 3 | edit (judge only on transformational) |
| `convex/lib/discoverScoring.ts` | 3 | delete `assignLane` + orphans |
| `convex/lib/discoverThresholds.ts` | 3 | keep `LANE_BUDGET`, `ASPIRATIONAL_RERANK_TOP_N`; `LANE_WHOLE_SIM_FLOOR` repurposed for fallback path |
| `convex/careerLadders.test.ts` | 1 | new |
| `convex/careerGuides.test.ts` | 2 | edit (ladder-aware dedup tests) |
| `convex/discover.test.ts` | 3 | edit (ladder-walk tests) |

---

## Verification (end-to-end, all phases shipped)

1. **Repro the original bug:** before Phase 2, "Head of Product" → redirects to existing `product-manager`. After Phase 2, "Head of Product" → creates `head-of-product` guide, page enters generating state, ladder position written.
2. **Aqil's Compass changes** (after Phase 4): re-load `/workspace/career-compass`. Linear lane no longer empty — shows Head of Product → Director of Product → VP Product → CPO. Earlier lane no longer noisy — shows PM, APM. Adjacent lane shows Senior Eng Mgr, Senior Designer, etc. Transformational keeps cross-ladder pivots.
3. **Regression:** Senior Software Engineer search still dedupes to existing SWE guide (Tier-2 lookup says rung `ic-senior` doesn't exist as a guide → if no Senior SWE guide exists, returns SWE; if it does, returns Senior SWE).
4. **Tests:** `pnpm test` — all new test files pass. Existing `discover.test.ts` and `careerGuides.test.ts` still pass after edits.
5. **Performance:** `convex-performance-audit` skill runs clean on `discover.ts`, `careerGuides.ts`, and `careerLadders.ts`.
6. **UI:** `/audit` and `/critique` runs on `/workspace/career-compass` — no regressions (component unchanged; just better data).
7. **Snapshot recompute (Phase 4):** all `discover_canvases` rows have `generatedAt > <recompute-timestamp>` and `status === "ready"`.
