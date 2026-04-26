---
description: Full feature flow — brainstorm requirements, write a plan, execute with TDD. Thin wrapper around superpowers process skills with career-steer-v2 routing.
---

# /spec-plan-implement

End-to-end workflow for building a new feature in career-steer-v2.

## What you will do

1. **Brainstorm.** Invoke `superpowers:brainstorming` to explore intent, requirements, and design with the user. Do not skip this even if the request feels small — the cost of a missed requirement is much higher than the cost of a 5-minute brainstorm.

2. **Plan.** Once requirements are clear, invoke `superpowers:writing-plans` to produce a written implementation plan. **Before finalizing the plan, explicitly answer:**
   - Does this touch `convex/schema.ts` or change a Convex table shape? → invoke `convex-migration-helper` and incorporate its migration plan into the implementation plan.
   - Is this a reusable backend module that should be isolated (auth, billing, search, etc.)? → invoke `convex-create-component` and design it as a Convex component from day one.
   - Does this surface visible UI? → note in the plan that `/audit` is a release gate and `/polish` is a recommended pass after rough-in. For new features that need UX shaping, prefer `/impeccable craft` (full shape → load refs → build with visual iteration).
   - Does this need new AI calls? → invoke `vercel-plugin:ai-sdk` and pin the AI SDK pattern (streamText, generateObject, etc.) in the plan.
   - Does this need retrieval / search? → use Exa via the documented pattern in `.claude/rules/ai-sdk-patterns.md`.

3. **Execute.** Invoke `superpowers:executing-plans`. Use `superpowers:test-driven-development` for any logic with branching/business rules; skip TDD for pure UI scaffolding.

4. **Verify.** Before declaring done, invoke `superpowers:verification-before-completion`. For UI changes: also run `/audit` against the touched component or flow. For Convex changes: also run `convex-performance-audit`.

## Operating reminders

- **Claude is the primary developer.** Run all the verification yourself. Do not ask the user to run tests, deploys, or smoke tests if you can run them.
- **Latest versions.** If this feature needs new dependencies, run `npm view <pkg> version` for each before installing.
- Loop back to step 2 if execution reveals the plan was wrong — replan, don't muddle through.

## Arguments

Pass a one-line feature description: `/spec-plan-implement add resume parsing with Exa`. The brainstorm step will draw the rest of the requirements out.
