# Career guide → jobs plug — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-06-career-guide-jobs-plug-design.md`

**Goal:** Mount a "Jobs hiring [Title]" module at the bottom of every career guide page, location-ranked, with a LinkedIn-style sign-in tease for anonymous viewers and a rate-limited live-search trigger for signed-in users.

**Architecture:** The guide ↔ jobs link is the existing `roleArchetypeSlug` field on `job_postings`. A new `convex/jobsForGuide.ts` module exposes a single `forGuide` query that pulls active candidates by archetype slug, applies a 3-rung location ladder (50 km radius → country → anywhere) using Haversine over a newly denormalized `gps` field, and returns viewer-state-aware card data. A separate `fitScores` query and rate-limited `searchLive` action serve signed-in users only. UI is a small set of new React components mounted between `<CareerGuideArticle />` and `<RelatedGuides />` in `app/career-guides/[slug]/page.tsx`.

**Tech Stack:** Next.js App Router (Server Components for the page, Client for the orchestrator), Convex (queries / actions / migrations), Clerk (auth state), shadcn/ui (Card, Skeleton, Button), lucide-react (icons), Tailwind CSS, Vitest + convex-test for testing.

**Spec deviations (decided during plan-writing):**

1. The spec proposed a new `job_search_quotas` table. The existing `rate_limits` table + `tryConsumeRateLimit` helper at `convex/lib/rateLimit.ts:13` already cover this. Plan uses that instead. No new table.
2. The spec said "extract `_loadFitScores` body to `convex/lib/jobFit.ts`". The math (`cosineSim`) is already extracted at `convex/lib/discoverScoring.ts:4`. Only the *data-fetch* portion (user lookup → profile embedding → job embeddings) needs extracting; the tier classification is a thin wrapper using existing `cosineSim`.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `convex/lib/haversine.ts` | Pure: great-circle distance between two `(lat, lon)` points in km. |
| `convex/lib/haversine.test.ts` | Unit tests for Haversine, including known fixtures and antipodal/equator edge cases. |
| `convex/lib/locationLadder.ts` | Pure: pick first non-empty rung (radius/country/anywhere), return `{ picked, ladderHit }`. |
| `convex/lib/locationLadder.test.ts` | Unit tests for ladder selection across viewer-geo permutations. |
| `convex/lib/jobFit.ts` | Pure-ish: `loadProfileAndJobVectors(ctx, tokenIdentifier, jobIds)` data fetch. |
| `convex/lib/jobFit.test.ts` | Integration test via `convex-test`. |
| `convex/jobsForGuide.ts` | New domain module — `forGuide` query, `fitScores` query, `searchLive` action, `_archetypeFromGuideSlug` helper. |
| `convex/jobsForGuide.test.ts` | Integration tests for the public surface via `convex-test`. |
| `convex/migrations/2026_05_06_jobPostings_gps.ts` | Backfill action for `gps` denormalization. |
| `components/career-guides/JobsForGuide.tsx` | Orchestrator — reads Clerk + profile, calls Convex queries, picks viewer state. |
| `components/career-guides/JobsForGuideCard.tsx` | Single card — viewerState-aware (real / blurred / locked-fit). |
| `components/career-guides/JobsForGuideEmpty.tsx` | Empty-state stub card with sign-in or live-search CTA. |
| `components/career-guides/JobsForGuideTeaseLock.tsx` | Blurred-stack overlay with in-place sign-in CTA for anonymous viewers. |
| `lib/jobs/microcopy.ts` | Pure: ladder-hit + city → microcopy string ("3 in London" vs "3 within 50 km of London"). |
| `lib/jobs/microcopy.test.ts` | Unit tests for microcopy variants. |

### Modified files

| Path | Change |
|---|---|
| `convex/schema.ts` | Add `gps` (optional first, then required) to `job_postings`; add new compound index `by_roleArchetypeSlug_isActive_lastSeenAt`. |
| `convex/jobPostings.ts` | `upsertFromSearch` (line 385) writes `gps` when `citySlug` resolves; export `_archetypeFromGuideSlug` helper. |
| `convex/jobSearch.ts` | `_loadFitScores` (line 204) refactored to use `loadProfileAndJobVectors` from `convex/lib/jobFit.ts`. |
| `convex/profiles.ts` | New public query `resolvedLocation` returns `{ lat, lon, countryCode } \| null`. |
| `app/career-guides/[slug]/page.tsx` | Extract anonymous geo helper; mount `<JobsForGuide />` between `<CareerGuideArticle />` and `<RelatedGuides />`. |

---

## Phase 1 — Pure helpers (no Convex, fully unit-testable)

### Task 1: Haversine helper

**Files:**
- Create: `convex/lib/haversine.ts`
- Test: `convex/lib/haversine.test.ts`

- [ ] **Step 1.1: Write failing tests**

```ts
// convex/lib/haversine.test.ts
import { describe, it, expect } from "vitest";
import { haversineKm } from "./haversine";

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(51.5074, -0.1278, 51.5074, -0.1278)).toBeCloseTo(0, 6);
  });

  it("computes London → Paris within 1km of 344km", () => {
    // Reference: ~344 km great-circle distance
    const d = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(343);
    expect(d).toBeLessThan(345);
  });

  it("computes London → New York within 5km of 5570km", () => {
    const d = haversineKm(51.5074, -0.1278, 40.7128, -74.006);
    expect(d).toBeGreaterThan(5565);
    expect(d).toBeLessThan(5575);
  });

  it("handles antipodal points symmetrically", () => {
    const a = haversineKm(0, 0, 0, 180);
    const b = haversineKm(0, 180, 0, 0);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeGreaterThan(20015); // half of Earth's circumference
    expect(a).toBeLessThan(20020);
  });

  it("handles equator + cross-180 longitude", () => {
    const d = haversineKm(0, 179, 0, -179);
    expect(d).toBeGreaterThan(220);
    expect(d).toBeLessThan(225);
  });
});
```

- [ ] **Step 1.2: Run tests, verify they fail**

Run: `pnpm test convex/lib/haversine.test.ts`
Expected: FAIL with "Cannot find module './haversine'".

- [ ] **Step 1.3: Implement Haversine**

```ts
// convex/lib/haversine.ts
const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return EARTH_RADIUS_KM * c;
}
```

- [ ] **Step 1.4: Run tests, verify they pass**

Run: `pnpm test convex/lib/haversine.test.ts`
Expected: 5 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add convex/lib/haversine.ts convex/lib/haversine.test.ts
git commit -m "feat(jobs): add Haversine distance helper for guide→jobs ladder"
```

---

### Task 2: Location ladder helper

**Files:**
- Create: `convex/lib/locationLadder.ts`
- Test: `convex/lib/locationLadder.test.ts`

- [ ] **Step 2.1: Write failing tests**

```ts
// convex/lib/locationLadder.test.ts
import { describe, it, expect } from "vitest";
import { applyLocationLadder, type LadderCandidate } from "./locationLadder";

const job = (
  id: string,
  lat: number,
  lon: number,
  countryCode: string | undefined,
  lastSeenAt: number,
  citySlug = "x",
): LadderCandidate => ({
  _id: id as any,
  gps: { lat, lon },
  countryCode,
  lastSeenAt,
  citySlug,
});

describe("applyLocationLadder", () => {
  it("returns radius rung when ≥1 candidate within 50km, sorted by distance", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" }; // London
    const cands = [
      job("a", 51.5074, -0.1278, "gb", 1), // 0 km
      job("b", 51.5556, -0.2796, "gb", 2), // ~12 km (Wembley)
      job("c", 48.8566, 2.3522, "fr", 3), // 344 km (Paris)
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("radius");
    expect(result.picked.map((p) => p._id)).toEqual(["a", "b"]);
  });

  it("falls through to country rung when no candidate within radius", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" };
    const cands = [
      job("a", 53.4808, -2.2426, "gb", 100), // Manchester ~262 km
      job("b", 55.9533, -3.1883, "gb", 200), // Edinburgh ~534 km
      job("c", 48.8566, 2.3522, "fr", 300), // Paris
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("country");
    // Country rung sorts by lastSeenAt desc
    expect(result.picked.map((p) => p._id)).toEqual(["b", "a"]);
  });

  it("falls through to anywhere when no country match", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" };
    const cands = [
      job("a", 48.8566, 2.3522, "fr", 1),
      job("b", 40.7128, -74.006, "us", 2),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("anywhere");
    expect(result.picked.map((p) => p._id)).toEqual(["b", "a"]);
  });

  it("skips radius rung when viewer has no lat/lon", () => {
    const viewer = { countryCode: "gb" };
    const cands = [
      job("a", 51.5074, -0.1278, "gb", 1),
      job("b", 48.8566, 2.3522, "fr", 2),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("country");
    expect(result.picked.map((p) => p._id)).toEqual(["a"]);
  });

  it("skips country rung when viewer has no countryCode", () => {
    const viewer = {};
    const cands = [
      job("a", 51.5074, -0.1278, "gb", 1),
      job("b", 48.8566, 2.3522, "fr", 2),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("anywhere");
    expect(result.picked.map((p) => p._id)).toEqual(["b", "a"]);
  });

  it("respects limit", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" };
    const cands = Array.from({ length: 10 }, (_, i) =>
      job(`j${i}`, 51.5 + i * 0.001, -0.13, "gb", i),
    );
    const result = applyLocationLadder(cands, viewer, 3, 50);
    expect(result.picked).toHaveLength(3);
  });

  it("excludes candidates without gps from radius rung", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" };
    const cands: LadderCandidate[] = [
      { ...job("a", 51.5074, -0.1278, "gb", 1), gps: undefined },
      job("b", 51.5556, -0.2796, "gb", 2),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("radius");
    expect(result.picked.map((p) => p._id)).toEqual(["b"]);
  });
});
```

- [ ] **Step 2.2: Run tests, verify they fail**

Run: `pnpm test convex/lib/locationLadder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement ladder**

```ts
// convex/lib/locationLadder.ts
import { haversineKm } from "./haversine";
import type { Id } from "../_generated/dataModel";

export type LadderCandidate = {
  _id: Id<"job_postings">;
  gps?: { lat: number; lon: number };
  countryCode?: string;
  lastSeenAt: number;
  citySlug?: string;
};

export type LadderViewer = {
  lat?: number;
  lon?: number;
  countryCode?: string;
};

export type LadderHit = "radius" | "country" | "anywhere";

export type LadderResult<T extends LadderCandidate> = {
  picked: T[];
  ladderHit: LadderHit;
};

export function applyLocationLadder<T extends LadderCandidate>(
  candidates: T[],
  viewer: LadderViewer,
  limit: number,
  radiusKm: number,
): LadderResult<T> {
  // Rung 1: radius — only when viewer has coords
  if (viewer.lat !== undefined && viewer.lon !== undefined) {
    const within = candidates
      .filter((c) => c.gps !== undefined)
      .map((c) => ({
        c,
        d: haversineKm(viewer.lat!, viewer.lon!, c.gps!.lat, c.gps!.lon),
      }))
      .filter((x) => x.d <= radiusKm)
      .sort((a, b) => a.d - b.d);

    if (within.length > 0) {
      return {
        picked: within.slice(0, limit).map((x) => x.c),
        ladderHit: "radius",
      };
    }
  }

  // Rung 2: country — only when viewer has countryCode
  if (viewer.countryCode) {
    const sameCountry = candidates
      .filter((c) => c.countryCode === viewer.countryCode)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);

    if (sameCountry.length > 0) {
      return {
        picked: sameCountry.slice(0, limit),
        ladderHit: "country",
      };
    }
  }

  // Rung 3: anywhere
  const anywhere = [...candidates].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return {
    picked: anywhere.slice(0, limit),
    ladderHit: "anywhere",
  };
}
```

- [ ] **Step 2.4: Run tests, verify they pass**

Run: `pnpm test convex/lib/locationLadder.test.ts`
Expected: 7 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add convex/lib/locationLadder.ts convex/lib/locationLadder.test.ts
git commit -m "feat(jobs): add location-ladder helper for guide→jobs proximity ranking"
```

---

### Task 3: Microcopy helper

**Files:**
- Create: `lib/jobs/microcopy.ts`
- Test: `lib/jobs/microcopy.test.ts`

- [ ] **Step 3.1: Write failing tests**

```ts
// lib/jobs/microcopy.test.ts
import { describe, it, expect } from "vitest";
import { describeLadderHit } from "./microcopy";

describe("describeLadderHit", () => {
  it("returns city-only label when all picked share the closest citySlug", () => {
    const result = describeLadderHit({
      ladderHit: "radius",
      pickedCitySlugs: ["london", "london", "london"],
      viewerCityLabel: "London",
      viewerCountryLabel: "the UK",
      total: 3,
    });
    expect(result).toBe("3 in London");
  });

  it("returns radius label when picked cards span multiple cities", () => {
    const result = describeLadderHit({
      ladderHit: "radius",
      pickedCitySlugs: ["london", "slough", "london"],
      viewerCityLabel: "London",
      viewerCountryLabel: "the UK",
      total: 3,
    });
    expect(result).toBe("3 within 50 km of London");
  });

  it("falls back to country label when no viewer city", () => {
    const result = describeLadderHit({
      ladderHit: "radius",
      pickedCitySlugs: ["london"],
      viewerCityLabel: undefined,
      viewerCountryLabel: "the UK",
      total: 1,
    });
    expect(result).toBe("1 nearby");
  });

  it("returns country label for country rung", () => {
    const result = describeLadderHit({
      ladderHit: "country",
      pickedCitySlugs: ["london", "manchester"],
      viewerCityLabel: "London",
      viewerCountryLabel: "the UK",
      total: 8,
    });
    expect(result).toBe("8 in the UK");
  });

  it("returns global label for anywhere rung", () => {
    const result = describeLadderHit({
      ladderHit: "anywhere",
      pickedCitySlugs: ["nyc"],
      viewerCityLabel: undefined,
      viewerCountryLabel: undefined,
      total: 12,
    });
    expect(result).toBe("12 globally");
  });

  it("singularizes for total === 1", () => {
    const result = describeLadderHit({
      ladderHit: "country",
      pickedCitySlugs: ["london"],
      viewerCityLabel: "London",
      viewerCountryLabel: "the UK",
      total: 1,
    });
    expect(result).toBe("1 in the UK");
  });
});
```

- [ ] **Step 3.2: Run tests, verify they fail**

Run: `pnpm test lib/jobs/microcopy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement microcopy**

```ts
// lib/jobs/microcopy.ts
export type DescribeLadderHitArgs = {
  ladderHit: "radius" | "country" | "anywhere";
  pickedCitySlugs: Array<string | undefined>;
  viewerCityLabel: string | undefined;
  viewerCountryLabel: string | undefined;
  total: number;
};

export function describeLadderHit(args: DescribeLadderHitArgs): string {
  const { ladderHit, pickedCitySlugs, viewerCityLabel, viewerCountryLabel, total } = args;

  if (ladderHit === "radius") {
    const first = pickedCitySlugs[0];
    const allSameCity =
      first !== undefined &&
      pickedCitySlugs.every((s) => s === first);

    if (viewerCityLabel) {
      return allSameCity
        ? `${total} in ${viewerCityLabel}`
        : `${total} within 50 km of ${viewerCityLabel}`;
    }
    return `${total} nearby`;
  }

  if (ladderHit === "country") {
    return viewerCountryLabel ? `${total} in ${viewerCountryLabel}` : `${total} available`;
  }

  return `${total} globally`;
}
```

- [ ] **Step 3.4: Run tests, verify they pass**

Run: `pnpm test lib/jobs/microcopy.test.ts`
Expected: 6 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add lib/jobs/microcopy.ts lib/jobs/microcopy.test.ts
git commit -m "feat(jobs): add microcopy helper for ladder-hit labels"
```

---

### Task 4: Extract `loadProfileAndJobVectors` data-fetch helper

The existing `_loadFitScores` internalQuery in `convex/jobSearch.ts:204` does:
1. Look up user by `tokenIdentifier`.
2. Fetch the user's `profile_embeddings` row.
3. For each `jobPostingId`, fetch its `job_posting_embeddings` row.
4. Return `{ profileVector, jobVectors } | null`.

This is the data-fetch shape we want to share with the new public `fitScores` query.

**Files:**
- Create: `convex/lib/jobFit.ts`
- Test: `convex/lib/jobFit.test.ts`
- Modify: `convex/jobSearch.ts` (refactor `_loadFitScores` to call the helper)

- [ ] **Step 4.1: Write the helper (no tests yet — it's a thin extraction)**

```ts
// convex/lib/jobFit.ts
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type ProfileAndJobVectors = {
  profileVector: number[];
  jobVectors: Array<{
    jobPostingId: Id<"job_postings">;
    vector: number[];
  }>;
};

export async function loadProfileAndJobVectors(
  ctx: QueryCtx,
  tokenIdentifier: string,
  jobPostingIds: ReadonlyArray<Id<"job_postings">>,
): Promise<ProfileAndJobVectors | null> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
  if (!user) return null;

  const profileEmbedding = await ctx.db
    .query("profile_embeddings")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .unique();
  if (!profileEmbedding) return null;

  const jobVectors: ProfileAndJobVectors["jobVectors"] = [];
  for (const jobPostingId of jobPostingIds) {
    const e = await ctx.db
      .query("job_posting_embeddings")
      .withIndex("by_jobPostingId", (q) => q.eq("jobPostingId", jobPostingId))
      .unique();
    if (e) {
      jobVectors.push({ jobPostingId, vector: e.wholeVector });
    }
  }

  return { profileVector: profileEmbedding.wholeVector, jobVectors };
}
```

- [ ] **Step 4.2: Refactor `_loadFitScores` to use the helper**

Read `convex/jobSearch.ts` lines 200–260. Replace the body of `_loadFitScores` with a call to `loadProfileAndJobVectors`.

```ts
// convex/jobSearch.ts (replace lines 204–257)
import { loadProfileAndJobVectors } from "./lib/jobFit";

export const _loadFitScores = internalQuery({
  args: {
    jobPostingIds: v.array(v.id("job_postings")),
    tokenIdentifier: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      profileVector: v.array(v.float64()),
      jobVectors: v.array(
        v.object({
          jobPostingId: v.id("job_postings"),
          vector: v.array(v.float64()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    return await loadProfileAndJobVectors(
      ctx,
      args.tokenIdentifier,
      args.jobPostingIds,
    );
  },
});
```

- [ ] **Step 4.3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 4.4: Run existing test suites that touch `_loadFitScores`**

Run: `pnpm test`
Expected: all existing tests pass — refactor is behavior-preserving.

- [ ] **Step 4.5: Commit**

```bash
git add convex/lib/jobFit.ts convex/jobSearch.ts
git commit -m "refactor(jobs): extract loadProfileAndJobVectors for cross-query reuse"
```

---

## Phase 2 — Schema migrations (via `convex-migration-helper`)

Three additive schema changes: a new compound index, a new optional field with backfill, and reuse of the existing `rate_limits` table (no schema change). Each migration step deploys before the code that depends on it (`convex-migration-helper` discipline).

### Task 5: Add compound index `by_roleArchetypeSlug_isActive_lastSeenAt`

**Files:**
- Modify: `convex/schema.ts` (add index on `job_postings`)

- [ ] **Step 5.1: Invoke `convex-migration-helper` skill**

This is an additive index — pure widen, no narrow phase. The skill will guide through the deploy.

Trigger: pass to the skill the change description "Add compound index `by_roleArchetypeSlug_isActive_lastSeenAt` on `job_postings` over fields `['roleArchetypeSlug', 'isActive', 'lastSeenAt']`. Required for the new `forGuide` query in the career-guide → jobs plug feature."

- [ ] **Step 5.2: Add index in `convex/schema.ts`**

Locate the `job_postings: defineTable({...})...` block in `convex/schema.ts`. Add the index alongside the existing ones:

```ts
.index("by_roleArchetypeSlug_isActive_lastSeenAt", [
  "roleArchetypeSlug",
  "isActive",
  "lastSeenAt",
])
```

- [ ] **Step 5.3: Deploy schema (dev backend)**

Run: `pnpm exec convex dev --once`
Expected: schema validation passes; new index reported as added.

- [ ] **Step 5.4: Verify index is queryable in dashboard**

Open https://dashboard.convex.dev → `pleasant-pigeon-988` → Data → `job_postings` → Indexes. Confirm `by_roleArchetypeSlug_isActive_lastSeenAt` is listed.

- [ ] **Step 5.5: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(jobs): add by_roleArchetypeSlug_isActive_lastSeenAt index for guide→jobs query"
```

---

### Task 6: Widen `gps` on `job_postings` (optional first)

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 6.1: Add optional `gps` field**

In `convex/schema.ts`, add to the `job_postings` table:

```ts
gps: v.optional(v.object({ lat: v.number(), lon: v.number() })),
```

- [ ] **Step 6.2: Deploy schema**

Run: `pnpm exec convex dev --once`
Expected: existing rows accept the widened schema (optional means missing is allowed).

- [ ] **Step 6.3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(jobs): widen job_postings to accept optional gps"
```

---

### Task 7: Backfill `gps` from `locations`

The backfill resolves each `job_postings` row's `(citySlug, countryCode)` to a `locations` row of `targetType: "City"`, then copies `gps`. Pages through the table to stay under per-mutation limits.

**Files:**
- Create: `convex/migrations/2026_05_06_jobPostings_gps.ts`

- [ ] **Step 7.1: Write the migration action**

```ts
// convex/migrations/2026_05_06_jobPostings_gps.ts
import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

const PAGE_SIZE = 200;

export const _backfillPage = internalMutation({
  args: { cursor: v.union(v.null(), v.string()) },
  returns: v.object({
    nextCursor: v.union(v.null(), v.string()),
    patched: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("job_postings")
      .withIndex("by_isActive_lastSeenAt")
      .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });

    let patched = 0;
    let skipped = 0;

    for (const job of page.page) {
      if (job.gps) {
        skipped++;
        continue;
      }
      if (!job.citySlug) {
        skipped++;
        continue;
      }
      const cityName = job.city?.toLowerCase();
      if (!cityName) {
        skipped++;
        continue;
      }

      // Resolve to a City row in same country (or any country if missing)
      const candidates = await ctx.db
        .query("locations")
        .withIndex("by_target_nameLower", (q) =>
          q.eq("targetType", "City").eq("nameLower", cityName),
        )
        .take(20);

      const match = job.countryCode
        ? candidates.find((l) => l.countryCode.toLowerCase() === job.countryCode!.toLowerCase())
        : candidates[0];

      if (!match) {
        skipped++;
        continue;
      }

      await ctx.db.patch(job._id, {
        gps: { lat: match.gps.lat, lon: match.gps.lon },
      });
      patched++;
    }

    return {
      nextCursor: page.isDone ? null : page.continueCursor,
      patched,
      skipped,
    };
  },
});

export const runBackfill = internalAction({
  args: {},
  returns: v.object({ totalPatched: v.number(), totalSkipped: v.number() }),
  handler: async (ctx) => {
    let cursor: string | null = null;
    let totalPatched = 0;
    let totalSkipped = 0;
    while (true) {
      const result: { nextCursor: string | null; patched: number; skipped: number } =
        await ctx.runMutation(internal.migrations["2026_05_06_jobPostings_gps"]._backfillPage, {
          cursor,
        });
      totalPatched += result.patched;
      totalSkipped += result.skipped;
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    return { totalPatched, totalSkipped };
  },
});
```

- [ ] **Step 7.2: Type-check + push**

Run: `pnpm exec convex dev --once`
Expected: clean.

- [ ] **Step 7.3: Run the backfill on dev**

Run: `pnpm exec convex run --no-push 'migrations/2026_05_06_jobPostings_gps:runBackfill' '{}'`
Expected: prints `{ totalPatched: N, totalSkipped: M }`. Note the numbers.

- [ ] **Step 7.4: Verify coverage**

Run a Convex dashboard query or a one-off internal query in another file (or use the dashboard's query runner):

```ts
// throwaway: paste into dashboard's run-once query box
const all = await ctx.db.query("job_postings").collect();
const withGps = all.filter((j) => j.gps !== undefined).length;
console.log(`${withGps} / ${all.length} = ${(withGps / all.length * 100).toFixed(1)}%`);
```

Expected: ≥ 99 % coverage on dev. If lower, investigate which `citySlug` values aren't resolving (likely missing rows in the `locations` import).

- [ ] **Step 7.5: Commit**

```bash
git add convex/migrations/2026_05_06_jobPostings_gps.ts
git commit -m "feat(jobs): backfill gps on job_postings from locations table"
```

---

### Task 8: Stamp `gps` on every new job write

**Files:**
- Modify: `convex/jobPostings.ts`

- [ ] **Step 8.1: Read `upsertFromSearch` carefully**

Read `convex/jobPostings.ts` from line 385 to ~600. Find the place where `citySlug` is computed (around line 508). The `gps` write happens at the same point.

- [ ] **Step 8.2: Add a small helper at the top of `convex/jobPostings.ts`**

```ts
// add near other internal helpers
async function resolveGpsForCity(
  ctx: any,
  cityName: string | undefined,
  countryCode: string | undefined,
): Promise<{ lat: number; lon: number } | undefined> {
  if (!cityName) return undefined;
  const lower = cityName.toLowerCase();
  const candidates = await ctx.db
    .query("locations")
    .withIndex("by_target_nameLower", (q: any) =>
      q.eq("targetType", "City").eq("nameLower", lower),
    )
    .take(20);
  const match = countryCode
    ? candidates.find(
        (l: any) => l.countryCode.toLowerCase() === countryCode.toLowerCase(),
      )
    : candidates[0];
  return match ? { lat: match.gps.lat, lon: match.gps.lon } : undefined;
}
```

- [ ] **Step 8.3: Wire `gps` into the insert/update branches**

In both branches of `upsertFromSearch` where new rows or updated rows are written, include:

```ts
const gps = await resolveGpsForCity(ctx, cityFromLocation, args.countryCode);
// ...then in the .insert({...}) / .patch(_id, {...}) call:
//   gps,
```

(Read the file carefully — there are two branches around line 498 and line 508. Both need the field.)

- [ ] **Step 8.4: Type-check + push**

Run: `pnpm exec convex dev --once`
Expected: clean.

- [ ] **Step 8.5: Manual verification — trigger a search**

In the dev frontend signed-in as a test user, fire `jobSearch.search` for a popular role + city. Then in the dashboard, query `job_postings` for the latest few rows and confirm `gps` is populated.

- [ ] **Step 8.6: Commit**

```bash
git add convex/jobPostings.ts
git commit -m "feat(jobs): stamp gps on job_postings during upsertFromSearch"
```

---

### Task 9 (deferred): Narrow `gps` to required

Only do this once new-write coverage stabilizes at 100 % and the backfill is at ≥ 99 %. Run as a separate PR after the feature is shipping.

- [ ] **Step 9.1: Backfill any stragglers**

Re-run the migration: `pnpm exec convex run --no-push 'migrations/2026_05_06_jobPostings_gps:runBackfill' '{}'`. Repeat as needed until `totalPatched === 0`.

- [ ] **Step 9.2: Tighten schema**

In `convex/schema.ts`, change the optional to required:

```ts
gps: v.object({ lat: v.number(), lon: v.number() }),
```

- [ ] **Step 9.3: Push schema**

Run: `pnpm exec convex dev --once`
Expected: schema deploys cleanly. If it fails due to missing rows, run the backfill once more and retry.

- [ ] **Step 9.4: Commit (separate PR)**

```bash
git add convex/schema.ts
git commit -m "feat(jobs): tighten job_postings.gps to required after backfill stabilization"
```

---

## Phase 3 — Convex queries / actions

### Task 10: `profiles.resolvedLocation` query

**Files:**
- Modify: `convex/profiles.ts` (add new query at end of file)
- Test: `convex/profiles.test.ts` (extend existing suite)

- [ ] **Step 10.1: Write failing tests**

Append to `convex/profiles.test.ts`:

```ts
describe("profiles.resolvedLocation", () => {
  it("returns null when not authenticated", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    const result = await t.query(api.profiles.resolvedLocation, {});
    expect(result).toBeNull();
  });

  it("returns null when profile has no location", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    const asUser = t.withIdentity({ subject: "user_test_1", tokenIdentifier: "user_test_1" });
    await asUser.run(async (ctx) => {
      await ctx.db.insert("users", {
        tokenIdentifier: "user_test_1",
        clerkId: "user_test_1",
        email: "t@example.com",
        createdAt: Date.now(),
      });
    });
    const result = await asUser.query(api.profiles.resolvedLocation, {});
    expect(result).toBeNull();
  });

  it("resolves location string to lat/lon/country via locations table", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    const asUser = t.withIdentity({ subject: "user_test_2", tokenIdentifier: "user_test_2" });

    await asUser.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "user_test_2",
        clerkId: "user_test_2",
        email: "t2@example.com",
        createdAt: Date.now(),
      });
      await ctx.db.insert("profiles", {
        userId,
        location: "London",
        locationConfirmedAt: Date.now(),
      });
      await ctx.db.insert("locations", {
        externalId: "ext-london",
        googleId: 1006886,
        name: "London",
        canonicalName: "London,England,United Kingdom",
        countryCode: "GB",
        targetType: "City",
        reach: 100,
        gps: { lat: 51.5074, lon: -0.1278 },
        nameLower: "london",
      });
    });

    const result = await asUser.query(api.profiles.resolvedLocation, {});
    expect(result).toEqual({
      lat: 51.5074,
      lon: -0.1278,
      countryCode: "gb",
    });
  });
});
```

- [ ] **Step 10.2: Run tests, verify they fail**

Run: `pnpm test convex/profiles.test.ts -t "resolvedLocation"`
Expected: FAIL — `api.profiles.resolvedLocation is undefined`.

- [ ] **Step 10.3: Implement the query**

Append to `convex/profiles.ts`:

```ts
export const resolvedLocation = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      lat: v.number(),
      lon: v.number(),
      countryCode: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile?.location) return null;

    const cityName = profile.location.split(",")[0]?.trim().toLowerCase();
    if (!cityName) return null;

    const matches = await ctx.db
      .query("locations")
      .withIndex("by_target_nameLower", (q) =>
        q.eq("targetType", "City").eq("nameLower", cityName),
      )
      .take(20);
    if (matches.length === 0) return null;

    // Pick the highest-reach (most populous) match — handles ambiguous names
    // ("Cambridge", "Springfield") by preferring the canonical big city.
    const best = matches.reduce((a, b) => (b.reach > a.reach ? b : a));

    return {
      lat: best.gps.lat,
      lon: best.gps.lon,
      countryCode: best.countryCode.toLowerCase(),
    };
  },
});
```

- [ ] **Step 10.4: Run tests, verify they pass**

Run: `pnpm test convex/profiles.test.ts -t "resolvedLocation"`
Expected: 3 tests pass.

- [ ] **Step 10.5: Commit**

```bash
git add convex/profiles.ts convex/profiles.test.ts
git commit -m "feat(profiles): add resolvedLocation query for guide→jobs viewer geo"
```

---

### Task 11: `jobsForGuide.forGuide` query

**Files:**
- Create: `convex/jobsForGuide.ts`
- Test: `convex/jobsForGuide.test.ts`

- [ ] **Step 11.1: Write failing tests**

```ts
// convex/jobsForGuide.test.ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const seedGuideAndCompany = async (
  ctx: any,
  args: { slug: string; companyName?: string },
) => {
  const companyId = await ctx.db.insert("companies", {
    name: args.companyName ?? "Acme Co",
    nameNormalized: (args.companyName ?? "Acme Co").toLowerCase(),
    slug: (args.companyName ?? "acme-co").toLowerCase().replace(/\s+/g, "-"),
    createdAt: Date.now(),
  });
  await ctx.db.insert("career_guides", {
    slug: args.slug,
    title: args.slug.replace(/-/g, " "),
    status: "complete",
    createdAt: Date.now(),
  });
  return companyId;
};

const seedJob = async (
  ctx: any,
  args: {
    companyId: any;
    archetype: string;
    city: string;
    countryCode: string;
    gps?: { lat: number; lon: number };
    lastSeenAt?: number;
  },
) => {
  return ctx.db.insert("job_postings", {
    sourceUrl: `https://example.com/${Math.random()}`,
    title: "Test role",
    companyId: args.companyId,
    city: args.city,
    citySlug: args.city.toLowerCase().replace(/\s+/g, "-"),
    countryCode: args.countryCode,
    location: `${args.city}, ${args.countryCode.toUpperCase()}`,
    isActive: true,
    lastSeenAt: args.lastSeenAt ?? Date.now(),
    roleArchetypeSlug: args.archetype,
    gps: args.gps,
    dedupKey: `dedup-${Math.random()}`,
    createdAt: Date.now(),
  });
};

describe("jobsForGuide.forGuide", () => {
  it("returns empty result for an unknown guide slug", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    const result = await t.query(api.jobsForGuide.forGuide, {
      guideSlug: "nonexistent-role",
      viewer: {},
      limit: 5,
    });
    expect(result.jobs).toHaveLength(0);
    expect(result.totalArchetypeMatches).toBe(0);
  });

  it("returns radius-rung cards sorted by distance", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    await t.run(async (ctx) => {
      const companyId = await seedGuideAndCompany(ctx, { slug: "product-manager" });
      // London (close), Slough (~30 km), Manchester (~262 km)
      await seedJob(ctx, {
        companyId,
        archetype: "product-manager",
        city: "London",
        countryCode: "gb",
        gps: { lat: 51.5074, lon: -0.1278 },
      });
      await seedJob(ctx, {
        companyId,
        archetype: "product-manager",
        city: "Slough",
        countryCode: "gb",
        gps: { lat: 51.5105, lon: -0.5950 },
      });
      await seedJob(ctx, {
        companyId,
        archetype: "product-manager",
        city: "Manchester",
        countryCode: "gb",
        gps: { lat: 53.4808, lon: -2.2426 },
      });
    });

    const result = await t.query(api.jobsForGuide.forGuide, {
      guideSlug: "product-manager",
      viewer: { lat: 51.5074, lon: -0.1278, countryCode: "gb" },
      limit: 5,
    });
    expect(result.ladderHit).toBe("radius");
    expect(result.jobs.map((j) => j.city)).toEqual(["London", "Slough"]);
    expect(result.totalArchetypeMatches).toBe(3);
  });

  it("excludes inactive postings", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    await t.run(async (ctx) => {
      const companyId = await seedGuideAndCompany(ctx, { slug: "product-manager" });
      const id = await seedJob(ctx, {
        companyId,
        archetype: "product-manager",
        city: "London",
        countryCode: "gb",
        gps: { lat: 51.5074, lon: -0.1278 },
      });
      await ctx.db.patch(id, { isActive: false });
    });

    const result = await t.query(api.jobsForGuide.forGuide, {
      guideSlug: "product-manager",
      viewer: { lat: 51.5074, lon: -0.1278, countryCode: "gb" },
      limit: 5,
    });
    expect(result.jobs).toHaveLength(0);
  });

  it("excludes postings with null roleArchetypeSlug", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    await t.run(async (ctx) => {
      const companyId = await seedGuideAndCompany(ctx, { slug: "product-manager" });
      await ctx.db.insert("job_postings", {
        sourceUrl: "https://example.com/x",
        title: "Test role",
        companyId,
        city: "London",
        citySlug: "london",
        countryCode: "gb",
        location: "London, GB",
        isActive: true,
        lastSeenAt: Date.now(),
        roleArchetypeSlug: null,
        gps: { lat: 51.5074, lon: -0.1278 },
        dedupKey: "dedup-x",
        createdAt: Date.now(),
      });
    });

    const result = await t.query(api.jobsForGuide.forGuide, {
      guideSlug: "product-manager",
      viewer: { lat: 51.5074, lon: -0.1278, countryCode: "gb" },
      limit: 5,
    });
    expect(result.jobs).toHaveLength(0);
  });

  it("hydrates company name from companies table", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    await t.run(async (ctx) => {
      const companyId = await seedGuideAndCompany(ctx, {
        slug: "product-manager",
        companyName: "Stripe",
      });
      await seedJob(ctx, {
        companyId,
        archetype: "product-manager",
        city: "London",
        countryCode: "gb",
        gps: { lat: 51.5074, lon: -0.1278 },
      });
    });

    const result = await t.query(api.jobsForGuide.forGuide, {
      guideSlug: "product-manager",
      viewer: { lat: 51.5074, lon: -0.1278, countryCode: "gb" },
      limit: 5,
    });
    expect(result.jobs[0]?.companyName).toBe("Stripe");
  });
});
```

- [ ] **Step 11.2: Run tests, verify they fail**

Run: `pnpm test convex/jobsForGuide.test.ts`
Expected: FAIL — `api.jobsForGuide.forGuide is undefined`.

- [ ] **Step 11.3: Implement the query**

```ts
// convex/jobsForGuide.ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { applyLocationLadder, type LadderCandidate } from "./lib/locationLadder";

const RADIUS_KM = 50;
const MAX_LADDER_CANDIDATES = 200;

const cardValidator = v.object({
  jobPostingId: v.id("job_postings"),
  publicId: v.optional(v.string()),
  title: v.string(),
  companyName: v.string(),
  city: v.string(),
  citySlug: v.string(),
  countryCode: v.optional(v.string()),
  postedAt: v.number(),
  salaryDisplay: v.optional(v.string()),
  sourceUrl: v.string(),
  archetypeSlug: v.string(),
});

export const forGuide = query({
  args: {
    guideSlug: v.string(),
    viewer: v.object({
      lat: v.optional(v.number()),
      lon: v.optional(v.number()),
      countryCode: v.optional(v.string()),
    }),
    limit: v.number(),
  },
  returns: v.object({
    jobs: v.array(cardValidator),
    totalArchetypeMatches: v.number(),
    ladderHit: v.union(
      v.literal("radius"),
      v.literal("country"),
      v.literal("anywhere"),
    ),
  }),
  handler: async (ctx, { guideSlug, viewer, limit }) => {
    const candidates = await ctx.db
      .query("job_postings")
      .withIndex("by_roleArchetypeSlug_isActive_lastSeenAt", (q) =>
        q.eq("roleArchetypeSlug", guideSlug).eq("isActive", true),
      )
      .order("desc")
      .take(MAX_LADDER_CANDIDATES);

    if (candidates.length === 0) {
      return { jobs: [], totalArchetypeMatches: 0, ladderHit: "anywhere" as const };
    }

    const ladderCandidates: LadderCandidate[] = candidates.map((c) => ({
      _id: c._id,
      gps: c.gps,
      countryCode: c.countryCode,
      lastSeenAt: c.lastSeenAt,
      citySlug: c.citySlug,
    }));
    const { picked, ladderHit } = applyLocationLadder(
      ladderCandidates,
      {
        lat: viewer.lat,
        lon: viewer.lon,
        countryCode: viewer.countryCode?.toLowerCase(),
      },
      limit,
      RADIUS_KM,
    );

    const byId = new Map(candidates.map((c) => [c._id, c] as const));
    const jobs = await Promise.all(
      picked.map(async (p) => {
        const c = byId.get(p._id)!;
        return await hydrateCard(ctx, c);
      }),
    );

    return {
      jobs,
      totalArchetypeMatches: candidates.length,
      ladderHit,
    };
  },
});

async function hydrateCard(
  ctx: any,
  job: Doc<"job_postings">,
): Promise<any> {
  const company = await ctx.db.get(job.companyId);
  return {
    jobPostingId: job._id,
    publicId: job.publicId,
    title: job.title,
    companyName: company?.name ?? "Unknown",
    city: job.city,
    citySlug: job.citySlug,
    countryCode: job.countryCode,
    postedAt: job.lastSeenAt,
    salaryDisplay: job.salaryDisplay,
    sourceUrl: job.sourceUrl,
    archetypeSlug: job.roleArchetypeSlug ?? "",
  };
}
```

> **Note:** the validators above (`publicId`, `salaryDisplay`) reference fields whose presence on `job_postings` should be confirmed when implementing — read `convex/schema.ts` lines 1110–1200 first. If a field doesn't exist on the schema, drop it from `cardValidator` and `hydrateCard`. The schema is the source of truth.

- [ ] **Step 11.4: Run tests, verify they pass**

Run: `pnpm test convex/jobsForGuide.test.ts`
Expected: 5 tests pass.

- [ ] **Step 11.5: Commit**

```bash
git add convex/jobsForGuide.ts convex/jobsForGuide.test.ts
git commit -m "feat(jobs): add jobsForGuide.forGuide query for career guide pages"
```

---

### Task 12: `jobsForGuide.fitScores` query

**Files:**
- Modify: `convex/jobsForGuide.ts` (append new query)
- Test: extend `convex/jobsForGuide.test.ts`

- [ ] **Step 12.1: Write failing test**

Append to `convex/jobsForGuide.test.ts`:

```ts
describe("jobsForGuide.fitScores", () => {
  it("returns null when not authenticated", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    const result = await t.query(api.jobsForGuide.fitScores, { jobIds: [] });
    expect(result).toBeNull();
  });

  it("returns null when user has no profile embedding", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    const asUser = t.withIdentity({ subject: "u1", tokenIdentifier: "u1" });
    await asUser.run(async (ctx) => {
      await ctx.db.insert("users", {
        tokenIdentifier: "u1",
        clerkId: "u1",
        email: "u1@example.com",
        createdAt: Date.now(),
      });
    });
    const result = await asUser.query(api.jobsForGuide.fitScores, { jobIds: [] });
    expect(result).toBeNull();
  });

  it("returns tier per job for embedded user + jobs", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    const asUser = t.withIdentity({ subject: "u2", tokenIdentifier: "u2" });
    let jobId: any;

    await asUser.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u2",
        clerkId: "u2",
        email: "u2@example.com",
        createdAt: Date.now(),
      });
      // Profile vector
      const v0 = [1, 0, 0];
      await ctx.db.insert("profile_embeddings", {
        userId,
        wholeVector: v0,
        arcVector: v0,
        currentStateVector: v0,
        domainVector: v0,
        createdAt: Date.now(),
      } as any);

      const companyId = await ctx.db.insert("companies", {
        name: "Acme",
        nameNormalized: "acme",
        slug: "acme",
        createdAt: Date.now(),
      });
      jobId = await ctx.db.insert("job_postings", {
        sourceUrl: "https://x",
        title: "T",
        companyId,
        city: "London",
        citySlug: "london",
        countryCode: "gb",
        location: "London",
        isActive: true,
        lastSeenAt: Date.now(),
        roleArchetypeSlug: "x",
        gps: { lat: 51.5, lon: -0.1 },
        dedupKey: "x",
        createdAt: Date.now(),
      } as any);
      // Strong-fit: vector colinear with profile vector
      await ctx.db.insert("job_posting_embeddings", {
        jobPostingId: jobId,
        wholeVector: [1, 0, 0],
        createdAt: Date.now(),
      } as any);
    });

    const result = await asUser.query(api.jobsForGuide.fitScores, {
      jobIds: [jobId],
    });
    expect(result).not.toBeNull();
    expect(result![0]).toEqual({ jobPostingId: jobId, tier: "strong" });
  });
});
```

- [ ] **Step 12.2: Run tests, verify they fail**

Run: `pnpm test convex/jobsForGuide.test.ts -t "fitScores"`
Expected: FAIL — `api.jobsForGuide.fitScores is undefined`.

- [ ] **Step 12.3: Implement the query**

Append to `convex/jobsForGuide.ts`:

```ts
import { loadProfileAndJobVectors } from "./lib/jobFit";
import { cosineSim } from "./lib/discoverScoring";

const FIT_TIER_STRONG_MIN = 0.7;
const FIT_TIER_WORTH_MIN = 0.55;

const tierResultValidator = v.union(
  v.null(),
  v.array(
    v.object({
      jobPostingId: v.id("job_postings"),
      tier: v.union(
        v.literal("strong"),
        v.literal("worth"),
        v.null(),
      ),
    }),
  ),
);

export const fitScores = query({
  args: { jobIds: v.array(v.id("job_postings")) },
  returns: tierResultValidator,
  handler: async (ctx, { jobIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const data = await loadProfileAndJobVectors(
      ctx,
      identity.tokenIdentifier,
      jobIds,
    );
    if (!data) return null;

    const tierByJobId = new Map<Id<"job_postings">, "strong" | "worth" | null>();
    for (const { jobPostingId, vector } of data.jobVectors) {
      let sim: number;
      try {
        sim = cosineSim(data.profileVector, vector);
      } catch {
        continue;
      }
      tierByJobId.set(
        jobPostingId,
        sim >= FIT_TIER_STRONG_MIN
          ? "strong"
          : sim >= FIT_TIER_WORTH_MIN
            ? "worth"
            : null,
      );
    }

    return jobIds.map((id) => ({
      jobPostingId: id,
      tier: tierByJobId.get(id) ?? null,
    }));
  },
});
```

- [ ] **Step 12.4: Run tests, verify they pass**

Run: `pnpm test convex/jobsForGuide.test.ts -t "fitScores"`
Expected: 3 tests pass.

- [ ] **Step 12.5: Commit**

```bash
git add convex/jobsForGuide.ts convex/jobsForGuide.test.ts
git commit -m "feat(jobs): add jobsForGuide.fitScores query for signed-in profile match"
```

---

### Task 13: `jobsForGuide.searchLive` action with rate limiting

**Files:**
- Modify: `convex/jobsForGuide.ts` (append action)
- Test: extend `convex/jobsForGuide.test.ts`

- [ ] **Step 13.1: Read existing rate-limit pattern**

Read `convex/lib/rateLimit.ts` (45 lines). The helper `tryConsumeRateLimit({ key, max, windowMs })` accepts a `MutationCtx` (so the action calls it via `ctx.runMutation` to a wrapper internalMutation).

- [ ] **Step 13.2: Write failing tests**

Append to `convex/jobsForGuide.test.ts`:

```ts
describe("jobsForGuide.searchLive", () => {
  it("rejects unauthenticated callers", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    await expect(
      t.action(api.jobsForGuide.searchLive, {
        guideSlug: "product-manager",
      }),
    ).rejects.toThrow(/auth required/);
  });

  it("rejects after 5 calls in the same hour for same archetype", async () => {
    const t = convexTest({ schema, modules: import.meta.glob("./**/*.ts") });
    const asUser = t.withIdentity({ subject: "u3", tokenIdentifier: "u3" });
    // Mock the underlying jobSearch.search action by stubbing it via convex-test
    // — convex-test runs handlers, but external API calls inside .search must
    // be mocked in the test environment. For this test, we confirm rate-limit
    // bites BEFORE the external call.
    for (let i = 0; i < 5; i++) {
      await asUser.action(api.jobsForGuide.searchLive, {
        guideSlug: "product-manager",
      }).catch(() => {});
    }
    await expect(
      asUser.action(api.jobsForGuide.searchLive, {
        guideSlug: "product-manager",
      }),
    ).rejects.toThrow(/quota_exceeded/);
  });
});
```

> **Note:** the second test's loop swallows errors because `jobSearch.search` will throw in the test environment (no SearchAPI mocked). The point is to verify the *quota* triggers before the underlying search runs. If `jobSearch.search` fails *before* the quota counter increments, the test will be wrong — read the action carefully and make sure the quota check + record happens *before* `runAction(internal.jobSearch.search, ...)`.

- [ ] **Step 13.3: Run tests, verify they fail**

Run: `pnpm test convex/jobsForGuide.test.ts -t "searchLive"`
Expected: FAIL — `api.jobsForGuide.searchLive is undefined`.

- [ ] **Step 13.4: Implement the action**

Append to `convex/jobsForGuide.ts`:

```ts
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError } from "convex/values";
import { tryConsumeRateLimit } from "./lib/rateLimit";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PER_ARCHETYPE_PER_HOUR = 5;
const PER_USER_PER_DAY = 20;

export const _consumeSearchQuota = internalMutation({
  args: {
    userClerkId: v.string(),
    archetypeSlug: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), retryAfterMs: v.number() }),
  ),
  handler: async (ctx, { userClerkId, archetypeSlug }) => {
    // Per-archetype-per-hour first (tighter constraint)
    const perArchetype = await tryConsumeRateLimit(ctx, {
      key: `livejobsearch:archetype:${userClerkId}:${archetypeSlug}`,
      max: PER_ARCHETYPE_PER_HOUR,
      windowMs: HOUR_MS,
    });
    if (!perArchetype.ok) return { ok: false as const, retryAfterMs: perArchetype.retryAfterMs };

    const perUser = await tryConsumeRateLimit(ctx, {
      key: `livejobsearch:user:${userClerkId}`,
      max: PER_USER_PER_DAY,
      windowMs: DAY_MS,
    });
    if (!perUser.ok) return { ok: false as const, retryAfterMs: perUser.retryAfterMs };

    return { ok: true as const };
  },
});

export const searchLive = action({
  args: {
    guideSlug: v.string(),
    citySlug: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { guideSlug, citySlug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("auth required");

    const quota = await ctx.runMutation(
      internal.jobsForGuide._consumeSearchQuota,
      {
        userClerkId: identity.subject,
        archetypeSlug: guideSlug,
      },
    );
    if (!quota.ok) {
      throw new ConvexError({
        kind: "quota_exceeded",
        retryAfterMs: quota.retryAfterMs,
      });
    }

    // Hand off to the existing public search action with derived args.
    // (Read convex/jobSearch.ts:353 for the exact action shape — the args
    // below match its `search` action public signature.)
    await ctx.runAction(api.jobSearch.search, {
      query: guideSlug.replace(/-/g, " "),
      citySlug,
      limit: 20,
    });

    return { ok: true };
  },
});
```

> **Note:** confirm `api.jobSearch.search` signature by reading `convex/jobSearch.ts:353` before finalizing. The args above are an inferred shape — adjust if the real signature differs.

- [ ] **Step 13.5: Run tests, verify they pass**

Run: `pnpm test convex/jobsForGuide.test.ts -t "searchLive"`
Expected: 2 tests pass.

- [ ] **Step 13.6: Commit**

```bash
git add convex/jobsForGuide.ts convex/jobsForGuide.test.ts
git commit -m "feat(jobs): add rate-limited searchLive action for guide page"
```

---

## Phase 4 — Page-level integration

### Task 14: Extract anonymous geo helper

**Files:**
- Modify: `app/career-guides/[slug]/page.tsx`

- [ ] **Step 14.1: Read current geo extraction**

Read `app/career-guides/[slug]/page.tsx` lines 1–50 to see how `resolveRegion` is structured.

- [ ] **Step 14.2: Add `resolveAnonymousGeo` helper alongside it**

Below `resolveRegion`:

```ts
type AnonymousGeo = {
  city?: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
};

async function resolveAnonymousGeo(): Promise<AnonymousGeo> {
  const h = await headers();
  const city = h.get("x-vercel-ip-city")?.toLowerCase() || undefined;
  const countryCode = h.get("x-vercel-ip-country")?.toLowerCase() || undefined;
  const latRaw = h.get("x-vercel-ip-latitude");
  const lonRaw = h.get("x-vercel-ip-longitude");
  const lat = latRaw ? Number(latRaw) : undefined;
  const lon = lonRaw ? Number(lonRaw) : undefined;
  return {
    city: city ? decodeURIComponent(city) : undefined,
    countryCode,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
  };
}
```

- [ ] **Step 14.3: Call it in the page component and pass through**

In the default export (around line 125), add a parallel call:

```ts
const [region, anonymousGeo] = await Promise.all([
  resolveRegion(sp.region),
  resolveAnonymousGeo(),
]);
```

- [ ] **Step 14.4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 14.5: Commit**

```bash
git add app/career-guides/\[slug\]/page.tsx
git commit -m "feat(pages): extract anonymousGeo from Vercel headers in career-guide page"
```

---

## Phase 5 — Components

### Task 15: `JobsForGuideCard`

**Files:**
- Create: `components/career-guides/JobsForGuideCard.tsx`

- [ ] **Step 15.1: Implement the card**

```tsx
// components/career-guides/JobsForGuideCard.tsx
"use client";

import Link from "next/link";
import { Building2, MapPin, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ViewerState =
  | "anonymous"
  | "signed-in-no-profile"
  | "signed-in-with-profile";

export type JobCardData = {
  jobPostingId: string;
  publicId?: string;
  title: string;
  companyName: string;
  city: string;
  citySlug: string;
  countryCode?: string;
  postedAt: number;
  salaryDisplay?: string;
  archetypeSlug: string;
  fitTier?: "strong" | "worth" | null;
};

type Props = {
  job: JobCardData;
  viewerState: ViewerState;
  /** When true, render as the locked/blurred preview. */
  locked?: boolean;
};

export function JobsForGuideCard({ job, viewerState, locked = false }: Props) {
  const showSalary = !locked && viewerState !== "anonymous";
  const showFitPill = viewerState === "signed-in-with-profile" && !locked;
  const showLockedFitPill = viewerState !== "signed-in-with-profile" && !locked;

  const href = locked
    ? "#sign-in"
    : `/jobs/listing/${encodeURIComponent(job.citySlug)}/${
        job.publicId ?? job.jobPostingId
      }`;

  const Inner = (
    <Card
      className={cn(
        "p-4 transition-colors hover:bg-accent/40",
        locked && "pointer-events-none select-none",
      )}
      aria-hidden={locked}
    >
      <div className={cn("space-y-2", locked && "blur-[3px]")}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium leading-snug">{job.title}</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Building2 className="size-3" aria-hidden /> {job.companyName}
            </p>
          </div>
          {showFitPill && job.fitTier && (
            <Badge
              variant={job.fitTier === "strong" ? "default" : "secondary"}
              className="shrink-0"
            >
              {job.fitTier === "strong" ? "Strong fit" : "Worth a look"}
            </Badge>
          )}
          {showLockedFitPill && (
            <Badge variant="outline" className="shrink-0 gap-1">
              <Lock className="size-3" aria-hidden />
              {viewerState === "anonymous"
                ? "Sign in for fit"
                : "Complete profile"}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="size-3" aria-hidden /> {job.city}
          </span>
          {showSalary && job.salaryDisplay && <span>{job.salaryDisplay}</span>}
          <span>{formatPosted(job.postedAt)}</span>
        </div>
      </div>
    </Card>
  );

  if (locked) return Inner;
  return (
    <Link href={href} className="block focus-visible:outline-none">
      {Inner}
    </Link>
  );
}

function formatPosted(ts: number): string {
  const days = Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
```

- [ ] **Step 15.2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean. If `Card`/`Badge` paths are wrong for this project, update imports — see existing usage in `components/career-guides/CareerGuideCard.tsx` for the right shadcn import paths.

- [ ] **Step 15.3: Commit**

```bash
git add components/career-guides/JobsForGuideCard.tsx
git commit -m "feat(jobs): add JobsForGuideCard component"
```

---

### Task 16: `JobsForGuideEmpty`

**Files:**
- Create: `components/career-guides/JobsForGuideEmpty.tsx`

- [ ] **Step 16.1: Implement**

```tsx
// components/career-guides/JobsForGuideEmpty.tsx
"use client";

import { SignInButton } from "@clerk/nextjs";
import { Search, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Props = {
  guideTitle: string;
  variant: "anonymous" | "signed-in";
  onSearchLive?: () => void;
  searchLivePending?: boolean;
  signInRedirectUrl: string;
};

export function JobsForGuideEmpty({
  guideTitle,
  variant,
  onSearchLive,
  searchLivePending,
  signInRedirectUrl,
}: Props) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Briefcase className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">
            No cached postings for {guideTitle} yet
          </p>
          <p className="text-xs text-muted-foreground">
            {variant === "anonymous"
              ? "Sign in and we'll search live for jobs near you."
              : "Search live to pull fresh postings into the cache."}
          </p>
        </div>
      </div>
      {variant === "anonymous" ? (
        <SignInButton mode="modal" forceRedirectUrl={signInRedirectUrl}>
          <Button size="sm">Sign in to search</Button>
        </SignInButton>
      ) : (
        <Button
          size="sm"
          onClick={onSearchLive}
          disabled={searchLivePending}
        >
          <Search className="mr-1.5 size-4" aria-hidden />
          {searchLivePending ? "Searching…" : "Search live"}
        </Button>
      )}
    </Card>
  );
}
```

- [ ] **Step 16.2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 16.3: Commit**

```bash
git add components/career-guides/JobsForGuideEmpty.tsx
git commit -m "feat(jobs): add JobsForGuideEmpty for empty-cache states"
```

---

### Task 17: `JobsForGuideTeaseLock`

**Files:**
- Create: `components/career-guides/JobsForGuideTeaseLock.tsx`

- [ ] **Step 17.1: Implement**

```tsx
// components/career-guides/JobsForGuideTeaseLock.tsx
"use client";

import { SignInButton } from "@clerk/nextjs";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobsForGuideCard, type JobCardData } from "./JobsForGuideCard";

type Props = {
  /** Skeleton cards rendered behind the blur. Length should be 1–2. */
  blurredPlaceholders: JobCardData[];
  totalRemaining: number;
  geoLabel: string; // e.g. "near London" or "in the UK"
  guideTitle: string;
  signInRedirectUrl: string;
};

export function JobsForGuideTeaseLock({
  blurredPlaceholders,
  totalRemaining,
  geoLabel,
  guideTitle,
  signInRedirectUrl,
}: Props) {
  return (
    <div className="relative">
      <div className="space-y-2 opacity-90">
        {blurredPlaceholders.map((p) => (
          <JobsForGuideCard
            key={p.jobPostingId}
            job={p}
            viewerState="anonymous"
            locked
          />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-background/40 via-background/80 to-background">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-foreground/5">
            <Lock className="size-4 text-muted-foreground" aria-hidden />
          </div>
          <p className="text-sm">
            {totalRemaining > 0
              ? `Sign in to see all ${totalRemaining} jobs hiring ${guideTitle} ${geoLabel}.`
              : `Sign in to see jobs hiring ${guideTitle} ${geoLabel}.`}
          </p>
          <SignInButton mode="modal" forceRedirectUrl={signInRedirectUrl}>
            <Button size="sm">Sign in</Button>
          </SignInButton>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 17.2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 17.3: Commit**

```bash
git add components/career-guides/JobsForGuideTeaseLock.tsx
git commit -m "feat(jobs): add JobsForGuideTeaseLock with blurred-stack sign-in CTA"
```

---

### Task 18: `JobsForGuide` orchestrator

**Files:**
- Create: `components/career-guides/JobsForGuide.tsx`

- [ ] **Step 18.1: Implement the orchestrator**

```tsx
// components/career-guides/JobsForGuide.tsx
"use client";

import { useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import { Briefcase, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeLadderHit } from "@/lib/jobs/microcopy";
import {
  JobsForGuideCard,
  type JobCardData,
  type ViewerState,
} from "./JobsForGuideCard";
import { JobsForGuideEmpty } from "./JobsForGuideEmpty";
import { JobsForGuideTeaseLock } from "./JobsForGuideTeaseLock";

const ANON_LIMIT = 5; // 3 visible + 2 blurred
const SIGNED_IN_LIMIT = 12;

type AnonymousGeo = {
  city?: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
};

type Props = {
  guideSlug: string;
  guideTitle: string;
  anonymousGeo: AnonymousGeo;
  /** Absolute URL of the current guide page; used as the post-sign-in redirect target. */
  pageUrl: string;
};

export function JobsForGuide({
  guideSlug,
  guideTitle,
  anonymousGeo,
  pageUrl,
}: Props) {
  const { isLoaded: clerkLoaded, isSignedIn } = useUser();
  const profileGeo = useQuery(
    api.profiles.resolvedLocation,
    isSignedIn ? {} : "skip",
  );

  const viewer = useMemo(() => {
    if (isSignedIn && profileGeo) {
      return {
        lat: profileGeo.lat,
        lon: profileGeo.lon,
        countryCode: profileGeo.countryCode,
      };
    }
    return {
      lat: anonymousGeo.lat,
      lon: anonymousGeo.lon,
      countryCode: anonymousGeo.countryCode,
    };
  }, [isSignedIn, profileGeo, anonymousGeo]);

  const limit = isSignedIn ? SIGNED_IN_LIMIT : ANON_LIMIT;
  const data = useQuery(api.jobsForGuide.forGuide, {
    guideSlug,
    viewer,
    limit,
  });

  const fit = useQuery(
    api.jobsForGuide.fitScores,
    isSignedIn && data && data.jobs.length > 0
      ? { jobIds: data.jobs.map((j) => j.jobPostingId as any) }
      : "skip",
  );

  const viewerState: ViewerState = !isSignedIn
    ? "anonymous"
    : fit
      ? "signed-in-with-profile"
      : "signed-in-no-profile";

  const fitByJobId = useMemo(() => {
    const m = new Map<string, "strong" | "worth" | null>();
    fit?.forEach((f) => m.set(f.jobPostingId as any, f.tier));
    return m;
  }, [fit]);

  const searchLive = useAction(api.jobsForGuide.searchLive);
  const [searchLivePending, setSearchLivePending] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  const onSearchLive = async () => {
    setSearchLivePending(true);
    setQuotaMessage(null);
    try {
      await searchLive({ guideSlug });
    } catch (err: any) {
      const data = err?.data;
      if (data && data.kind === "quota_exceeded") {
        const min = Math.ceil((data.retryAfterMs as number) / 60000);
        setQuotaMessage(`Try again in ${min} min.`);
      } else {
        setQuotaMessage("Couldn't search right now. Try again soon.");
      }
    } finally {
      setSearchLivePending(false);
    }
  };

  if (!clerkLoaded || data === undefined) {
    return <JobsForGuideSkeleton showBlurred={!isSignedIn} />;
  }

  // Empty after full ladder
  if (data.jobs.length === 0) {
    return (
      <Section guideTitle={guideTitle}>
        <JobsForGuideEmpty
          guideTitle={guideTitle}
          variant={isSignedIn ? "signed-in" : "anonymous"}
          onSearchLive={isSignedIn ? onSearchLive : undefined}
          searchLivePending={searchLivePending}
          signInRedirectUrl={pageUrl}
        />
        {quotaMessage && (
          <p className="text-xs text-muted-foreground" role="status">
            {quotaMessage}
          </p>
        )}
      </Section>
    );
  }

  const cards: JobCardData[] = data.jobs.map((j) => ({
    ...(j as any),
    fitTier: fitByJobId.get(j.jobPostingId as any) ?? null,
  }));

  const viewerCityLabel =
    isSignedIn && profileGeo
      ? // Profile city label not stored as "City" — use anonymousGeo as fallback
        anonymousGeo.city
      : anonymousGeo.city;
  const viewerCountryLabel = data.ladderHit === "country" ? viewer.countryCode?.toUpperCase() : undefined;

  const heading = describeLadderHit({
    ladderHit: data.ladderHit,
    pickedCitySlugs: cards.map((c) => c.citySlug),
    viewerCityLabel,
    viewerCountryLabel,
    total: data.totalArchetypeMatches,
  });

  // Anonymous: split into visible (3) + blurred (2)
  if (!isSignedIn) {
    const visible = cards.slice(0, 3);
    const blurred = cards.slice(3, ANON_LIMIT);

    return (
      <Section guideTitle={guideTitle}>
        <p className="text-sm text-muted-foreground">
          {heading} hiring {guideTitle}.
        </p>
        <div className="space-y-2">
          {visible.map((c) => (
            <JobsForGuideCard
              key={c.jobPostingId}
              job={c}
              viewerState="anonymous"
            />
          ))}
        </div>
        {blurred.length > 0 && (
          <JobsForGuideTeaseLock
            blurredPlaceholders={blurred}
            totalRemaining={Math.max(0, data.totalArchetypeMatches - visible.length)}
            geoLabel={viewerCityLabel ? `near ${viewerCityLabel}` : "near you"}
            guideTitle={guideTitle}
            signInRedirectUrl={pageUrl}
          />
        )}
      </Section>
    );
  }

  // Signed-in
  return (
    <Section guideTitle={guideTitle}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {heading} hiring {guideTitle}.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSearchLive}
          disabled={searchLivePending}
          className="text-xs"
        >
          <Search className="mr-1.5 size-3.5" aria-hidden />
          {searchLivePending ? "Searching…" : "Search live"}
        </Button>
      </div>
      <div className="space-y-2">
        {cards.map((c) => (
          <JobsForGuideCard
            key={c.jobPostingId}
            job={c}
            viewerState={viewerState}
          />
        ))}
      </div>
      {quotaMessage && (
        <p className="text-xs text-muted-foreground" role="status">
          {quotaMessage}
        </p>
      )}
    </Section>
  );
}

function Section({
  guideTitle,
  children,
}: {
  guideTitle: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="jobs-for-guide-heading"
      className="mt-12 space-y-3 border-t pt-8"
    >
      <h2
        id="jobs-for-guide-heading"
        className="flex items-center gap-2 text-base font-semibold"
      >
        <Briefcase className="size-4 text-muted-foreground" aria-hidden />
        Jobs hiring {guideTitle}
      </h2>
      {children}
    </section>
  );
}

function JobsForGuideSkeleton({ showBlurred }: { showBlurred: boolean }) {
  return (
    <section className="mt-12 space-y-3 border-t pt-8">
      <Skeleton className="h-5 w-48" />
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
        {showBlurred && <Skeleton className="h-20 w-full opacity-50" />}
      </div>
    </section>
  );
}
```

- [ ] **Step 18.2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean. Resolve any `any`-cast complaints by reading actual return types from `api.jobsForGuide.forGuide`.

- [ ] **Step 18.3: Commit**

```bash
git add components/career-guides/JobsForGuide.tsx
git commit -m "feat(jobs): add JobsForGuide orchestrator component"
```

---

### Task 19: Mount in the page

**Files:**
- Modify: `app/career-guides/[slug]/page.tsx`

- [ ] **Step 19.1: Add import + mount**

At the top of the file, add:

```ts
import { JobsForGuide } from "@/components/career-guides/JobsForGuide";
```

Compute the page's absolute URL inside the page component (Next.js exposes the request URL via `headers()` — read `x-forwarded-host` + `x-forwarded-proto`, or use the env var if available):

```ts
const pageUrl = await (async () => {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}/career-guides/${guide.slug}`;
})();
```

Find the JSX where `<RelatedGuides ... />` is rendered (line 142). Insert immediately above:

```tsx
<JobsForGuide
  guideSlug={guide.slug}
  guideTitle={guide.title}
  anonymousGeo={anonymousGeo}
  pageUrl={pageUrl}
/>
```

- [ ] **Step 19.2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 19.3: Build**

Run: `pnpm exec next build`
Expected: build succeeds; no Server/Client boundary errors.

- [ ] **Step 19.4: Smoke test the dev server**

Run: `pnpm dev` (in another terminal: `pnpm exec convex dev`)
Visit: http://localhost:3000/career-guides/<some-existing-guide-slug>
Confirm: module appears at the bottom of the article, above `RelatedGuides`.

- [ ] **Step 19.5: Commit**

```bash
git add app/career-guides/\[slug\]/page.tsx
git commit -m "feat(pages): mount JobsForGuide on career guide page"
```

---

## Phase 6 — Verification

### Task 20: Convex performance audit

- [ ] **Step 20.1: Invoke `convex-performance-audit` skill**

Trigger: pass to the skill the scope "Audit `convex/jobsForGuide.ts` (`forGuide`, `fitScores`, `searchLive`) and the modified `upsertFromSearch` write path in `convex/jobPostings.ts`. Verify hot-path read budget per request, check that the new `by_roleArchetypeSlug_isActive_lastSeenAt` index is being used, and surface any OCC risk on the rate-limit table."

- [ ] **Step 20.2: Address P0/P1 findings inline**

Apply fixes the skill recommends; commit each fix as its own commit.

---

### Task 21: `/audit` on the rendered module

- [ ] **Step 21.1: Run `/audit` against three guide pages**

Pick three slugs representing:

1. A popular role with full cache hit (e.g. `/career-guides/product-manager`).
2. A niche role likely on the country/anywhere rung (e.g. a long-tail slug).
3. A role with empty cache (manually deactivate all rows for one archetype on dev to simulate, or create a fresh guide that has no archetype-resolved jobs yet).

Run `/audit <url>` for each at viewport 375 px and 1280 px.

- [ ] **Step 21.2: Address all P0 + P1 issues**

Common items to expect: focus-visible on Sign in CTA inside the lock, text contrast on blurred layer, blur-leak on mobile Safari (test on iOS — see `feedback_ios_sheet_pattern` memory), aria attributes on the lock overlay, intersection between the lock and a card's link surface.

- [ ] **Step 21.3: Commit fixes**

```bash
git add components/career-guides/
git commit -m "fix(jobs): resolve audit findings on JobsForGuide module"
```

---

### Task 22: Manual viewer-state walk

For each state, take a screenshot and confirm acceptance criteria.

- [ ] **Step 22.1: Anonymous, IP-derived city, cache hit**

Visit a popular guide page in an incognito window. Expect:
- 3 visible cards with title / company / city / posted-when (no salary, no fit pill, no apply CTA).
- 2 blurred placeholder cards underneath with a centered Sign-in CTA + lock glyph.
- Heading microcopy includes a city or country phrase.

- [ ] **Step 22.2: Anonymous, cache empty**

Find or simulate a guide with zero `roleArchetypeSlug` matches. Expect: single empty-state card with "Sign in — we'll search jobs hiring …" copy and a Sign-in button.

- [ ] **Step 22.3: Signed-in, no profile**

Sign in as a brand-new test user (no profile uploaded). Expect: all cards visible, no blur, fit pills locked with "Complete profile". `Search live` button present in header.

- [ ] **Step 22.4: Signed-in, profile complete, cache hit**

Sign in as a user with a confirmed location and an uploaded resume (so `profile_embeddings` exists). Expect: cards include resolved fit pills (where embeddings exist), `Search live` CTA visible, no locks.

- [ ] **Step 22.5: Signed-in, quota exceeded**

Trigger `Search live` 5 times in quick succession on the same guide. Expect: 6th call shows "Try again in N min" message inline, no error toast, no infinite spinner.

- [ ] **Step 22.6: Signed-in, cache empty**

Use a guide with no cached postings. Expect: empty-state card with `Search live` button. After successful click + a few seconds, the empty state should resolve into a populated module (live query subscribes to the now-populated cache).

---

### Task 23: Cross-feature impact verification

- [ ] **Step 23.1: Confirm Discover/Career Compass is unaffected**

Run the existing `convex/discover.test.ts` suite:
```bash
pnpm test convex/discover.test.ts
```
Expected: all tests pass; no `discover_canvas` recompute needed (per the spec's cross-feature section).

- [ ] **Step 23.2: Note `gps` denormalization for future Compass use**

No code change. The denormalized `gps` field on `job_postings` is forward-compatible with a future "jobs near my discovered roles" Compass enhancement; record this in the project follow-ups memory:

```
[project_discover_followups.md] — append:
- Career Compass can later read job_postings.gps to surface "jobs near my discovered roles"
  without a fresh migration. Added 2026-05-06 alongside the guide→jobs plug.
```

---

## Self-review checklist (run after writing the plan)

- [x] **Spec coverage:** every section of the spec has a corresponding task. Confirmed:
  - Surface placement → Task 19
  - Linkage by `roleArchetypeSlug` → Task 11 (uses index from Task 5)
  - 3-rung ladder → Tasks 1, 2 (helpers) + Task 11 (wiring)
  - Viewer state matrix → Tasks 15, 18
  - Card field matrix → Task 15
  - Schema migrations → Tasks 5, 6, 7, 8 (and deferred Task 9 for narrow)
  - Live search rate limit → Task 13 (uses existing `tryConsumeRateLimit`, not new table — spec deviation noted at top)
  - Loading / empty / error → Tasks 16, 18 (skeleton; empty card; orchestrator error path)
  - Cross-feature impact → Task 23
  - Verification block → Tasks 20, 21, 22, 23
- [x] **Placeholder scan:** no "TBD" / "TODO" / "implement later" / unwritten test code.
- [x] **Type consistency:** `JobCardData`, `ViewerState`, `LadderHit`, ladder-helper signatures are referenced consistently across tasks.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-career-guide-jobs-plug.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
