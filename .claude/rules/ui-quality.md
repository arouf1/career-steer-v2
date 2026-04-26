---
name: UI quality (career-steer-v2)
description: Read before editing app/** or components/**. Visible UI is gated on /audit. shadcn primitives over custom CSS, Tailwind tokens over magic numbers.
appliesTo: app/**, components/**
---

# UI quality — read before editing app/** or components/**

career-steer-v2 is B2C SaaS. UI quality directly affects trust, conversion, and retention. This rule treats design discipline like type safety — non-optional.

## Unskippable gate

**Any visible UI change is not done until `/audit` has run on the touched component or flow and any "must-fix" items are addressed.** This is a precondition of `superpowers:verification-before-completion` for `app/**` and `components/**`.

For LLM-generated or rough-in components: run `/polish` *before* the audit. Polish first, audit second, ship third.

## One-time project setup

After the Next.js scaffold lands (so the repo has README, `package.json`, `tailwind.config.*`, and any seed components):

1. `/impeccable teach` — interview-driven; produces `PRODUCT.md` (audience, brand personality, design principles).
2. `/impeccable document` — code-driven; produces `DESIGN.md` (visual tokens, component snippets) + `DESIGN.json` sidecar.

Every other Impeccable command reads these two files before doing real work. Without them, audits and polishes start cold and produce generic output.

## Standing reminders

- **shadcn primitives over custom CSS.** Buttons, inputs, dialogs, dropdowns, sheets — install from shadcn (use `vercel-plugin:shadcn`) before writing your own. Custom CSS is a last resort, not a first move.
- **Tailwind tokens over magic numbers.** `gap-4`, not `gap-[17px]`. `text-sm`, not `text-[13.5px]`. If a token doesn't exist, extend the theme — don't sprinkle one-off values.
- **Server Components by default.** Make a component `'use client'` only when it actually needs hooks, event handlers, or browser APIs. Lift `'use client'` to the smallest leaf possible.
- **No raw `<img>`.** Use `next/image`. Always specify `width`, `height`, and `alt`.
- **Empty / loading / error states are part of "done."** Every async surface gets all three. Skeleton on load, friendly empty state, recoverable error state.
- **Type-safe routes.** Use `next` typed routes — never hand-format URLs as strings.
- **Mobile first.** Default to mobile layout, layer up via `md:`, `lg:`. Test at 375px before declaring anything done.

## Impeccable v3 command map

Pinned shortcuts (project-level): `/audit`, `/polish`, `/critique`. All other commands run as `/impeccable <name>`.

| Trigger | Command |
|---|---|
| One-time: gather brand / product context | `/impeccable teach` |
| One-time / refresh: generate visual DESIGN.md | `/impeccable document` |
| Plan a feature's UX before building | `/impeccable shape` |
| Full feature: shape → load refs → build with visual iteration | `/impeccable craft` |
| Final pass before shipping | `/polish` |
| a11y / performance / responsive technical audit | `/audit` |
| Hierarchy, clarity, emotional review | `/critique` |
| Typography problems | `/impeccable typeset` |
| Layout, spacing, visual rhythm | `/impeccable layout` |
| Strip to essence | `/impeccable distill` |
| Performance | `/impeccable optimize` |
| Error handling / edge cases / i18n | `/impeccable harden` |
| Motion / animation | `/impeccable animate` |
| Color strategy | `/impeccable colorize` |
| Onboarding flow | `/impeccable onboard` |
| Pull into reusable components | `/impeccable extract` |
| Adapt across devices | `/impeccable adapt` |
| Improve unclear copy | `/impeccable clarify` |
| Amplify too-quiet design | `/impeccable bolder` |
| Tone down too-loud design | `/impeccable quieter` |
| Add joy | `/impeccable delight` |
| Technically extraordinary effects | `/impeccable overdrive` |

To pin more shortcuts later: `node .claude/skills/impeccable/scripts/pin.mjs pin <command>`.

## When in doubt

Invoke `vercel-plugin:shadcn` for component-level questions, or run `/critique <file>` and let it tell you what's off.
