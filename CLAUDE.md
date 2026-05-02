# career-steer-v2

## Mission

B2C AI career coach + job-search/matching tool. MVP focuses on (1) personal career coaching — skill assessment, transition planning, interview prep — and (2) resume optimization / role matching. Other directions (B2B internal mobility, cohort communities) are deliberately out of MVP scope but the architecture should not actively block them.

## V1 reference

If — and only if — the user explicitly refers to "V1" of this app (e.g. "look at v1 of this app", "how did v1 do X", "check v1"), the V1 codebase lives at `/Users/aqilrouf/Documents/Projects/career-steer`. Read from there for reference; never write to it. Do not consult V1 unless the user explicitly invokes it.

## Operating principles (non-negotiable)

1. **Claude is the primary developer.** All implementation work — coding, schema changes, deploys, debugging, verification — is done by Claude. The user is the product owner. Never propose stopping early, never hand routine engineering decisions back. Capacity is unlimited.
2. **Latest versions only, verified at install time.** Before any `npm install` / `pnpm add` / dep bump, run `npm view <pkg> version` and pin to the latest stable. Never use a version pulled from training-data memory. This applies to *every* package, every time.

## Tech stack

- **Frontend:** Next.js (App Router, latest)
- **Backend:** Convex (functions, schema, realtime)
- **Auth:** Clerk (via Vercel Marketplace integration)
- **AI:** Vercel AI SDK + OpenRouter (provider routing)
- **Retrieval:** Exa
- **UI:** shadcn/ui + Tailwind, Impeccable skill for design discipline
- **Deploy:** Vercel (Fluid Compute — no Edge runtime)

**Critical:** Training-data knowledge of Convex, AI SDK, and Next.js is stale. **Always read the official docs before writing code in these areas** — the relevant skills (below) point at current docs.

## Conventions

```
career-steer-v2/
├── app/                     # Next.js App Router
├── components/              # Shared UI (shadcn primitives + composed)
├── convex/                  # Convex schema + functions (one file per domain)
│   ├── schema.ts
│   ├── users.ts
│   ├── jobs.ts
│   └── ...
├── lib/
│   ├── server/              # Server-only utilities (never imported by client)
│   └── client/              # Client-side utilities
├── public/
└── CLAUDE.md                # this file
```

- One Convex file per domain (`users.ts`, `jobs.ts`, `coaching.ts`, …).
- Server actions live in `app/<route>/actions.ts`.
- Never put auth state in client-only stores (Zustand, etc.) — Clerk is the source of truth.

## Reuse before build

This environment has many skills already installed via plugins. **Use them — do not re-implement what they cover.**

### Convex

| Trigger phrase | Skill to invoke |
|---|---|
| "set up Convex from scratch" | `convex-quickstart` |
| "add login" / "sign in" / "who is logged in" / "protect this route" | `convex-setup-auth` |
| "new collection" / "add field" / "change schema" / "rename table" | `convex-migration-helper` |
| "slow query" / "OCC conflict" / "high read bytes" / "subscription cost" | `convex-performance-audit` |
| "reusable backend module" / "third-party integration" | `convex-create-component` |
| "which Convex thing should I use" | `convex` (router) |

### Next.js / Vercel

| Trigger phrase | Skill to invoke |
|---|---|
| Anything App Router / Server Components / Server Actions | `vercel-plugin:nextjs` |
| AI features — chat, streaming, structured output, tool calling | `vercel-plugin:ai-sdk` |
| Provider routing, fallback, model selection | `vercel-plugin:ai-gateway` |
| Deploy, preview, rollback, CI | `vercel-plugin:deployments-cicd` |
| Env vars, OIDC tokens, `.env` | `vercel-plugin:env-vars` |
| shadcn install / compose / theme | `vercel-plugin:shadcn` |

### Process

| Trigger | Skill |
|---|---|
| "build a feature" (anything new) | `superpowers:brainstorming` → `writing-plans` → `executing-plans` |
| Bug, test failure, unexpected behavior | `superpowers:systematic-debugging` |
| Implementing logic with branches | `superpowers:test-driven-development` |
| Before claiming "done" | `superpowers:verification-before-completion` |

### Design / UI quality (Impeccable v3, installed)

Commands are sub-commands of `/impeccable`. Three are pinned as project-level shortcuts: `/audit`, `/polish`, `/critique`. Use either form interchangeably.

| Trigger phrase | Command |
|---|---|
| First time on this project — gather brand/product context | `/impeccable teach` (run once after scaffold exists) |
| Generate / refresh DESIGN.md (visual tokens, components) | `/impeccable document` |
| Plan a feature's UX before building | `/impeccable shape` |
| Full feature flow with visual iteration | `/impeccable craft` |
| "polish" / "clean up" / "final pass before shipping" | `/polish` (or `/impeccable polish`) |
| a11y / performance / responsive technical audit | `/audit` (or `/impeccable audit`) |
| "is this good?" / hierarchy / clarity review | `/critique` (or `/impeccable critique`) |
| Typography problems | `/impeccable typeset` |
| Layout, spacing, rhythm | `/impeccable layout` |
| Strip to essence | `/impeccable distill` |
| Performance | `/impeccable optimize` |
| Error handling / edge cases / i18n | `/impeccable harden` |
| Motion / animation | `/impeccable animate` |
| Color strategy | `/impeccable colorize` |
| Onboarding flow | `/impeccable onboard` |
| Pull into reusable components | `/impeccable extract` |
| Adapt across devices | `/impeccable adapt` |
| Improve unclear copy | `/impeccable clarify` |

Other commands: `/impeccable bolder`, `/impeccable quieter`, `/impeccable delight`, `/impeccable overdrive`. Backbone skill: `frontend-design` auto-loads on UI work.

## Workflows (custom slash commands)

- `/spec-plan-implement` — full feature flow (brainstorm → plan → execute with TDD).
- `/convex-migrate` — safe schema/data migration via `convex-migration-helper` + project specifics.
- `/predeploy` — audit (Convex perf + `/audit`) → typecheck → tests → dev smoke → preview deploy.
- `/standup` — git log + open TODOs + Convex deploy log summary.

## Path-based rules

Before editing files in these areas, read the corresponding rule file:

- Editing `convex/**` → read `.claude/rules/convex-patterns.md` (auth gates + migration discipline)
- Editing `proxy.ts` / auth flows → read `.claude/rules/auth-security.md` (Next 16 renamed `middleware.ts` → `proxy.ts`)
- Editing AI features (`app/api/chat`, `lib/ai/**`) → read `.claude/rules/ai-sdk-patterns.md`
- Editing `app/**` or `components/**` (visible UI) → read `.claude/rules/ui-quality.md`

## Cross-feature impact: Discover

`/workspace/discover` is a downstream consumer of the profile + career-guide pipelines. Its `discover_canvas` snapshots are precomputed per user from `profile_embeddings` ↔ `career_guide_embeddings`, lane-classified by `currentStateSim`, and ranked by `arcSim` with a curated mix (strong-fit / skill-bridge / aspirational) per lane. Whenever a change to **profiles, profile embeddings, career guides, career guide embeddings, the matching pipeline, or the embedding model/dimensions** could materially affect what discover shows, you must:

1. Identify whether existing `discover_canvas` snapshots become stale or invalid (e.g. dimension change, facet semantics shift, new signal that should drive lane assignment).
2. Plan a snapshot refresh — incremental for soft changes (re-rank existing slots) or full recompute for hard changes (schema/dimensions/facet semantics).
3. Surface the impact in the change's plan/spec — never ship a profile or guide change without explicitly addressing whether discover needs to re-render.

If unsure whether a change has discover impact, treat it as having impact and plan the recompute.

## Avoid

- **Next.js Route Handlers / Server Actions for server logic** — Convex actions are the default. Reach for `app/api/**` or Server Actions only when there's a Convex-specific blocker (HTTP streaming to the browser, raw-bytes webhook verification). See `.claude/rules/convex-patterns.md`.
- **Edge runtime** — use Fluid Compute (Node.js) on Vercel Functions. Edge has compatibility issues.
- **`vercel.json`** — use `vercel.ts` with `@vercel/config` when configuration is actually needed.
- **Mocking Convex / Clerk in integration tests** — hit the real services. Mocks have lied to us before.
- **`NEXT_PUBLIC_*` for secrets** — anything `NEXT_PUBLIC_` ships to the browser.
- **`npx convex dev` without `--once` in scripts** — leaves daemons running.
- **Pinning package versions from memory** — always `npm view <pkg> version` first.
- **Premature wrap-ups** — see Operating Principle 1.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
