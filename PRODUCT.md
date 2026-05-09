# Product

## Register

product

## Users

Career Steer is for people in transition. The primary archetypes:

- **Career changers** crossing industries, unsure how their experience translates.
- **Mid-career professionals** on a plateau, looking for what's next without a clear next title.
- **New graduates** entering the market without a strong narrative for what they've done.
- **Laid-off tech workers** processing a sudden gap and needing direction, not just leads.
- **Executives in transition** between roles, often privately, often under pressure.

The shared context: they open the app in a moment of uncertainty. Often after hours. Mixed feelings — hope, fear, frustration, sometimes shame about a gap or a decision. The job to be done is not "find me a listing." It is "help me see where I could go from here, and what to do next." They want a thinking partner, not a recruiter and not a chatbot.

## Product Purpose

A B2C AI career coach and matching tool. Two surfaces in MVP:

1. **Personal career coaching** — skill assessment, transition planning, interview prep. The user thinks out loud; the product helps them structure it and see it more clearly.
2. **Resume optimization and role matching** — turn the user's actual experience into a story that maps to real opportunities, not keyword soup.

Success looks like users *taking action* on what the product surfaces — applying, drafting, scheduling, reaching out — and coming back to update what changed. Not engagement minutes. Movement.

## Brand Personality

**Editorial · Warm · Considered.**

The voice of a thoughtful longform publication, not a recruiting platform. Calm, unhurried, plain-spoken when it counts, never performative. Honest about what's hard before pointing at what's possible. Closer in feel to Substack, Read.cv, and The Marginalian than to anything in the job-search lane.

Emotions to create: **clarity, agency, momentum, calm, confidence.**
Emotions to avoid producing: slickness, condescension, hype, the generic-AI-bro feeling.

If a sentence in the product could be spoken by a recruiter or by a chatbot, rewrite it.

## Anti-references

Career Steer must not look or feel like:

- **LinkedIn** — dense corporate-blue UI, ad-driven attention, transactional tone.
- **ZipRecruiter / Indeed** — quantity-over-quality lists, busy chrome, urgency manufactured by the platform.
- **Generic SaaS dashboards** — gradient hero metrics, identical card grids, "Pro" plan modals.
- **AI-product cliché** — purple/teal gradients, glassmorphism, animated sparkles, "AI-powered" badges, copy that uses the word "unlock," and emoji used as decoration or affordance. **Sparkle iconography is banned outright** — no `Sparkles`, `Wand`, `WandSparkles`, or animated shimmer in any UI surface, including AI-driven affordances (semantic search, summaries, generated content). The product uses AI; it does not advertise it. Replace the impulse with a plain text label, a domain-appropriate lucide glyph, or no marker at all.
- **Anything that reads as "shipped in a hurry"** — empty states with stock illustrations, lorem-ipsum-shaped placeholders, generic icon + heading + text cards repeated down the page.

## Design Principles

1. **Treat the career like a story worth telling, not a record to be processed.** Layout, type, and pacing should feel like reading something considered — never like filling out a form on a portal.
2. **Think with the user, not for them.** Show reasoning. When the product surfaces a match, a path, or a critique, explain what it noticed. The user is the protagonist; we are the editor.
3. **Calm beats clever.** The user already feels urgency. We do not manufacture more. No countdowns, no "X people viewed this," no streaks.
4. **Honest before hopeful.** Name the hard thing first — the gap, the mismatch, the thing the resume isn't saying — then point at what to do. Hopeful-without-honest is the failure mode of every career site.
5. **Made, not generated.** Every surface — including empty, loading, and error states — should feel deliberate enough that "AI made that" isn't the first thought. The product uses AI; it does not *look* like AI. Iconography is restricted to lucide; emoji are never used in UI.

## Workspace surface rules

The signed-in `/workspace/*` area is a working surface, not a marketing surface. Pages there must read as one product, not five separately-built screens. Three rules carry that:

1. **Every workspace page uses the shared shell.** `<WorkspacePageShell>` owns max-width (`max-w-6xl`), horizontal padding (`px-6 sm:px-8`), and vertical rhythm (`py-8 sm:py-10`). No page picks its own width or padding. The deliberate exception is Career Compass — a full-bleed canvas, not a working page.

2. **Every workspace page uses the shared header.** `<WorkspacePageHeader>` carries the editorial vocabulary: **eyebrow** (uppercase page name, `type-label text-mute`) → **headline** (`type-headline` clamped to 1.875–2.25rem, *never* `type-display` — that tier is hero/marketing only and is one-per-page in the public surface) → **lede** (15px, `text-ink/60`) → optional **actions** slot. The two-tone soft-span pattern (`text-ink-soft` on the de-emphasised half) applies here too.

3. **Every workspace page uses the shared loading vocabulary.** `<WorkspaceLoadingHeader>` + `<WorkspaceLoadingRows>` (hairline-divided tonal-pulsing skeletons) hold the page rhythm while data lands. Populated content fades in via `.fade-in-view` (320ms opacity ramp, disabled under `prefers-reduced-motion`). No spinner glyphs on initial page load — search-in-progress is its own pattern.

If a workspace page reaches for `type-display`, picks its own max-width, or shows a `Loader2` spinner during initial load, it's off-system. Fix it on the page, don't fork the rule.

## Accessibility & Inclusion

- Default to **WCAG 2.2 AA**.
- Respect `prefers-reduced-motion` for any motion beyond simple fades.
- Color is never the only carrier of meaning (status, severity, validation).
- Copy targets a wide reading age — no jargon, no recruiter-speak, no "career velocity."
- Older workers and screen-reader users are part of the audience: hit-targets at 44px minimum, no hover-only affordances, no decorative iconography without an accessible name.
