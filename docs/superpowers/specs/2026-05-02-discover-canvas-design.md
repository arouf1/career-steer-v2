# Discover canvas — design spec

**Date:** 2026-05-02
**Status:** Draft, awaiting user review
**Owner:** Claude (per Operating Principle 1)
**Brainstorm transcript:** captured in conversation; key decisions inlined below

## Mission

Build `/workspace/discover` as the second major workspace surface (after `/workspace/profile`). A user lands on Discover and immediately sees a radial canvas: themselves at the dead-centre, ~18 curated career guides arrayed around them in three lanes — Linear, Adjacent, Transformational — with closer cards representing stronger aspirational matches. The canvas reads as *a map of possible futures*, not a list. A density slider expands the curated set on demand. Reactions (Save / Not for me) feed back into the matching engine so the canvas sharpens with use. Saved guides accumulate in `/workspace/saved-guides` for later action.

This spec also bundles the workspace shell (sidebar via `app/workspace/layout.tsx`) since Discover and Saved guides are the first two pages that need it.

---

## Decisions locked during brainstorming

The brainstorm walked twelve decisions in order. Each is recorded here so the plan's reviewers can see what was considered and what was chosen.

| # | Decision | Choice |
|---|---|---|
| 1 | What populates the canvas | **Career guides only**, lane-classified at render time |
| 2 | Lane classifier + match-strength signal | **Lane = currentStateSim bucketed; match strength = arcSim**. Decoupled axes so a transformational guide can sit very close to the user when their stated arc loves it |
| 3 | Canvas geometry | **Radial wedges (Y-shape).** User dead-centre. Linear at 12 o'clock, Adjacent lower-right (~5 o'clock), Transformational lower-left (~7 o'clock). 60° card-placement arc per lane with 60° empty separators |
| 4 | Density / ranking within a lane | **Curated mix of 6 per lane** (3 strong + 2 bridge + 1 aspirational) = 18 default, with a density slider that adds extra `slotKind: "extra"` cards up to 20/lane = 60 total. Hard `arcSim ≥ 0.30` floor at all slider positions |
| 5 | Card interactions | **Click → expand-in-place preview** (side-rail Sheet on desktop, bottom Dialog on mobile). Save / Not for me reactions feed back into the matching engine |
| 6 | Cold-start | Collapses — workspace requires profile completion. Edge case for thin-result lanes shows a "still finding more for you" ghost row |
| 7 | Mobile | **Lane tabs + vertical lists by default**, with an opt-in "View as canvas" mode for users who want it on mobile |
| 8 | Match-execution architecture | **Precomputed per-user `discover_canvases` snapshot.** Page reads are instant; refresh fires on signal-change triggers |
| 9 | User node design | **Avatar + current-role chip**, sat inside a soft self-ring. Click opens a popover summarising what the algorithm thinks the user is + "Refine your profile →" link |
| 10 | Saved guides destination | **`/workspace/saved-guides`** as its own page in the sidebar |
| 11 | Workspace navigation shell | **Workspace sidebar via `app/workspace/layout.tsx`**, four flat top-level items (Profile / Discover / Saved guides / Career guides), bundled into this spec |
| 12 | First-snapshot trigger | **Eager — generate on profile completion**, with lazy fallback if the user lands on Discover before generation completes |

The brainstorm also confirmed Cohere rerank (via OpenRouter) is used selectively in the matching pipeline — see Section 2 / Step 6c.

---

## 1. Architecture & data model

**The shape.** Discover is a precomputed, per-user snapshot of curated career guides, lane-classified into Linear / Adjacent / Transformational, ranked by aspirational fit, rendered as a radial canvas (desktop) or lane-tabbed lists (mobile). The first snapshot is computed eagerly when a user's profile reaches "complete"; subsequent renders are instant reads from the snapshot, with refresh triggered by signal changes (profile updates, dismissals, manual refresh).

**Three new Convex tables.**

```ts
// convex/schema.ts additions

discover_canvases: defineTable({
  userId: v.id("users"),
  profileId: v.id("profiles"),
  // The profile_embeddings._id this snapshot was computed against.
  // When profile_embeddings is regenerated, we compare ids and recompute.
  profileEmbeddingId: v.id("profile_embeddings"),
  generatedAt: v.number(),
  status: v.union(
    v.literal("generating"),  // background job in flight
    v.literal("ready"),       // safe to render
    v.literal("failed"),      // surfaced inline on the canvas
  ),
  lanes: v.array(v.object({
    kind: v.union(
      v.literal("linear"),
      v.literal("adjacent"),
      v.literal("transformational"),
    ),
    cards: v.array(v.object({
      guideId: v.id("career_guides"),
      slotKind: v.union(
        v.literal("strong"),       // top-3 by arcSim within this lane
        v.literal("bridge"),       // high domainSim, moderate arcSim
        v.literal("aspirational"), // low overall match, high arcSim only
        v.literal("extra"),        // beyond curated mix, surfaced via slider
      ),
      arcScore: v.number(),       // 0..1 — radial distance encoding
      currentStateScore: v.number(),
      domainScore: v.number(),
      wholeScore: v.number(),
      whyMatchReason: v.string(),
    })),
  })),
  failureReason: v.optional(v.string()),
  attempts: v.number(),
})
  .index("by_userId", ["userId"])
  .index("by_status", ["status"]),

// Junction table: one row per (snapshot, guide) pair. Lets the
// careerGuides update fan-out efficiently find users whose current
// snapshot includes a changed guide — by_guideId scan returns the
// affected snapshotId/userId pairs without scanning every snapshot.
// Written/replaced atomically with each discover_canvases write.
discover_snapshot_guides: defineTable({
  snapshotId: v.id("discover_canvases"),
  userId: v.id("users"),
  guideId: v.id("career_guides"),
})
  .index("by_guideId", ["guideId"])
  .index("by_snapshotId", ["snapshotId"]),

discover_reactions: defineTable({
  userId: v.id("users"),
  guideId: v.id("career_guides"),
  reaction: v.union(v.literal("saved"), v.literal("dismissed")),
  reactedAt: v.number(),
})
  .index("by_user_and_guide", ["userId", "guideId"])
  .index("by_user_and_reaction", ["userId", "reaction"]),

// Per-(user, guide) cache for the LLM "why-match" justifications.
// Lifted out of discover_canvases so a snapshot regeneration can reuse
// existing reasons when the underlying (user, guide) pair hasn't changed
// — saves the LLM call cost on most refreshes.
discover_match_reasons: defineTable({
  userId: v.id("users"),
  guideId: v.id("career_guides"),
  profileEmbeddingId: v.id("profile_embeddings"),
  reason: v.string(),
  generatedAt: v.number(),
})
  .index("by_user_and_guide", ["userId", "guideId"]),
```

**Domain file.** All discover logic lives in a new `convex/discover.ts`. Per the project's "one file per domain" convention. Reads may fan into `embeddings.ts` and `careerGuides.ts` helpers but new functions are added to `discover.ts`.

**Why these tables.** `discover_canvases` is the renderable artefact. `discover_reactions` is the feedback signal (read during snapshot regeneration to demote dismissed guides). `discover_match_reasons` is a cache with an independent lifetime — it's the most expensive part to compute (one LLM call per pair) and we want regenerations to reuse reasons when the pair is unchanged. `discover_snapshot_guides` is a thin junction so the careerGuides update fan-out (Section 5a) can find affected users in O(rows-per-changed-guide) instead of O(all snapshots).

**Schema impact.** This is a schema add, not a migration of existing tables. Per `convex-patterns.md`, the addition still goes through `convex-migration-helper`; it's effectively deploy-and-go since there's no backfill.

**Possible dependent change.** If `profile_embeddings` does not currently store the textual arc narrative (the source text for `arcVector`), Step 6c of the matching pipeline will need it as the rerank query string. Verify during plan-writing; if absent, add `arcSourceText: v.optional(v.string())` to `profile_embeddings` and populate during embedding generation. Bundled in this spec if needed.

---

## 2. Matching pipeline

The pipeline runs as a Convex internal action — `discover.internal.generateSnapshot` — and is the heart of the feature.

**Inputs.** `userId`, `profileId`, optional `expectedProfileEmbeddingId` (for concurrency abort). Reads the user's `profile_embeddings` row to get `arcVector`, `currentStateVector`, `domainVector`, `wholeVector` (and `arcSourceText` for rerank).

**Step 1: Candidate retrieval.** Pull the top-K most similar `career_guide_embeddings` by `wholeVector` cosine similarity. K = 200 — well above the 60-card cap so we have room to filter, classify, and curate. Convex doesn't have native vector search yet; until it does, retrieval is a sequential scan in the action. At catalog scale (~1k–10k guides) this is fine. Revisit if/when Convex ships vector indexes or the catalog crosses ~50k guides.

**Step 2: Per-guide facet scoring.** For each candidate, compute four cosine scores against the user's vectors: `arcSim`, `currentStateSim`, `domainSim`, `wholeSim`. All clamped to [0, 1].

**Step 3: Filter by quality floor.** Drop any candidate with `arcSim < 0.30`. Universal floor — even at full slider, sub-floor guides never surface.

**Step 4: Filter by reactions.** Drop guides with `reaction == "dismissed"` for this user from `discover_reactions`. Saved guides are *not* dropped — they get force-included in the appropriate lane.

**Step 5: Lane assignment.** Bucket each remaining candidate by `currentStateSim`:
- `>= 0.70` → linear
- `0.45 ≤ x < 0.70` → adjacent
- `< 0.45` → transformational

Thresholds live as constants in `convex/lib/discoverThresholds.ts`.

**Saved-guide handling at lane assignment.** Saved guides go in their natural (currentStateSim-derived) lane by default, like every other candidate. The override case: if a lane would otherwise be empty (zero candidates passed Steps 3 and 4), and a saved guide exists that didn't naturally land in it, the highest-arcSim such saved guide is reassigned to fill the gap. This prevents the canvas from showing a structurally empty lane purely because the user's profile has narrow currentStateSim coverage. Otherwise saved guides stay in their natural lane.

**Step 6: Per-lane curation (the C-mix).** Within each lane independently:

- **6a — 3 strong-fit slots:** top 3 by `arcSim`.
- **6b — 2 bridge slots:** of remaining candidates, top 2 by `domainSim`, tie-broken by `arcSim`.
- **6c — 1 aspirational slot, with rerank:**
  - Build query string from `profile_embeddings.arcSourceText` (or compose from arc-related profile fields).
  - Take the lane's remaining candidates, cap at top 30 by `arcSim`.
  - `rerank({ query, documents, topN: 1, model: "cohere/rerank-4-pro" })` via the project's `rerank()` helper in `lib/ai/providers.ts`.
  - Use rerank top-1 as the aspirational slot.
  - **Fallback** if rerank fails or returns nothing: pick the candidate with the highest `arcSim - currentStateSim` differential. Candidates entering this step have already passed the 0.30 floor in Step 3.

If a lane has fewer than 6 qualifying candidates, fill what's possible and leave the rest empty (UI shows "still finding more for you").

**Step 7: Slider expansion pool.** Beyond the curated 6, take up to 14 additional candidates per lane (top by `arcSim`), all marked `slotKind: "extra"`. Total per-lane ceiling = 20 = 60 canvas-wide.

**Step 8: Why-match reason generation.** For each card in the final set, fetch from `discover_match_reasons` if a row exists for `(userId, guideId, profileEmbeddingId)`. Cache miss → batch all misses into a single LLM call (Gemini 3.1 Pro via OpenRouter, `Output.object({ schema })` with one reason per card per `ai-sdk-patterns.md`). One sentence per card, ≤ 18 words, second person. Write fresh rows back to `discover_match_reasons`.

**Step 9: Write the snapshot.** Insert (or replace) the user's `discover_canvases` row with `status: "ready"`, the assembled lanes, and the cached reasons embedded per-card. In the same mutation transaction, replace the `discover_snapshot_guides` rows for that snapshotId — delete prior junction rows for the user's previous snapshot and insert one row per `(snapshotId, userId, guideId)` for the new snapshot.

**Concurrency & idempotency.** If `expectedProfileEmbeddingId` no longer matches the user's current `profile_embeddings._id` at write time, abort with `ConvexError("profile-embedding-superseded")` — the trigger that fired this run will already have enqueued a fresher one.

**Latency budget for the full snapshot generation:** target ≤ 8s p50, ≤ 20s p95. The LLM batch dominates; rerank adds ~750ms; everything else is in-process.

**Where the algorithm earns its keep.**
1. Decoupled axes (lane = currentStateSim, distance = arcSim) mean a transformational guide can sit visually close to the user when the arc says so.
2. The aspirational slot's rerank pass surfaces *one card per lane* that's far from who you are but pulling on who you want to become — chosen by a cross-encoder reading guide content against the user's arc narrative, not by vector arithmetic.

---

## 3. Canvas UX

### 3a. Desktop canvas — geometry

**Layout primitives.** React Flow (`@xyflow/react`, latest verified at install time per Operating Principle 2) provides canvas, pan/zoom, viewport math, and node rendering. We do **not** use ELK auto-layout (v1's choice). Layout is fully deterministic: a card's position is a pure function of its lane and `arcScore`, computed once per render in `lib/positionCard.ts`. This keeps the canvas stable across re-renders and lets us encode meaning in geometry instead of letting a force-directed solver shuffle it.

**Coordinate system.** Origin (0, 0) = user node centre. Canvas extends symmetrically to ~±900px. The user node sits dead-centre.

**Lane wedges.** Angles measured CCW from +X in screen coordinates (Y grows downward).
- **Linear** = top wedge: 240°–300° (centred on 270°, "12 o'clock").
- **Adjacent** = lower-right wedge: 0°–60° (centred on 30°, "5 o'clock-ish").
- **Transformational** = lower-left wedge: 120°–180° (centred on 150°, "7 o'clock-ish").

Each wedge spans 60° of card-placement arc with 60° of empty separator between lanes. Empty separators give the eye unambiguous lane boundaries without needing visible dividers.

**Card position formula.**
```
radius = SELF_RING_RADIUS + (1 - arcScore) * (MAX_RADIUS - SELF_RING_RADIUS)
        + slotJitter(slotKind)
angleWithinWedge = wedgeStartAngle + hashJitter(guideId) * wedgeArc
position = { x: radius * cos(angle), y: radius * sin(angle) }
```
- `SELF_RING_RADIUS` = 140px.
- `MAX_RADIUS` = 720px.
- `slotJitter`: strong = +0px, bridge = +15px, aspirational = +35px.
- `hashJitter(guideId)` deterministically spreads cards within a wedge — same guideId → same angle every render. Stops cards from stacking on identical angles and keeps the canvas visually stable across re-renders.

**Collision avoidance.** A simple post-pass: any card overlapping another by ≥ 30% gets nudged to the nearest empty angular slot in its wedge. ~60 cards max → trivial compute.

**Decorative chrome.**
- `<Background>` from React Flow with `gap={24}, size={1}, color="hsl(var(--hairline))"` — quiet dot grid.
- Three soft wedge-fill SVGs *behind* the cards, near-transparent lane tints (linear = neutral, adjacent = warm, transformational = cool — exact tokens decided in `/impeccable shape`).
- Lane labels at outer-edge of each wedge: `LINEAR · NEXT STEPS` / `ADJACENT · LATERAL MOVES` / `TRANSFORMATIONAL · NEW DIRECTIONS`. Type-label scale, positioned at `MAX_RADIUS + 24px`. Each has a small `(?)` info button → popover explaining the lane in one paragraph.
- Soft "self ring" — a 140px-radius dashed circle around the user node.

### 3b. Desktop canvas — components

```
app/workspace/discover/
├── page.tsx                # server component, auth check, prefetch
├── DiscoverCanvas.tsx      # 'use client' — main canvas + ReactFlowProvider
├── CanvasNodes.tsx         # UserNode, GuideCard, LaneLabel custom nodes
├── CardPreviewSheet.tsx    # the click→preview surface
├── DensitySlider.tsx       # the density slider control
├── DiscoverEmptyState.tsx  # "still building your canvas" + thin-lane state
├── DiscoverMobile.tsx      # the mobile lane-tabs surface
└── lib/
    ├── positionCard.ts     # the position formula
    └── snapshotStatus.ts   # tiny client-side status helpers
```

### 3c. Desktop canvas — interactions

**Click `GuideCard` →** opens a side-rail `Sheet` (anchored right, ~480px wide, doesn't close the canvas). Sheet contents:
- Guide title, lane badge, slot badge ("Strong fit" / "Skill bridge" / "Aspirational").
- The cached `whyMatchReason` line, prominent.
- Snippet from `career_guide.content.overview` (~3 sentences).
- 3 typical skills (chips).
- Three actions at the bottom: **Read full guide →** (navigate to `/career-guides/[slug]`), **Save** (lucide Bookmark), **Not for me** (lucide X).
- `Esc` or pane click closes the sheet.

**Save** mutates `discover_reactions` → optimistic UI (amber border + pin icon on the card) → sheet closes → card stays in place.
**Not for me** mutates `discover_reactions` → optimistic UI (~300ms fade) → calls `discover.refillSlot` → next-ranked guide animates in at the same position.
**No reaction yet** = default chrome.

**Hover `GuideCard` (desktop only) →** lightweight tooltip with title + slot badge after 400ms. Touch devices skip and rely on click-preview.

**Click `UserNode` →** popover (shadcn `Popover`) showing avatar, name (Clerk), current role (from profile), "we're matching against" summary (top 3 facets), **Refine your profile →** linking to `/workspace/profile`. Purely a "show me what the algorithm thinks I am" affordance.

**Density slider →** lives in a top-right `Panel` alongside a "Reset view" button (matches v1's Panel placement). Three labelled stops along the track ("Curated 18" / "Show 36" / "Show all 60"). Position persists in `localStorage` keyed `discover.density`. Sliding adds/removes `slotKind: "extra"` cards with a 200ms stagger animation.

**Manual refresh →** a small icon in the top-right Panel ("Refresh canvas"). Triggers `discover.scheduleSnapshotRegeneration({ reason: "manual" })`.

**Zoom & pan.** React Flow defaults: pinch / scroll-wheel zoom (min 0.5×, max 1.6×), drag-to-pan. `nodesDraggable={false}` (cards cannot be manually moved — would break the encoded geometry). `translateExtent` clamps panning to canvas bounds + 240px slack.

### 3d. Mobile (< `md`) — lane tabs

Detected via the `md:` Tailwind breakpoint. Mobile renders `<DiscoverMobile />`, not a CSS-shrunk canvas. Same Convex query, different UI tree.

```
DiscoverMobile
├── Sticky header
│   ├── User avatar (left, 32px) + name (truncate)
│   └── Current-role chip (small, below name)
├── Tab strip (sticky, just below header)
│   ├── Linear · 6
│   ├── Adjacent · 5
│   └── Transformational · 4
├── Active lane = vertical scrollable list of MobileGuideCard
│   - Full-width, ~96px tall, slot badge top-right, match score
│     (0–100, derived from arcScore × 100) bottom-right,
│     whyMatchReason as the visible hook line.
│   - Tap → CardPreviewSheet as a bottom-sheet Dialog (full-height).
│   - Long-press → quick action menu (Save / Not for me) without
│     opening the full sheet.
│   - "Show 4 more" pill at the bottom of each list.
└── Floating "View as canvas" pill (bottom-right, dismissable)
    - Switches to the touch-tuned canvas mode.
    - First-time tap: soft toast "Discover works best on a larger
      screen. Tap the list icon any time to switch back."
    - Preference persisted in localStorage (discover.mobileView).
```

**Touch-tuned canvas mode** (mobile opt-in): same component tree as desktop canvas but with cards scaled to ~140×64, hit targets enlarged via padding, density slider sheet-based instead of inline panel, `minZoom={0.6}`. Acknowledged as a stretch and gated behind opt-in.

### 3e. Animations

- Snapshot first paint: cards fade in with a per-lane stagger (~80ms between cards within a lane, lanes themselves staggered by ~120ms). Total flourish < 1s.
- Save: card border eases to amber (200ms), tiny scale bump (~1.04) and back.
- Dismiss: card fades to 0 opacity + scales to 0.92 (300ms), refill card fades in at the same position (200ms).
- Slider drag: extras fade in/out with their own stagger.
- All animations respect `prefers-reduced-motion` — collapse to 0ms when set.

### 3f. Not building for v1

Canvas-side: cross-lane comparison drag, "compare two cards," programmatic onboarding tour, dragging cards manually, multi-select. All in the follow-ups appendix.

---

## 4. Workspace shell + Saved guides page

### 4a. Workspace shell — `app/workspace/layout.tsx`

New file. Wraps every workspace route in a persistent shadcn `Sidebar` + slim top bar.

```
app/workspace/
├── layout.tsx               # NEW — sidebar shell
├── profile/
│   └── page.tsx             # existing, unchanged
├── discover/
│   ├── page.tsx
│   └── ...                  # canvas components from Section 3
└── saved-guides/
    └── page.tsx
```

**Layout structure.**

```tsx
<SidebarProvider>
  <WorkspaceSidebar />
  <SidebarInset>
    <WorkspaceTopBar />   {/* SidebarTrigger + UserButton + sign out */}
    <main className="flex-1">{children}</main>
  </SidebarInset>
</SidebarProvider>
```

The site-wide `SiteNav` is **suppressed** inside `/workspace/**`. Workspace gets its own chrome (`WorkspaceTopBar`).

**How this is achieved in practice.** The current v2 codebase doesn't render `SiteNav` from any shared layout — it's imported and rendered inline by each public page (`app/page.tsx`, `app/career-guides/page.tsx`, `app/career-guides/[slug]/page.tsx`) and currently also by `app/workspace/profile/page.tsx`. This spec keeps the public pages exactly as they are; the only change is removing the `<SiteNav />` line from `app/workspace/profile/page.tsx` so the new workspace layout's chrome takes over. No root-layout edits needed. Future workspace pages (Discover, Saved guides, and beyond) will *not* import or render `SiteNav` — they inherit the workspace shell automatically via `app/workspace/layout.tsx`.

**`WorkspaceSidebar` — `components/workspace/WorkspaceSidebar.tsx`:**

```tsx
const items = [
  { title: "Profile",       url: "/workspace/profile",      icon: User },
  { title: "Discover",      url: "/workspace/discover",     icon: Compass },
  { title: "Saved guides",  url: "/workspace/saved-guides", icon: Bookmark },
  { title: "Career guides", url: "/career-guides",          icon: BookOpen, external: true },
];
```

- `collapsible="icon"` matches v1.
- Header: `ShipWheel` (or chosen lucide logo) + "Career Steer" wordmark, hidden when collapsed.
- All four items at top level — no collapsible groups for v1. The "Tools" cluster is added later when ≥3 collapse-worthy items exist (Roadmaps / Jobs / CV Studio).
- "Career guides" item links to public `/career-guides`, marked with an `ArrowUpRight` glyph after the label.
- Active state via shadcn's `isActive` prop driven by `usePathname()`.
- Footer: `UserButton` from Clerk, sign-out trigger.
- **No per-item lock chrome.** Workspace is gated upstream by profile completion (Q6).

**Aesthetic tokens.** v2's design language (rounded-pill, hairline borders, font-logo, type-label scale). No new tokens. Run `/impeccable shape` before claiming done.

### 4b. `/workspace/saved-guides`

A focused list page, not a canvas.

```
SavedGuidesPage
├── Page header
│   ├── Title: "Saved guides"
│   ├── Subtitle: "{N} guides you've bookmarked from Discover"
│   └── Sort + filter row (right-aligned)
│       ├── Sort: Recently saved (default) / Lane / Match score when saved
│       └── Filter: All lanes (default) / Linear / Adjacent / Transformational
└── Grid (responsive: 1 col mobile, 2 col md, 3 col lg)
    └── SavedGuideCard
        ├── Lane badge (top-right)
        ├── Match-when-saved score (small, muted)
        ├── Guide title (clickable → /career-guides/[slug])
        ├── Cached whyMatchReason (1 line, italic, muted)
        ├── Saved date (relative: "saved 3 days ago")
        └── Hover/touch action: Remove from saved (X icon, top-right)
```

**Data shape.** `discover.querySavedGuides` joins `discover_reactions` (where `reaction == "saved"`) with `career_guides` (for title/slug) and reads the most recent `discover_canvases` snapshot to backfill `lane` and `whyMatchReason`. If a saved guide isn't in the current snapshot, lane and reason fall back to "—".

**Removing a save** mutates `discover_reactions` (deletes the `"saved"` row). Card animates out (~250ms). No undo bar in v1 — re-save from Discover is cheap.

**Empty state.** Centred prose: "You haven't saved any guides yet. **Discover** career guides matched to you →" with CTA link to `/workspace/discover`. Lucide `Bookmark` icon, large, muted.

**Sort + filter persistence.** localStorage (`savedGuides.sort`, `savedGuides.filter`).

### 4c. Out of scope for v1

Compare two saved guides side-by-side, folders/tags/collections, notes per saved guide, sharing externally, "build a learning plan from these." All in the follow-ups appendix.

---

## 5. Refresh triggers, staleness, and error handling

### 5a. Refresh triggers

All triggers funnel through `discover.internal.scheduleSnapshotRegeneration({ userId, reason })` which dedupes within a 30s debounce window per user.

| Trigger | Source | Behaviour | Dedup key |
|---|---|---|---|
| Profile completion | `profiles.markComplete` mutation | First-snapshot eager generation | `("init", userId)` |
| Profile embedding regenerated | `embeddings.upsertProfileEmbedding` | Full re-rank | `("embedding", userId)` |
| Career guide content materially changes | `careerGuides.updateContent` | Per-card `whyMatchReason` cache invalidation; fan-out only to users whose current snapshot includes this guideId (queried via `discover_snapshot_guides.by_guideId`) | `("guide", guideId)` |
| Career guide embedding regenerated | `careerGuides.regenerateEmbedding` | May shuffle slot or lane; same fan-out as above | `("guide-embed", guideId)` |
| Dismissal reaction | `discover.dismissGuide` | Refill that specific slot only — *not* a full regen | `("refill", userId, lane, slotIndex)` |
| Save reaction | `discover.saveGuide` | No regen — metadata write only | (no trigger) |
| Manual refresh | "Refresh canvas" button | Full regen, cache-bypass for `whyMatchReason` | `("manual", userId)` |
| Embedding model / dimensions change | Deploy-time backfill | All snapshots invalidated en masse | n/a |

### 5b. Staleness model

A snapshot has three states the page handles:

1. **Fresh** — `status: "ready"` and `profileEmbeddingId` matches current. Render normally.
2. **Stale-but-renderable** — `status: "ready"` but `profileEmbeddingId` is older. Render the stale snapshot immediately + show a small toast: "Your profile changed — your canvas is updating in the background." Regen enqueued; page re-renders reactively when it lands.
3. **Generating (no prior snapshot)** — `status: "generating"`. Render the loading skeleton: user node centred, three empty wedges with shimmer placeholders, copy: "Building your discover canvas — this should only take a moment."

**Never block the page on regen if a previous snapshot exists.** A stale canvas is always preferable to a loading state.

### 5c. Error handling

| Failure | Detection | Behaviour |
|---|---|---|
| OpenRouter timeout / 5xx during rerank | `try/catch` in Step 6c | Fall back to `arcSim - currentStateSim` formula. Log via `posthog.capture("discover.rerank_failed")`. Snapshot still completes |
| OpenRouter timeout / 5xx during `whyMatchReason` LLM batch | `try/catch` around batched call | Reasons fall back to deterministic templates: `"Strong fit on {topMatchedSkill}"` / `"Builds on your {topDomainSkill}"` / `"A different direction matched to your aspirations"` |
| Embedding cosine compute error (NaN, dimension mismatch) | Validation pre-pass | Mark snapshot `status: "failed"`, write `failureReason: "embedding-mismatch:{detail}"`, increment `attempts`. Page renders inline error: "We couldn't build your canvas. [Try again]" |
| Profile embedding superseded mid-run | `ConvexError("profile-embedding-superseded")` caught by scheduler | Treat as success (fresher run already in flight). No failed snapshot written |
| All retries exhausted (`attempts >= 3`) | Scheduler increments | Surface as `status: "failed"` with help-link CTA. Cron sweeps `failed` rows > 24h old, re-attempts nightly |

**Frontend resilience.**
- Convex query subscription handles snapshot transitions reactively — no manual polling.
- Save / Not for me are **optimistic** with revert-on-failure and toast.
- `CardPreviewSheet` is `Suspense`-bounded.
- React Flow wrapped in `<ErrorBoundary fallback={<DiscoverErrorState />}>` — a single-card render bug never breaks the whole canvas.

### 5d. Auth & access

Every Convex function in `discover.ts` starts with `await ctx.auth.getUserIdentity()`, resolves to `userId` via standard `users` lookup. Per `auth-security.md` and `convex-patterns.md`. No `internal*` exposed to client.

Defensive `null` check on `profile_embeddings`: if the row doesn't exist (race with profile-completion trigger), fail with `ConvexError("profile-not-ready")`.

### 5e. Performance budgets

- **Snapshot read query** (page load): p50 < 80ms, p95 < 200ms.
- **Snapshot generation** (background): p50 < 8s, p95 < 20s.
- **`refillSlot` after dismissal**: p50 < 1s.

`convex-performance-audit` runs at verification (Section 6).

---

## 6. Testing, scope confirmation, open items

### 6a. Testing

**Convex function tests (`convex/discover.test.ts`)** — `convex-test` harness, no mocking per project rule:
- Lane assignment correctness at threshold boundaries (just-above, just-below, exact-on for 0.45 and 0.70).
- Curated mix slot allocation (exact 3 strong + 2 bridge + 1 aspirational from a fixed candidate set).
- Aspirational formula correctness with rerank stub returning known result.
- Quality floor (`arcSim < 0.30` never appears, even at full slider).
- Dismissal exclusion.
- Save force-include.
- Empty-lane graceful degrade.
- Concurrency abort with mismatched `expectedProfileEmbeddingId`.

**Component tests** — Vitest + RTL. `positionCard.ts` unit tests (boundary angles, radius bounds, deterministic jitter, collision avoidance). One happy-path render test for `DiscoverCanvas` (snapshot loaded → 18 cards in correct lane positions). One stale-state test (renders cards + toast).

**E2E (Playwright, `e2e/discover.spec.ts`)** — single golden path:
- Sign in as seeded user with complete profile + precomputed snapshot.
- Land on `/workspace/discover`.
- Assert: user node renders, three lane labels visible, ≥ 1 card per lane, density slider present.
- Click a card → preview sheet opens.
- Click "Save" → card border amber, sheet closes.
- Navigate to `/workspace/saved-guides` → saved card appears.
- Switch viewport to 375×667 → mobile lane-tabs render.

**Manual verification gates.**
- `convex-performance-audit` after matching pipeline implementation.
- `/audit` on the discover canvas component before claiming done.
- `/critique` on first visual pass.

**Not testing.** Visual regression on the canvas (deterministic but font-sensitive); cross-browser deep testing (Chromium happy path is sufficient); load testing the snapshot generation (catalog still small).

### 6b. Scope confirmation

**In scope:**
- Four new Convex tables + indexes (`discover_canvases`, `discover_reactions`, `discover_match_reasons`, `discover_snapshot_guides`).
- `convex/discover.ts` with queries, mutations, internal actions.
- Cron sweep for `failed`-status snapshots > 24h.
- `app/workspace/layout.tsx` + `WorkspaceSidebar` + `WorkspaceTopBar`.
- Remove the inline `<SiteNav />` line from `app/workspace/profile/page.tsx`. Public pages keep their inline `SiteNav` unchanged.
- `app/workspace/discover/` — page + canvas components.
- `app/workspace/saved-guides/page.tsx` + `SavedGuideCard`.
- One conditional dependent change: `profile_embeddings.arcSourceText` if not present.
- shadcn primitives: Sidebar (if not already installed), Sheet, Slider, Popover, Tabs.
- `@xyflow/react` install (latest verified at install).

**Out of scope.** See follow-ups appendix below; these are deliberately deferred and tracked in `memory/project_discover_followups.md` for cross-session retrieval.

### 6c. Open items locked by judgement — flag in spec review if you disagree

- Slider position persistence in `localStorage` (vs server-side per-user). LocalStorage is faster, lighter; loses cross-device. Acceptable for a slider.
- Saved-guides sort default = "Recently saved." Other valid: "Match score when saved." Picked recency for time-anchored familiarity.
- No undo bar on remove-from-saved. Re-save from Discover is cheap.
- Sidebar collapsed-by-default vs expanded-by-default → went with shadcn default (expanded on first paint, hover-to-expand-on-collapsed-rail like v1).
- "Career guides" sidebar item linking out to public `/career-guides` → kept it; alternative is to drop since it's accessible from public site nav.
- "Manual refresh" affordance on the canvas — included in v1; flag if you want fast-follow.

---

## Appendix: Follow-up features

Mirrors `memory/project_discover_followups.md` — append both files when new ideas surface.

### Canvas UX deferrals
- Cross-lane comparison drag (drag a card between lanes to ask "where does this really belong?").
- Compare two cards (multi-select → side-by-side).
- Programmatic first-time tour / coachmark sequence.
- Manual card dragging (gated behind a "free placement" toggle).
- Multi-select on canvas (lasso-select for bulk save / dismiss / compare).
- "What changed since your last visit" highlight on next-after-regen.
- Why-match transparency overlay (show the four facet scores per card on demand).

### Saved guides deferrals
- Compare two saved guides side-by-side.
- Folders / tags / collections.
- Notes per saved guide.
- Sharing externally (public link, PDF, email).
- "Build a learning plan from these" across N saved guides.

### Algorithm & ranking
- Rerank for all slot picks, not just aspirational (cost-tradeoff to evaluate with real data).
- A/B test rerank vs no-rerank on aspirational slot.
- Threshold tuning UI for lane assignment.
- Editorial taxonomy for cold-start canvas (only if Discover ever surfaces pre-completion).
- Vector search via Convex native indexes when shipped.
- Dismissal expiry / "give it another look" rule.

### Mobile
- Proper touch-tuned mobile canvas (Q7 option C — single-lane focused with swipe).

### Cross-feature integrations
- Saved guides → Jobs (filter listings to a saved guide).
- Saved guides → Skill gaps (compute skills needed to bridge to saved set).
- Saved guides → Roadmaps (when Roadmaps lands, seed from saved).
- Periodic "your discover canvas refreshed" notification.
- Discover canvas as marketing surface (logged-out teaser).
- Share your discover canvas externally (screenshot or `/discover/[shareId]` read-only).

### Operational
- Snapshot version history (keep N most recent for diffing + analytics).
- Snapshot regeneration analytics (avg gen time, rerank failure rate, cache hit rate).
