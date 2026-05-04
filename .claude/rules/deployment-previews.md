---
name: Convex preview deployments (career-steer-v2)
description: Read before editing vercel.json/vercel.ts, convex/crons.ts, .github/workflows/**, or before considering whether to enable a Convex preview backend for a branch. Codifies the V1 incident lesson — random preview backends silently burn paid-API credits via inherited crons.
appliesTo: vercel.json, vercel.ts, convex/crons.ts, convex/lib/env.ts, .github/workflows/**
---

# Convex preview deployments — read before touching deploy config or considering a preview

## The incident this rule prevents

In V1 (`/Users/aqilrouf/Documents/Projects/career-steer`), `vercel.json` carried:

```
if [ -n "$CONVEX_DEPLOY_KEY" ]; then npx convex deploy --cmd 'npm run build'; else npm run build; fi
```

`CONVEX_DEPLOY_KEY` was set unconditionally on Vercel's **Preview** scope. Every PR/branch push provisioned a fresh Convex preview backend. Each backend:

1. Got its own `_scheduled_functions` table — running the cron code from that commit.
2. Inherited every Convex env var (Exa, OpenRouter, OpenAI, Gemini, Resend) at create time.
3. Kept running long after its branch was abandoned. Convex does not auto-prune previews on a useful timeline.

Seven preview backends piled up over 9 days. They kept firing the V1 `Check Job Posting Activity` (every 2h) and `Discover Jobs from Archetypes` (hourly) crons against Exa + OpenRouter, silently burning paid-API credits. The kill switches applied to dev + prod did **not** propagate. The Convex CLI cannot push code or strip env vars on a preview without a preview-scoped deploy key, and the management API does not expose preview deletion to user-token auth — so the only cleanup path was clicking "Delete deployment" in the dashboard, seven times.

## Default policy: NO preview Convex backends

**Do not set `CONVEX_DEPLOY_KEY` on Vercel Preview scope.** PRs and branch deployments point at the existing dev backend (`pleasant-pigeon-988`) via `NEXT_PUBLIC_CONVEX_URL` — preview-scoped, identical for every branch.

This means:
- Every PR shares the same Convex data + schema + functions
- Schema changes must be tested locally (or in a deliberately-opted-in preview, see below) before opening the PR
- Real-time multi-user collisions during PR review are extremely rare in our flow; if they happen, that's the signal to opt in for the duration of that PR

The `convex-migration-helper` skill enforces the widen-migrate-narrow pattern, which is shared-backend-safe. Use it.

## Opt-in: how to deliberately spawn a preview backend for one branch

Only when a branch genuinely needs an isolated Convex backend (destructive schema change you can't widen-narrow, third-party integration test that mutates external state):

```bash
# Add CONVEX_DEPLOY_KEY scoped to ONE git branch, not all of preview
vercel env add CONVEX_DEPLOY_KEY preview --git-branch=feat/specific-branch
```

Then ensure the branch's PR description includes a checklist:

- [ ] Convex preview backend opted-in via `vercel env add ... --git-branch=...`
- [ ] On merge or close: delete the preview backend in the Convex dashboard
- [ ] On merge or close: `vercel env rm CONVEX_DEPLOY_KEY preview --git-branch=feat/specific-branch`

There is no automated cleanup. The dashboard click is the source of truth.

## Cron self-defense (registration-time guard)

`convex/crons.ts` must wrap every registration in a deployment allow-list. The allow-list lives in `convex/lib/env.ts`:

```ts
// convex/lib/env.ts
const PROD_DEPLOYMENT = "striped-narwhal-926";
const DEV_DEPLOYMENT = "pleasant-pigeon-988";

export function isCronAllowedDeployment(): boolean {
  const url = process.env.CONVEX_CLOUD_URL ?? "";
  return url.includes(PROD_DEPLOYMENT) || url.includes(DEV_DEPLOYMENT);
}
```

```ts
// convex/crons.ts
import { isCronAllowedDeployment } from "./lib/env";

const crons = cronJobs();

if (isCronAllowedDeployment()) {
  crons.interval("retry failed career guides", { minutes: 30 }, internal.careerGuides._retryFailedGuides);
  // ... rest of registrations
}

export default crons;
```

Why allow-list and not deny-list: the only signal Convex auto-sets is `CONVEX_CLOUD_URL`. Allow-listing the two known good deployments means any new preview gets no crons scheduled at all — no `_scheduled_functions` rows, no spend possible. New environments (staging, canary, etc.) need an explicit add to the allow-list, which is a feature, not a bug.

If you add a new "permanent" deployment (rare), update `convex/lib/env.ts` first.

## Defense-in-depth: per-handler guards (optional but recommended)

The registration-time guard is sufficient — un-registered crons cannot fire. But for new actions where you want belt-and-suspenders (e.g. an action also invoked from outside the cron, or scheduled manually via `ctx.scheduler.runAfter`), add the same check inside the handler:

```ts
export const _retryFailedGuides = internalAction({
  handler: async (ctx) => {
    if (!isCronAllowedDeployment()) {
      console.log("[CRON] skipped on non-allow-listed deployment");
      return null;
    }
    // ...real work
  },
});
```

## Vercel env scoping for paid API keys

Even with the above in place, baseline hygiene: in Vercel, paid API keys (`EXA_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`) are **Production scope only**. Never Preview, never Development.

Preview branch builds inherit these from Convex env (set on the prod/dev backend that previews share via Layer 1). Locally, `.env.local` carries them for `npx convex dev`. There is no legitimate reason for Vercel itself to expose paid keys to a preview build.

## Runbook: stray preview detected

If a preview backend appears unexpectedly (e.g. someone on the team spawned one without following the opt-in flow):

1. Capture its URL/name from https://dashboard.convex.dev/
2. Identify the originating branch (Convex preview names mirror the git branch with `/` → `-`)
3. Delete via dashboard → Settings → Delete Deployment
4. Audit Vercel env: `vercel env ls preview` — if `CONVEX_DEPLOY_KEY` is unscoped (no `--git-branch`), remove it (`vercel env rm CONVEX_DEPLOY_KEY preview --yes`)
5. Audit Vercel env for paid API keys on Preview scope; remove any
6. Post-mortem the spawn — was the opt-in flow not followed? Update onboarding/CLAUDE.md if a process gap exists

## See also

- `.claude/rules/convex-patterns.md` — broader Convex discipline (auth gates, indexes, migration helper)
- V1 `convex/lib/cronThrottle.ts` (`shouldSkipCron`) — same guard-pattern shape, different signal (cadence throttling vs. deployment allow-list)
