---
description: Safe Convex schema/data migration via convex-migration-helper, layered with career-steer-v2 specifics (Clerk-identity FKs, hot-path mutations, rollback checklist).
---

# /convex-migrate

Use this any time `convex/schema.ts` is changing, a field is being added/removed/renamed, a table is being split or merged, or existing documents need backfilling.

## What you will do

1. **Invoke `convex-migration-helper`.** It owns the widen → migrate → narrow workflow and the `@convex-dev/migrations` component. Do not hand-roll a migration.

2. **Layer career-steer-v2 specifics on top of its plan:**
   - **Clerk-identity FKs.** Tables that store `clerkId` or `userId` (Clerk identity foreign keys) at MVP-time include `users`, `sessions`, `coaching_threads`, `resume_versions`, `applications`. (List grows as the app grows — re-check `convex/schema.ts` before each migration.) Any rename or type change to identity columns requires a coordinated Clerk + Convex update; do not migrate one without the other.
   - **Hot-path mutations.** Mutations on `coaching_threads.append_message`, `applications.update_status`, and `resume_versions.publish` are user-blocking. Flag these in the migration plan if affected — OCC retries can compound under load. Consider widening writes before narrowing reads.
   - **AI-derived columns.** Any column populated by an LLM (e.g. resume embeddings, role match scores) needs a backfill strategy that can throttle calls (token cost, rate limits). Default: backfill in batches of 50 via a scheduled mutation, not in a single transaction.

3. **Rollback checklist before applying:**
   - [ ] Schema diff captured (git or `npx convex schema export`).
   - [ ] Backfill is idempotent — running it twice is safe.
   - [ ] Both old and new columns exist during the widen phase (so a deploy revert doesn't break reads).
   - [ ] Read sites updated to the new column behind a feature check, not a hard cutover.
   - [ ] Narrow phase only after at least one full deploy where new column is the source of truth.

4. **Verify.** After applying, run `convex-performance-audit` on the touched tables to confirm no read amplification or new OCC hotspots were introduced.

## Operating reminders

- **Claude is the primary developer.** Apply the migration yourself. Do not ask the user to run `npx convex deploy`.
- **Verify versions.** `npm view convex version` and `npm view @convex-dev/migrations version` before installing or upgrading.
