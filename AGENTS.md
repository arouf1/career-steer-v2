<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

<!-- BEGIN:design-context -->
## Design context

This project carries a documented design system. **Read both files before any UI work.**

- `PRODUCT.md` — strategic context: register (`product`), user archetypes, brand personality (Editorial · Warm · Considered), anti-references, design principles, accessibility defaults.
- `DESIGN.md` — visual system: OKLCH color tokens, EB Garamond + Figtree typography stack, six-section spec (Overview / Colors / Typography / Elevation / Components / Do's & Don'ts), Named Rules.
- `DESIGN.json` — sidecar with tonal ramps, motion tokens, breakpoints, and self-contained component HTML/CSS.

Loader: `node .claude/skills/impeccable/scripts/load-context.mjs` returns both as JSON.

Use `/impeccable` commands (`/audit`, `/polish`, `/critique`, `/impeccable craft <feature>`) — they read these files first.

Two non-negotiable visual rules also live in `.claude/rules/ui-quality.md`:
- **No emoji in UI.** All icons import from `lucide-react` or `lucide-animated`. No other icon libraries.
- **No `#fff` / `#000`.** Tinted neutrals only — paper hue range (70–85° in OKLCH).
<!-- END:design-context -->
