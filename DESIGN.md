---
name: Career Steer
description: AI career coach for people in transition — editorial, warm, considered.
colors:
  paper: "oklch(96% 0.012 85)"
  paper-raised: "oklch(94% 0.014 85)"
  ink: "oklch(22% 0.015 70)"
  ink-deep: "oklch(15% 0.015 70)"
  ink-soft: "oklch(68% 0.005 75)"
  body: "oklch(40% 0.01 70)"
  mute: "oklch(60% 0.008 75)"
  hairline: "oklch(88% 0.008 80)"
  hairline-strong: "oklch(80% 0.008 80)"
typography:
  display:
    fontFamily: "EB Garamond, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(2.75rem, 6vw, 4.5rem)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "EB Garamond, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(1.875rem, 3.5vw, 2.5rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Figtree, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body-large:
    fontFamily: "Figtree, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  body:
    fontFamily: "Figtree, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Figtree, system-ui, -apple-system, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.06em"
  caption:
    fontFamily: "Figtree, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  pill: "9999px"
  card: "20px"
  surface: "12px"
  control: "8px"
  hair: "2px"
spacing:
  hair: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  "2xl": "64px"
  "3xl": "96px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.paper}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
    typography: "{typography.label}"
  segmented-toggle-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
    typography: "{typography.label}"
  segmented-toggle-inactive:
    backgroundColor: "transparent"
    textColor: "{colors.mute}"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
    typography: "{typography.label}"
  card-paper:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.body}"
    rounded: "{rounded.card}"
    padding: "32px"
  card-upload:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.body}"
    rounded: "{rounded.card}"
    padding: "32px"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "12px 16px"
    typography: "{typography.body}"
---

# Design System: Career Steer

## 1. Overview

**Creative North Star: "The Editorial Atelier"**

Career Steer is built like a quiet workshop where careers are shaped the way thoughtful publications are shaped — with patience, attention, and a respect for the reader. The interface borrows from longform editorial design (Substack, Read.cv, The Marginalian) more than from the recruiting category. Cream paper in place of dashboard white. Warm ink in place of corporate black. A single high-contrast Renaissance serif for everything that says something, a humanist sans for everything that says how. Generous whitespace doing the work of information hierarchy. Type doing the work of brand.

This system explicitly rejects the visual conventions of the job-search industry — LinkedIn's dense corporate-blue chrome, ZipRecruiter and Indeed's quantity-over-quality density, the AI-product cliché of purple/teal gradients, glass cards, animated sparkles, and "AI-powered" badges. It also rejects "shipped in a hurry" energy: stock illustration, generic icon-heading-text card grids, lorem-ipsum-shaped placeholders. The product uses AI; it does not look like AI.

Restraint is the loudest design choice on the page. The dark pill button is the brand's most saturated commitment, and it appears at most twice per surface. Everything else is paper, ink, and quiet hairlines.

**Key Characteristics:**
- Cream paper, never `#fff`. Warm ink, never `#000`.
- EB Garamond (display) paired with Figtree (body) — editorial serif over humanist sans.
- One accent: ink itself. No chromatic primary in the resting palette.
- Pill buttons, soft cards (20px radius), thin hairlines, dashed borders only on input invitations.
- Flat-by-default. Depth via tonal layering, not shadows.
- Two-tone headline emphasis (ink + ink-soft on different words), not bold or italic.
- Slow rhythm. Generous whitespace. No urgency manufactured by the platform.
- Iconography exclusively from lucide-react / lucide-animated. Emoji forbidden.

## 2. Colors

The Warm Paper Palette. A single saturated accent (ink), surrounded by warm tonal neutrals on a hue range of 70–85° (the cream-to-warm-grey edge of OKLCH). No chromatic primary, no gradient, no decorative color of any kind.

### Primary
- **Ink** (`oklch(22% 0.015 70)`): the only saturated commitment in the resting palette. Wordmark, all serif headlines, all body emphasis, primary button background, active route indicators. Not pure black — warmed toward the paper hue so it sits on the page instead of cutting through it.
- **Ink-deep** (`oklch(15% 0.015 70)`): primary button hover only. Never used at rest.

### Neutral
- **Paper** (`oklch(96% 0.012 85)`): the canvas. Cream, never white. Used as the page background everywhere.
- **Paper-raised** (`oklch(94% 0.014 85)`): one tonal step darker than paper. Used as the inset background for cards, segmented toggles, dialog bodies, and any region that should read as "set into" the page.
- **Ink-soft** (`oklch(68% 0.005 75)`): the de-emphasized half of two-tone headlines. *"Where could **your** **career** take you?"* — "your" and "career" are set in ink-soft, the rest in ink.
- **Body** (`oklch(40% 0.01 70)`): default paragraph color. Sits comfortably on paper without competing with ink.
- **Mute** (`oklch(60% 0.008 75)`): footnotes, captions, helper text, inactive segmented toggle labels, privacy notices.
- **Hairline** (`oklch(88% 0.008 80)`): default 1px dividers, ghost borders, vertical accent strokes on bullets.
- **Hairline-strong** (`oklch(80% 0.008 80)`): rare. Used only when a divider needs to register slightly louder, and on dashed input-invitation card borders.

### Named Rules

**The Cream Doctrine.** The page background is `paper` (oklch(96% 0.012 85)). Pure `#fff` and pure `#000` are forbidden — they read clinical against the warm hue and break the editorial atmosphere. Every neutral is tinted toward the cream hue range (70–85°). If a designer reaches for a Tailwind `gray-*` class, they're already off-system.

**The One Voice Rule.** There is exactly one accent in this system: ink. We do not introduce a chromatic primary unless a specific surface (charts, status, severity) genuinely needs it. Status colors live in the sidecar as future tokens and are added per-surface, never globally.

**The 10% Rule.** Saturated ink (the dark pill button) appears on no more than 10% of any given screen. Its rarity is the point. If a screen has more than two filled primary buttons, redesign — one of them is wrong.

## 3. Typography

**Display Font:** EB Garamond (with Georgia, Times New Roman fallback)
**Body Font:** Figtree (with system-ui fallback)

**Character.** EB Garamond is a high-contrast Renaissance Garamond revival — narrow, elegant, with strong stroke modulation and a particularly beautiful italic. It carries the editorial weight of every voiced moment in the product. Figtree is a contemporary humanist sans — open apertures, friendly curves, neutral enough to recede into long body copy without flattening into anonymity. The pairing reads "thoughtful publication," not "tech product."

### Hierarchy
- **Display** (EB Garamond, 400, clamp 2.75–4.5rem, lh 1.05, ls -0.01em): hero headlines only. One per page maximum.
- **Headline** (EB Garamond, 400, clamp 1.875–2.5rem, lh 1.15, ls -0.005em): section openers, marketing subheads.
- **Title** (Figtree, 600, 1.25rem, lh 1.3): card titles, dialog titles, in-app subsection labels.
- **Body-large** (Figtree, 400, 1.125rem, lh 1.6): hero subheads, lede paragraphs introducing a section.
- **Body** (Figtree, 400, 1rem, lh 1.6): default paragraphs, list text. Capped at 65–75ch line length.
- **Label** (Figtree, 500, 0.8125rem, ls 0.06em): button text, segmented toggle labels, eyebrow tags.
- **Caption** (Figtree, 400, 0.875rem, lh 1.5): metadata, footnotes, helper text, privacy notices.

### Named Rules

**The Two-Tone Headline Rule.** Headline emphasis comes from tonal contrast (ink + ink-soft on different words within the same line), not from weight, italics, or color. *"Where could **your** **career** take you?"* sets "your" and "career" in `ink-soft` and the rest in `ink`. Bold serifs are forbidden in headlines — EB Garamond carries weight through its high-contrast strokes alone.

**The 65–75ch Rule.** Body copy never exceeds 75 characters per line. EB Garamond italics are permitted in body for emphasis. Bold is reserved for Figtree at title weight only — never in body paragraphs.

**The No-Tracking Rule.** Default tracking is `normal`. Negative tracking (-0.005 to -0.01em) is allowed only on display sizes ≥1.5rem to compensate for optical loosening at scale. Positive letter-spacing (+0.06em) is reserved for the label role — short, often-uppercase strings. No "letter-spaced" body copy ever.

**The Garamond-or-Figtree Rule.** The system has exactly two type families. `monospace` is used only when literal monospace data is being shown (resume excerpts in code-style review notes are the sole legitimate case). Geist Mono — currently imported in `app/layout.tsx` — should be removed unless that legitimate case appears.

## 4. Elevation

The system is **flat by default**. Depth comes from **tonal layering**, not shadows. The `paper-raised` surface (one step darker than `paper`) signals an inset region — upload card, segmented toggle background, dialog body. The eye reads the contrast as recession into the page, not lift off it. This is the editorial-paper move, not the SaaS card-floating-above-canvas move.

Shadows exist in the vocabulary but are state responses, never resting decoration.

### Shadow Vocabulary
- **lift-soft** (`box-shadow: 0 1px 2px oklch(0% 0% 0 / 0.04), 0 8px 24px oklch(0% 0% 0 / 0.06)`): hover state for interactive cards (e.g. a clickable opportunity tile). Never visible at rest.
- **focus-ring** (`box-shadow: 0 0 0 3px oklch(22% 0.015 70 / 0.18)`): keyboard focus around any interactive element. Replaces the default browser outline.

### Named Rules

**The Flat-By-Default Rule.** No drop shadows on cards, buttons, dialogs, or any surface at rest. If a region needs to read as "lifted," tone it darker, not raised. If a region needs to read as "set in," tone it raised against the page.

**The No-Glass Rule.** Glassmorphism — `backdrop-filter: blur(...)` on translucent surfaces — is forbidden. Paper does not become glass. Modals and sheets sit on solid `paper-raised`, not on a blurred-through translucent layer.

## 5. Components

### Buttons
- **Shape:** pill — full radius (`border-radius: 9999px`).
- **Primary** (filled): `ink` background, `paper` text, label typography, padding `12px 24px`. The brand's loudest element.
- **Hover / Focus:** background darkens to `ink-deep` (oklch(15% 0.015 70)) on hover. Keyboard focus shows the focus-ring shadow.
- **Ghost:** transparent background, `ink` text, no border, label typography, same padding. Used as Sign In / Cancel — paired with Primary, never alone on a CTA.
- **Forbidden variants:** outlined / bordered buttons. Bordered buttons fragment the visual rhythm. The system has Primary and Ghost only.

### Segmented Toggle
- **Shape:** pill outer container in `paper-raised` (matches the surrounding card so it reads as inset).
- **Active option:** fills with `paper` (one tonal step *lighter* than the container — the "lifted-up-out" feel).
- **Inactive option:** transparent with `mute` text and a small lucide icon.
- **Transition:** background and text color only. No translation animation. Duration 150ms, ease-out-quart.
- **Use:** top-of-card mode switches (the Upload CV / LinkedIn pattern). Never for page-level navigation.

### Cards
- **Corner Style:** `card` radius (20px) for primary cards. `surface` (12px) for nested elements.
- **Background:** `paper-raised`.
- **Border:** optional 1px `hairline` solid border for content cards. Dashed border (1px dashed `hairline-strong`) is reserved for **input-invitation** cards only — drag-drop upload, "click to add" empty states. Dashedness is a single, dedicated affordance signal.
- **Internal Padding:** 32px desktop, 24px mobile.
- **Forbidden:** nested cards. A card inside a card is always wrong — restructure as sectioned content within one card, or split into two cards on the page.

### Inputs / Fields
- **Style:** `paper` background, 1px `hairline` border, `surface` radius (12px), padding 12px 16px, body typography.
- **Focus:** border deepens to `ink-soft`, focus-ring shadow appears.
- **Error:** border `oklch(45% 0.18 25)` (warm clay-red, used only for validation state — added to the sidecar as `state-error`, not introduced to the resting palette). Error message in `caption` typography below the field.
- **Disabled:** `mute` text, `paper-raised` background, no border.

### Hairline Bullet (signature pattern)
The reference uses a 1px vertical hairline (8–12px tall, color `hairline-strong`) sitting 12px before each bullet's text — a quiet, distinctive way to mark feature lists without bullets, dots, or icons. Use this in marketing surfaces for "what you get" lists. Do not use it for in-app menus, settings, or any list where users will scan for a specific item — there, rely on spacing and dividers.

### Navigation (top bar)
- **Style:** ghost text links (Figtree, 500, 0.875rem, ink color) on the left/center, Primary pill button on the right.
- **States:** Default `body` color. Hover `ink`. Active route `ink` plus a 1px `hairline` underline 4px below the baseline.
- **Mobile:** nav collapses behind a Sheet (lucide `MenuIcon` trigger). No emoji, no three-dot SVG, no kebab icon.

### Wordmark
- **Style:** "Career Steer" set in EB Garamond italic at 1.5rem, color `ink`.
- **Spacing:** always paired with substantial whitespace; never compressed against another element. Ample left margin or top padding required.
- **Sizing:** scales with viewport but never below 1.125rem (mobile minimum legibility for the italic).

### Editorial Illustration (signature pattern)
The reference card features a bespoke parchment-and-magnifier illustration sized roughly 320×220 within the upload card. Hero feature cards may host commissioned illustrations of this style — warm wood, parchment, hand-drawn analog metaphors. **Stock photography is forbidden.** Generic icon-set illustrations are forbidden. If we don't have an in-house illustration for a surface, the surface gets type and whitespace, not filler art.

## 6. Do's and Don'ts

### Do:
- **Do** use cream `paper` (`oklch(96% 0.012 85)`) as the page background everywhere. Always.
- **Do** keep `ink` as the brand's only saturated commitment. The dark pill button is the loudest element on any given surface.
- **Do** create headline emphasis through tonal contrast (ink + ink-soft on different words) — never via bold, italic, or color shift.
- **Do** import every icon from `lucide-react` (static) or `lucide-animated` (animated). Sized 16–20px in body, 24px max in headers.
- **Do** lean on whitespace before reaching for chrome. The Editorial Atelier breathes.
- **Do** reserve dashed borders for cards that *invite input* (upload, drag-drop, empty add-state). One dedicated affordance signal.
- **Do** keep body line length to 65–75ch.
- **Do** use tonal layering (paper → paper-raised) to signal recession. Inset, not lifted.

### Don't:
- **Don't** use `#fff` or `#000`. Both are forbidden. Per **The Cream Doctrine**, every neutral is tinted toward the warm hue range (70–85°).
- **Don't** introduce gradients of any kind — purple/teal, pink/orange, AI-product rainbow, gradient text via `background-clip: text`. Zero gradients in the system.
- **Don't** use glassmorphism, `backdrop-filter: blur`, or translucent glass cards. Forbidden by **The No-Glass Rule**.
- **Don't** render emoji in any UI surface — copy, buttons, badges, toasts, status pills, empty/error states, marketing, onboarding. Iconography is `lucide-react` / `lucide-animated` only.
- **Don't** use side-stripe borders (`border-left` greater than 1px) as colored accents on cards, callouts, or alerts. Use full hairline borders or tonal background shifts.
- **Don't** stack drop shadows on cards at rest. Per **The Flat-By-Default Rule**, shadows are state responses only.
- **Don't** nest cards. A card inside a card is always wrong.
- **Don't** use Geist Mono unless representing literal monospace data. Per **The Garamond-or-Figtree Rule**, the system has exactly two type families.
- **Don't** quote LinkedIn / ZipRecruiter / Indeed visual conventions — corporate-blue chrome, "X people viewed this" badges, urgency banners, sponsored-card outlines, dense sidebar nav.
- **Don't** add "AI-powered" badges, sparkle icons, animated shimmer on AI-generated text, or hype copy. The product uses AI; it does not advertise it.
- **Don't** manufacture urgency — countdowns, streaks, "Y people are looking at this," progress bars without a real underlying process.
- **Don't** use stock photography or generic illustration sets. Every illustrated element is bespoke; every empty state earns its art or goes type-only.
- **Don't** use bold weights in EB Garamond headlines. The Renaissance contrast carries weight on its own.
