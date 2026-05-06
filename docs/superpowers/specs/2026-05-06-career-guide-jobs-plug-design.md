# Career guide → jobs plug — design

**Status:** draft (pending user review)
**Date:** 2026-05-06
**Surface:** `app/career-guides/[slug]` page

## Problem

Career guide pages are content-rich landing surfaces (long article, podcast, deep-dive
voice call, related guides) but currently terminate the reader's intent. A reader who
just learned what a Product Manager does has no in-app path to "find one of these jobs
near me". The inverse direction — `/jobs/listing/[city]/[company]/[title]` plugging a
matching career guide — already exists; this spec adds the missing forward direction.

The plug must:

1. Honor the cost-control posture in `.claude/rules/deployment-previews.md` and
   `.claude/rules/ai-sdk-patterns.md`. Anonymous viewers must not be able to trigger
   paid-API job searches.
2. Match LinkedIn's anonymous-viewer pattern (visible preview + locked stack + in-place
   sign-in CTA) so the gate reads as familiar product convention rather than a paywall.
3. Use viewer location to make results feel relevant — IP-derived for anonymous
   viewers, profile-derived for signed-in users — without ever rendering an empty
   module.

## Goals

- Mount a "Jobs hiring [Title]" module at the end of the career guide page, before
  `<RelatedGuides />`.
- Rank results by location proximity using a fallback ladder (city → 50 km radius →
  country → anywhere), stopping at the first non-empty rung.
- Differentiate three viewer states (anonymous, signed-in without profile, signed-in
  with profile) with progressive disclosure of card content.
- Allow signed-in users to fire a rate-limited live `jobSearch.search` action when the
  cache is thin; never expose this trigger to anonymous viewers.

## Non-goals (explicit)

- Live search for anonymous users.
- Apply-tracking, saved-jobs, or in-app application from the module.
- Salary normalization across currencies (display raw posting values).
- Embedding-similarity fallback for low-archetype-coverage guides — revisit only if
  data shows archetype linkage leaving good jobs unmatched.
- Mobile sticky CTA — the inline placement is sufficient for v1.
- Analytics instrumentation — there is no analytics plumbing in the repo yet; deferred
  to whichever spec lands that surface.

## Architecture

### Linkage (existing infrastructure)

`jobPostings` rows carry `roleArchetypeSlug: v.optional(v.union(v.string(), v.null()))`
(`convex/schema.ts:1194`). The slug is shared with `careerGuides.slug` — a guide for
"product-manager" matches every job whose `roleArchetypeSlug === "product-manager"`.
Resolution is asynchronous on the job side via the existing `_resolveArchetype`
internal action (`convex/jobPostings.ts:789`); rows with `roleArchetypeSlug = null` are
unresolved and excluded from the module.

### Surface placement

`app/career-guides/[slug]/page.tsx` already extracts `x-vercel-ip-country` via
`resolveRegion()` (line 21–30) and threads `defaultRegion` to `<CareerGuideArticle />`
at line 138. We add a sibling component between line 141 and 142:

```tsx
</CareerGuideArticle>
<JobsForGuide
  guideSlug={guide.slug}
  guideTitle={guide.title}
  anonymousGeo={anonymousGeo}
/>
<RelatedGuides ... />
```

`anonymousGeo` is a new value extracted alongside `region`, pulling
`x-vercel-ip-city`, `x-vercel-ip-country`, `x-vercel-ip-latitude`,
`x-vercel-ip-longitude` from `headers()`. For signed-in users the prop is still passed
but ignored — the component reads profile location via Clerk + Convex.

### Component tree

```
components/career-guides/
  JobsForGuide.tsx           — orchestrator (client; reads Clerk + profile)
  JobsForGuideCard.tsx       — single card, viewerState-aware
  JobsForGuideTeaseLock.tsx  — blurred stack + in-place sign-in CTA
  JobsForGuideEmpty.tsx      — stub card for empty-cache states
```

The orchestrator is a client component because it depends on `useUser()` and
subscribes to a live Convex query. The page-level server component passes through the
geo prop derived at request time.

## Viewer state matrix

| State | Cards rendered | Locked content | CTA |
|---|---|---|---|
| Anonymous, cache hit | 2–3 cached cards + 1–2 blurred placeholders | Salary, fit pill, apply | "Sign in to see all *N* jobs near *[City\|Country]*" |
| Anonymous, cache empty (after ladder) | 0 + single stub card | Whole card | "Sign in — we'll search jobs hiring *[Title]* near you" |
| Signed-in, no profile | All cached, distance-ranked | Fit pill ("Complete profile to see fit") | Inline `PersonalizeProfileCta`-style nudge |
| Signed-in, profile complete | All cached + fit pills resolved | — | "Search live for *[Title]* near *[City]*" (rate-limited) |

### Click targets

- Real card → existing public `/jobs/listing/[city]/[company]/[title]` page (already
  SEO-indexed, public for all viewers).
- Blurred card → Clerk sign-in flow with `redirectUrl` back to the current guide.
- Sign-in CTA in `JobsForGuideTeaseLock` → same Clerk flow.
- "Search live" CTA (signed-in only) → rate-limited Convex action.

### Card field matrix

| Field | Anon | Signed-in (no profile) | Signed-in (with profile) |
|---|---|---|---|
| Title | ✓ | ✓ | ✓ |
| Company name (joined from `companies`) | ✓ | ✓ | ✓ |
| City | ✓ | ✓ | ✓ |
| Posted-when | ✓ | ✓ | ✓ |
| Distance label (when ladder rung ≠ city) | — | ✓ | ✓ |
| Salary | — | ✓ if known | ✓ if known |
| Fit pill | locked + "Sign in to see fit" | locked + "Complete profile to see fit" | resolved score |
| Apply CTA | — | ✓ (deep-link to source URL) | ✓ |

The blur on locked cards obscures the same fields the anonymous viewer is missing —
salary, fit, apply — so the lock has visual content to obscure.

## Data flow

### New Convex query — `jobsForGuide.forGuide`

New file `convex/jobsForGuide.ts`. One query, three small helpers.

```ts
export const forGuide = query({
  args: {
    guideSlug: v.string(),
    viewer: v.object({
      lat: v.optional(v.number()),
      lon: v.optional(v.number()),
      countryCode: v.optional(v.string()),
    }),
    limit: v.number(), // 5 for anon, 12 for signed-in
  },
  handler: async (ctx, { guideSlug, viewer, limit }) => {
    // 1. Pull active jobs by archetype slug (new compound index)
    const candidates = await ctx.db
      .query("job_postings")
      .withIndex("by_roleArchetypeSlug_isActive_lastSeenAt", (q) =>
        q.eq("roleArchetypeSlug", guideSlug).eq("isActive", true)
      )
      .order("desc")
      .take(MAX_LADDER_CANDIDATES); // 200; bounds the in-memory sort

    // 2. Apply ladder
    const { picked, ladderHit } = applyLocationLadder(candidates, viewer, limit);

    // 3. Hydrate company names (single .get() per row)
    const cards = await Promise.all(picked.map((j) => hydrateCard(ctx, j)));

    return {
      jobs: cards,
      totalArchetypeMatches: candidates.length,
      ladderHit,
    };
  },
});
```

`applyLocationLadder` is pure — given candidates and viewer geo, picks the first
non-empty rung:

1. **Radius rung:** within 50 km Haversine of `(viewer.lat, viewer.lon)`, sorted by
   distance ascending. Does both "same city" and "commutable" — a user in central
   London sees London / Slough / Watford / Reading jobs naturally ordered by
   proximity. Microcopy disambiguates: if every picked card shares the closest
   card's `citySlug`, render "*N* in *[City]*"; otherwise "*N* within 50 km of *[City]*".
2. **Country rung:** matching `countryCode`, sorted by `lastSeenAt` descending.
3. **Anywhere:** sorted by `lastSeenAt` descending.

Three rungs, not four — a strict city rung was considered and dropped because we
don't have a reliable `citySlug` on the viewer side (profile stores location as a
free string, IP geo gives lat/lon not slugs). The 50 km radius subsumes "same city"
in practice and the microcopy keeps the UI honest.

Returns `picked` (≤ `limit` rows) and `ladderHit` (one of `'radius' | 'country' | 'anywhere'`).

If `viewer.lat`/`viewer.lon` are absent (no IP signal, no profile location), the
ladder skips straight to the country rung if `viewer.countryCode` is present, or
anywhere otherwise.

### Fit-score side-query — `jobsForGuide.fitScores`

For signed-in users with completed profiles, the orchestrator makes a second client
call:

```ts
export const fitScores = query({
  args: { jobIds: v.array(v.id("job_postings")) },
  handler: async (ctx, { jobIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await loadFitScoresForUser(ctx, identity.subject, jobIds);
  },
});
```

The existing `internalQuery _loadFitScores` (`convex/jobSearch.ts:204`) gets its body
extracted into a pure helper at `convex/lib/jobFit.ts` exporting `loadFitScoresForUser(ctx, clerkId, jobIds)`.
Both `internal._loadFitScores` and the new public `fitScores` query become thin
wrappers over that helper. Keeps the public surface explicit (its own validators and
auth check) while reusing one implementation.

### Viewer geo derivation

The Convex query takes `viewer: { lat?, lon?, countryCode? }`. The orchestrator
component decides where each field comes from:

- **Anonymous:** read from request headers passed via the `anonymousGeo` prop —
  `x-vercel-ip-latitude`, `x-vercel-ip-longitude`, `x-vercel-ip-country`.
- **Signed-in:** call a new client-side query
  `profiles.resolvedLocation()` which returns `{ lat, lon, countryCode }` derived
  from `profile.location` via a single `locations` table lookup
  (`by_target_nameLower` + `countryCode` filter). Cached on the Convex side via
  normal subscription mechanics — re-resolved only when `profile.location` changes.
  Returns `null` if the profile has no confirmed location, in which case the
  orchestrator falls back to the `anonymousGeo` prop (best-effort).

### Live search trigger — `jobsForGuide.searchLive`

Wraps the existing `jobSearch.search` action with a per-user-per-archetype quota
gate:

```ts
export const searchLive = action({
  args: { guideSlug: v.string(), citySlug: v.optional(v.string()) },
  handler: async (ctx, { guideSlug, citySlug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("auth required");

    const quota = await ctx.runQuery(internal.jobsForGuide.checkQuota, {
      userClerkId: identity.subject,
      archetypeSlug: guideSlug,
    });
    if (!quota.allowed) {
      throw new ConvexError({ kind: "quota_exceeded", retryAfterMs: quota.retryAfterMs });
    }

    await ctx.runMutation(internal.jobsForGuide.recordQuotaHit, {
      userClerkId: identity.subject,
      archetypeSlug: guideSlug,
    });
    await ctx.runAction(internal.jobSearch.search, { /* ...derived args */ });
    return { ok: true };
  },
});
```

Quota table:

```ts
job_search_quotas: defineTable({
  userClerkId: v.string(),
  archetypeSlug: v.string(),
  windowStart: v.number(), // epoch ms, hour-aligned
  count: v.number(),
})
  .index("by_user_archetype_window", ["userClerkId", "archetypeSlug", "windowStart"])
  .index("by_user_window", ["userClerkId", "windowStart"]);
```

Limits (v1 defaults, tunable):

- 5 hits per `(user, archetypeSlug)` per rolling hour.
- 20 hits per user per rolling 24 h, summed across archetypes.

Both checks happen inside `checkQuota`. `ConvexError` payload `{ kind: 'quota_exceeded', retryAfterMs }`
lets the client render a friendly "try again in N min" pill.

## Schema migrations (via `convex-migration-helper`)

Three additive changes, one PR:

1. **New compound index on `job_postings`:**
   `by_roleArchetypeSlug_isActive_lastSeenAt` over
   `["roleArchetypeSlug", "isActive", "lastSeenAt"]`.
   Pure additive — no widen/narrow needed.
2. **Denormalize `gps` onto `job_postings`:**
   ```ts
   gps: v.optional(v.object({ lat: v.number(), lon: v.number() })),
   ```
   Widen → backfill from `locations` via `citySlug` lookup (resolve via
   `nameLower + countryCode`) → narrow to required once coverage ≥ 99 %. Update
   `upsertFromSearch` (`convex/jobPostings.ts:385`) to stamp `gps` on every write
   when `citySlug` resolves to a `locations` row.
3. **New `job_search_quotas` table** as defined above.

Per `convex-migration-helper` discipline: each step is its own deploy with the
schema validator widened first.

## Loading / empty / error states

- **Loading:** 3 skeleton cards + 1 blurred skeleton for anonymous viewers; same
  skeleton structure for signed-in users (no blurred row). Skeleton matches card
  dimensions exactly to prevent CLS.
- **Anonymous, cache empty after full ladder:** single full-width `JobsForGuideEmpty`
  card with copy "Sign in — we'll search jobs hiring *[Title]* near you". No fake
  blurred stack.
- **Signed-in, cache empty after full ladder:** same empty card with the live-search
  CTA inline ("No cached postings for *[Title]* in *[Country]*. Search live →").
- **Error:** module hides silently. Error logged via Convex dashboard. The article
  must remain readable; this module is supplementary, never load-bearing.

## Cross-feature impact (Discover / Career Compass)

Per CLAUDE.md cross-feature rule:

- **Profiles, profile embeddings, career guides, career guide embeddings, matching
  pipeline, embedding model:** untouched. No `discover_canvas` recompute needed.
- **`job_postings.gps` denormalization:** forward-compatible. A future Career Compass
  enhancement ("jobs near my discovered roles") gets free use of this field without
  another migration. Out of scope for this spec.

## Open questions / tunables

These are v1 defaults that are easy to tune once we have data; not blockers for
shipping.

| Tunable | v1 default | Where defined |
|---|---|---|
| Radius rung | 50 km | `convex/jobsForGuide.ts` constant |
| `MAX_LADDER_CANDIDATES` | 200 | `convex/jobsForGuide.ts` constant |
| Anonymous limit | 5 (3 visible + 2 blurred) | `JobsForGuide.tsx` prop default |
| Signed-in limit | 12 | `JobsForGuide.tsx` prop default |
| Quota: per-archetype-per-hour | 5 | `convex/jobsForGuide.ts` constant |
| Quota: per-user-per-day | 20 | `convex/jobsForGuide.ts` constant |
| Stale-cache threshold for "Search live" CTA prominence | always visible (signed-in only) | `JobsForGuide.tsx`; revisit if it's noisy |

## Verification

End-to-end verification before declaring done (per `.claude/rules/convex-patterns.md`
and `.claude/rules/ui-quality.md`):

1. **Convex perf audit:** run `convex-performance-audit` against `convex/jobsForGuide.ts`
   and the modified `upsertFromSearch` path. The new query reads at most
   `MAX_LADDER_CANDIDATES` (200) rows per call; verify reads in the Convex dashboard
   stay within budget for high-traffic guide pages.
2. **`/audit` on the rendered module** at three representative guide pages (popular
   role, niche role, role with empty cache) across mobile (375 px) and desktop
   (1280 px). Address all P0/P1 issues.
3. **Manual viewer-state walk:**
   - Anonymous, IP-derived city with cache hit → see 3 + 2 blurred + sign-in CTA.
   - Anonymous, IP-derived city with empty cache → see stub.
   - Signed-in without profile → see distance-ranked cards + "complete profile" nudge.
   - Signed-in with profile, cache hit → see fit pills resolved + live-search CTA.
   - Signed-in with profile, cache empty → see empty state + live-search CTA;
     verify quota enforcement after 5 rapid-fire searches.
4. **Migration drill (dev backend `pleasant-pigeon-988`):** run the widen step,
   verify schema accepts both shapes; run backfill; verify `gps` coverage ≥ 99 %;
   run narrow step.
5. **Typecheck + tests pass.** New helper functions
   (`applyLocationLadder`, Haversine, quota check) get unit tests under `lib/jobs/`
   or `convex/jobsForGuide.test.ts`.
