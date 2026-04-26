---
name: Convex patterns (career-steer-v2)
description: Read before editing anything under convex/. Two unskippable gates plus standing reminders for query/mutation/schema discipline.
appliesTo: convex/**
---

# Convex patterns — read before editing convex/**

## Unskippable gates

1. **Schema changes go through `convex-migration-helper`.** Any edit to `convex/schema.ts`, any new table, any field add/remove/rename, any index change → invoke `convex-migration-helper` first (or run `/convex-migrate`). Never edit `schema.ts` by hand and deploy.

2. **`convex-performance-audit` runs before "done."** Any feature that touched `convex/` is not done until `convex-performance-audit` has run on the changed files and any flagged issues are addressed. This is a precondition of `superpowers:verification-before-completion` for this project.

## Standing reminders

- **Convex actions are the default for server logic.** Anything that reads/writes Convex data, calls an external API (AI providers, webhooks, third-party services), or runs business logic should be a Convex `action` (or `mutation`/`query` for pure DB ops). Do **not** reach for Next.js Route Handlers, Server Actions, or `app/api/**` unless there is a Convex-specific blocker. The narrow legitimate exceptions: (a) HTTP streaming responses to the browser (e.g. `streamText` to a UI chat — Convex actions can't easily stream HTTP), and (b) third-party webhooks that need raw request bytes for signature verification (and even then, prefer `convex/http.ts` HTTP actions first). When unsure, write the Convex action and call it from the client; the data is closer, the auth gate is one line, and the observability lands in the Convex dashboard automatically.
- **Auth check first.** Every query, mutation, and action that requires a user starts with `const identity = await ctx.auth.getUserIdentity()`. If `identity == null`, throw — do not silently fall through. Internal/system calls that bypass this are explicitly named `internal*` and use `internalQuery` / `internalMutation`.
- **Indexes over filters.** `.withIndex(...)` for any query that filters on a field. `.filter(...)` is for transformations only, not for narrowing the result set. If you find yourself filtering on a field that isn't indexed, add the index in the same PR.
- **One file per domain.** `users.ts`, `jobs.ts`, `coaching.ts`, etc. Don't pile unrelated functions into a "utils" or "shared" file. If logic is genuinely shared, factor it into a Convex component (`convex-create-component`).
- **Validators always.** Every public function uses `args` validators (`v.string()`, `v.id("users")`, etc.). No untyped `any` shapes crossing the boundary.
- **No `npx convex dev` in scripts without `--once`.** It runs as a daemon by default and will hang CI / pre-commit hooks.
- **Hot-path mutations to watch.** `coaching_threads.append_message`, `applications.update_status`, `resume_versions.publish` — any change here needs OCC consideration (use `ConvexError` for retryable conflicts, document the retry strategy).
- **Read the official docs.** Training-data Convex API knowledge is stale. Before writing anything non-trivial, check the current docs via the `convex` skill or https://docs.convex.dev.

## When in doubt

Invoke the `convex` router skill — it picks the right specialized skill for the task at hand.
