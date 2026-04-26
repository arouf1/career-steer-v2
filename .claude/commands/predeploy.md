---
description: Pre-deploy gate — Convex perf audit + Impeccable UI audit + typecheck + tests + dev smoke + Vercel preview deploy. Blocks if any audit flags issues.
---

# /predeploy

Run before every preview deploy. The point is to catch Convex read amplification, design regressions, and broken types before they reach Vercel — not after.

## Steps

Run **in this order**. If any step flags a real issue, fix it before continuing — do not paper over warnings.

1. **Convex performance audit.** Invoke `convex-performance-audit` on every changed file under `convex/`. Block on:
   - Hot-path query reading > 1 KB per request without an index.
   - Mutation that triggers > 5 cascading reads.
   - Subscription that re-fires on writes to fields the UI does not consume.

2. **Impeccable UI audit.** For every changed file under `app/**` or `components/**` that produces visible UI, run `/audit` against the touched component or flow. Block on any "must-fix" items it flags. Run `/polish` for any rough-edged AI-generated component before audit. (`/audit` and `/polish` are pinned project shortcuts; `/impeccable audit` and `/impeccable polish` work identically.)

3. **Typecheck.** `pnpm typecheck` (or `npm run typecheck`). No errors.

4. **Tests.** `pnpm test` (or `npm test`). All passing. If a test was added in this PR, confirm it actually fails before the implementation by reverting the impl temporarily — TDD discipline.

5. **Dev smoke.** Start `pnpm dev` (or `npm run dev`), open the affected pages in a real browser via `vercel-plugin:verification`, click through the golden path and one edge case, watch the network tab for 500s, watch the Convex dashboard for OCC retries.

6. **Preview deploy.** Invoke `vercel-plugin:deploy` (preview, not prod). Confirm the preview URL loads, the smoke flow works on the deployed build, and there are no cold-start errors in Vercel logs.

7. **Close out.** Apply `superpowers:verification-before-completion` discipline before claiming the deploy is done. Evidence (commands run + outputs) before assertions.

## Operating reminders

- **Claude is the primary developer.** Run every step yourself. Do not stop at "now you can deploy."
- **Latest versions.** If `vercel`, `convex`, or any Next.js dep has been bumped in this PR, verify `npm view <pkg> version` matches what was installed.
