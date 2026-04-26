# Resume upload + parse to Convex profiles

**Status:** spec, awaiting plan
**Date:** 2026-04-26
**Owner:** Claude (primary developer)
**Source brand context:** [`PRODUCT.md`](../../../PRODUCT.md) · [`DESIGN.md`](../../../DESIGN.md)

---

## 1. Context

career-steer-v2 is a B2C AI career coach + job-search/matching MVP. The first user-visible feature has to deliver one thing: turn a person's actual experience into structured data the rest of the app (coaching chat, role matching, narrative editing) can use. Without a parsed profile, every downstream feature is gated on the user typing their work history into a form — a non-starter for the tone PRODUCT.md sets ("treat the career like a story worth telling, not a record to be processed").

This spec covers v1 of resume upload + parse to a Convex `profiles` table. It does **not** cover coaching chat, role matching, or any other surface that consumes the profile.

## 2. Scope (v1)

### In

- Upload a `.pdf` or `.docx` resume (≤ 5 MB).
- Extract plain text in the browser.
- Send text to a Convex action that calls OpenRouter + AI SDK `generateText({ output: Output.object({ schema }) })`.
- Persist a single `profiles` row per user (overwrite on re-upload).
- Show a structured profile view; banner the user toward review/edit.
- Edit form mirroring the schema; "Looks good" flips a `reviewed` flag.
- Designed visual layer that follows `DESIGN.md` (paper/ink/hairline tokens, EB Garamond + Figtree, lucide icons, no emoji).
- Empty / loading / error states designed deliberately, not as defaults.

### Out (deferred)

- LinkedIn import (OAuth or URL paste). The home-page mockup's LinkedIn tab stays visible as a non-functional placeholder — clicking it does nothing in v1. Wired later as a separate, post-MVP feature. PRODUCT.md's anti-references confirm we should not literally mimic LinkedIn UX, but signalling the integration intent on the upload card is fine.
- Image / screenshot input (Claude vision is viable but a v1.5 feature).
- Versioning / resume history.
- Account-deletion cascade (waits for the Clerk → Convex user webhook).
- Re-parse-with-better-model action (we keep `rawText`; build the action when needed).
- Profile-derived embeddings for matching.

## 3. Architecture

```
Browser /profile
  ├─ <UploadCard/>                                  (only when no profile exists)
  │     pdfjs-dist | mammoth → plain text
  │           ↓
  └─ Convex action profiles.parseUpload({ text, sourceFormat })
        ↓
        createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })
        openrouter.chat(<live model id, looked up at write-time>)
        generateText({ output: Output.object({ schema: ProfileSchema }), prompt })
        ↓
        ctx.runMutation(internal.profiles.upsert, { ...output, rawText, sourceFormat })
        ↓
  ← reactivity via useQuery(api.profiles.current)
        ↓
  <ProfileView/> + <ReviewCallout/> (until user marks reviewed)
```

Browser-side text extraction is the chosen path because it keeps the action signature simple, avoids large binary args to Convex, and unifies PDF + DOCX into one downstream code path. The ~150 KB extra client bundle (`pdfjs-dist` + `mammoth`) is lazy-loaded only on `/profile`.

## 4. Schema — `convex/schema.ts` (additive, new table)

```ts
profiles: defineTable({
  userId: v.id("users"),
  sourceFormat: v.union(v.literal("pdf"), v.literal("docx")),
  rawText: v.string(),
  parsedAt: v.number(),
  reviewed: v.boolean(),
  rateLimit: v.object({
    countInWindow: v.number(),    // successful parses in the current 24h window
    windowStartedAt: v.number(),  // unix ms; rolls forward when window elapses
  }),
  // structured
  name: v.optional(v.string()),
  headline: v.optional(v.string()),
  summary: v.optional(v.string()),
  location: v.optional(v.string()),
  experience: v.array(v.object({
    title: v.string(),
    company: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    description: v.optional(v.string()),
  })),
  education: v.array(v.object({
    school: v.string(),
    degree: v.optional(v.string()),
    field: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  })),
  skills: v.array(v.string()),
}).index("by_userId", ["userId"])
```

One row per user. Re-upload overwrites. **No data migration needed** (new table, fresh rows) — `/convex-migrate` skipped intentionally; the widen-migrate-narrow flow does not apply to net-new tables.

## 5. Convex functions — `convex/profiles.ts`

| Kind | Name | Purpose |
|---|---|---|
| `query` | `current()` | Returns the user's profile row or `null`. Auth-gated. |
| `action` | `parseUpload({ text, sourceFormat })` | OpenRouter call + upsert. Auth-gated, rate-limit-gated. Returns `{ ok: true } \| { ok: false, error }`. |
| `mutation` | `update({ patch })` | Partial update from review form. Auth-gated; can only update own row. |
| `mutation` | `markReviewed()` | Flips `reviewed: true`. |
| `mutation` | `clear()` | Deletes the user's profile (so they can re-upload cleanly). |
| `internalMutation` | `upsert({ data })` | Insert or replace. Only callable from `parseUpload`. |

All public functions begin with `await ctx.auth.getUserIdentity()`; null → throw. Internal functions are `internal*` and unreachable from clients.

`ProfileSchema` (the Zod schema passed to `Output.object`) lives in `lib/server/profile-schema.ts` and mirrors §4 exactly. The same module exports a TypeScript type derived from it so the action and the edit form share one source of truth. Convex `v.*` validators and the Zod schema are kept in lockstep manually for now; if drift becomes a problem we can codegen one from the other later.

## 6. UI surfaces

### Route

- `app/profile/page.tsx` — gated on `<Authenticated>`. Reads `useQuery(api.profiles.current)`. Renders `<UploadCard/>` if `null`, otherwise `<ProfileView/>` + (conditionally) `<ReviewCallout/>`.
- `app/page.tsx` — landing stays as-is. Authenticated users still see it; the existing nav/CTA leads them to `/profile`. (No redirect — landing is the marketing surface; `/profile` is the app surface.)

### Components — `components/profile/*`

All components compose primitives defined in `DESIGN.md` (warm-paper palette, EB Garamond + Figtree pairing, hairline bullet pattern, segmented toggle, card recipe). No custom CSS unless `DESIGN.md` doesn't have a primitive for it; emoji never appear; all icons are from `lucide-react`.

- `UploadCard.tsx` — drag-drop + click. Validates `.pdf`/`.docx`, ≤ 5 MB. Lazy-imports `pdfjs-dist` and `mammoth`. Surfaces a designed loading state during the call.
- `ProfileView.tsx` — read-only structured display: header (name, headline, location), then sections for Experience, Education, Skills. Edit affordance.
- `ProfileEditForm.tsx` — controlled form mirroring the schema. Save → `update({ patch })` then `markReviewed()`.
- `ReviewCallout.tsx` — visible while `reviewed === false`. Composition of design-system primitives (hairline-bullet treatment + card), not a generic notification banner. Actions: [Looks right] [Edit] [Re-upload].

### Visual design

The visual layer is **not dictated in this spec**. Before implementation, run `/impeccable shape resume-upload-+-review-flow` to produce a brief that loads the right `DESIGN.md` references and grounds component composition in the brand. The implementation builds against that brief, not against my ad-hoc descriptions here.

### States are part of "done"

Every async surface gets all three. This is enforced by `.claude/rules/ui-quality.md` and PRODUCT.md design principle 5 ("Made, not generated").

| State | Surface |
|---|---|
| Empty | `/profile` with no profile yet — the upload card *is* the empty state, designed to feel deliberate. |
| Loading | While `parseUpload` is in-flight: editorial copy, not a generic spinner. Approx 5–15 s. |
| Error | Per failure mode (see §8). Each one composed from primitives, not a default toast. |
| Success | Profile renders with `<ReviewCallout/>` on top until the user confirms. |

## 7. Voice & copy guidance

PRODUCT.md is the source of truth. The voice is **editorial · warm · considered**. Concrete translations of states our spec touches:

| Context | Avoid (chatbot/recruiter) | Use (editorial) |
|---|---|---|
| Loading after upload | "Parsing your resume… ~10s" | "Reading your résumé. About ten seconds." |
| Review prompt | "We extracted X fields — review them now." | "Here's what we noticed in your résumé. Tell us what we got wrong." |
| Generic parse fail | "Parsing failed. Try again." | "We couldn't read this one — sometimes scanned PDFs don't carry text. Try exporting a fresh copy." |
| File too big | "File exceeds 5MB limit." | "That file's a bit large. Try a copy under 5 MB." |
| Rate limit | "Limit reached." | "You've parsed five résumés today. Take a breath; tomorrow we'll be ready again." |
| Save success | "Saved!" | (silent — the data is there; UI reflects truth) |

Implementation can refine these but must not regress them toward platform-y / chatbot tone. `/critique` will flag regressions during the audit gate.

## 8. Error handling

| Failure | UX |
|---|---|
| Wrong file type | Inline form-state error before the action is called. Editorial copy. |
| File > 5 MB | Same. |
| Browser-side extraction error (pdfjs / mammoth throws) | "We couldn't read this file. It might be a scan — try exporting a fresh PDF." |
| OpenRouter HTTP error | Action returns `{ ok: false, error: 'upstream' }`. UI shows recoverable error state with retry. |
| `NoObjectGeneratedError` (schema validation fails) | Same retry UX. Convex log captures `rawText.length` only — never the content. |
| Rate limit hit | Retry blocked until the next day, with the editorial copy from §7. |

## 9. Cost / privacy guardrails

- File size cap: 5 MB on the client; action also rejects if `rawText.length > 200_000` (≈ 50 K tokens).
- Rate limit: 5 parses / user / 24 h. Enforced in the action via the `rateLimit` object on the profile row: if `now - windowStartedAt > 24h`, reset (`countInWindow = 1`, `windowStartedAt = now`); otherwise check `countInWindow < 5` and increment. (Note: we can't enforce via `parsedAt` history because the profile row is overwritten on each parse — there's only ever one timestamp.) Future: extract into a dedicated `rate_limits` table when we have more rate-limited surfaces.
- OpenRouter zero-data-retention: enabled via the appropriate request headers. Exact header name verified against current OpenRouter docs at write-time, not from memory.
- Server logs: `console.log` and Convex logs never include `rawText` content; only its length and the success/failure result.
- Account-deletion cascade: deferred to when the Clerk → Convex user webhook is implemented. Add a TODO in `users.ts` referencing this spec.

## 10. Testing

- **Unit** — `ProfileSchema` (Zod) round-trip with synthetic JSON: missing fields, edge dates, empty arrays, malformed AI output.
- **Unit** — client extraction wrappers: mock `File` → expected text. Tests for malformed PDF, malformed DOCX, oversized file rejection.
- **Integration** — Convex action with stubbed OpenRouter response (use `convex-test`). Verify auth gate, rate-limit gate, upsert side-effect, error path.
- **Smoke** — `pnpm dev`, upload a known-good résumé, eyeball the result.
- **UI quality gate** — `/audit /profile` per `.claude/rules/ui-quality.md`. Block on any "must-fix" item.
- **Convex performance gate** — `convex-performance-audit` per `.claude/rules/convex-patterns.md`. Block on any flagged hot-path issue.

## 11. New dependencies

All pinned to npm-registry latest at install time (per the operating principle).

| Package | Purpose | Where |
|---|---|---|
| `pdfjs-dist` | PDF → text in browser | `dependencies` |
| `mammoth` | DOCX → text in browser | `dependencies` |
| `convex-test` | Convex action integration tests | `devDependencies` |

`ai`, `@openrouter/ai-sdk-provider`, `zod`, `convex`, `@clerk/nextjs` already installed.

## 12. Pre-implementation steps

Before writing UI code:

1. Run `/impeccable shape resume-upload-+-review-flow` to produce a UX brief that grounds component composition in `DESIGN.md`. Save the brief to `docs/superpowers/shapes/`.
2. Look up the current OpenRouter model ID for résumé parsing (Claude family preferred for structured extraction). Do not hard-code from memory.

Before declaring done:

1. `pnpm typecheck` clean.
2. `convex-performance-audit` on any changed `convex/` file (per project rule).
3. `/audit /profile` clean of must-fix items.
4. `/polish` on `<UploadCard/>`, `<ProfileView/>`, `<ProfileEditForm/>`, `<ReviewCallout/>`.
5. `superpowers:verification-before-completion` discipline — evidence (commands run + outputs), not assertions.

## 13. Follow-ups (not part of this spec)

- Update `app/page.tsx` UploadPreview copy: drop the "image screenshots" mention. Keep the LinkedIn tab as a non-functional placeholder — the user has explicitly decided this. The tab stays visible (it signals product direction) but clicking it does nothing in v1; we'll wire LinkedIn OAuth as a separate, post-MVP feature.
- Account-deletion cascade once Clerk webhook lands.
- Profile-derived embeddings once a matching feature is real.
