# Design brief: Resume upload + review flow

**Date:** 2026-04-26
**Surface:** `/profile`
**Source spec:** [`docs/superpowers/specs/2026-04-26-resume-parser-design.md`](../specs/2026-04-26-resume-parser-design.md)
**Brand context:** [`PRODUCT.md`](../../../PRODUCT.md) · [`DESIGN.md`](../../../DESIGN.md)

---

## 1. Feature summary

The first authenticated surface in career-steer-v2. Users land here after sign-in, upload a résumé (PDF or DOCX), and read what we extracted as a structured profile they can correct in place. The profile is the foundation every downstream feature consumes — coaching chat, matching, narrative editing — so it has to feel honest, calm, and corrigible from the first second.

## 2. Primary user action

**Read what we noticed in your résumé, and tell us what we got wrong.**

Not "fill in your profile." Not "verify your data." Read yourself in our voice, then push back where we missed.

## 3. Design direction

**Surface lean: editorial.** The user is the protagonist; we are the editor. The page reads like an article about the person, not a form they're being processed through. Sparse, page-like, EB Garamond carries weight. Direct lift of the same register as the landing page.

**Color strategy: Restrained.** The warm-paper palette (paper / paper-raised / ink / ink-deep / ink-soft / body / mute / hairline / hairline-strong) carries every state. Status colors (`state-error`, `state-success`, `state-warning`) appear only at per-message density — never as a hero accent, never as a celebratory takeover. Parse-success doesn't get a "moment" — calm beats clever (PRODUCT.md design principle 3).

**Theme: light.** Scene sentence: *"Someone in transition opening this on a laptop after work, sleeves rolled up, room half-lit, looking to make sense of where they've been before deciding where to go next."* That image forces warm, considered, present-tense light — not after-hours dim, not sterile fluorescent. The warm-paper OKLCH palette is the answer.

**Anchor references:** Substack, Read.cv, The Marginalian (project-level brand anchors carry forward — no surface-specific additions). The user's interaction with their résumé should feel closer to reading a thoughtful long-form post about themselves than to filling out a Workday profile.

## 4. Scope

- **Fidelity:** Production-ready. This ships.
- **Breadth:** One surface, four logical states (empty / loading / review / edit). All four get the same level of polish.
- **Interactivity:** Full real-data wiring — Convex `profiles.parseUpload` action, `profiles.update` mutation, `profiles.markReviewed`, `profiles.clear`.
- **Time intent:** Until it ships well. /polish and /audit pass clean before "done."

## 5. Layout strategy

Single-column reading experience, max 65–75ch wrapped in generous side gutters. Mobile-first; the same layout breathes wider on `md:` and `lg:` rather than rearranging into multi-column. The page is something you read top-to-bottom on first encounter, with discrete return points (edit, re-upload) — not a dashboard you scan.

**Vertical rhythm.** Sections separated by ~6–10rem of vertical whitespace at desktop. The hairline-bullet pattern from `app/page.tsx` carries over for lists where it fits (skills, possibly experience bullets within a role). Section labels in `type-label` (small, tracked) sit quietly above their content like editorial section headers.

**No cards-as-default.** Resist the SaaS reflex to wrap each Experience entry in its own card. Use vertical rhythm + a single faint hairline divider between entries instead. Cards appear only at edit time, where each editable Experience/Education entry becomes a card to make the "this is mutable" affordance clear.

## 6. Key states

| State | What the user sees | What they feel |
|---|---|---|
| **Empty (no profile)** | Single `<UploadCard/>` centered on the page. EB Garamond display heading: *"Where would you like to begin?"* (placeholder; final copy below). Drag-drop zone composed from the segmented-toggle pattern (CV active, LinkedIn placeholder dimmed). | Invited, not pressured. The empty state IS the affordance — no separate "get started" CTA. |
| **Loading — extracting (client-side)** | UploadCard's caption swaps to *"Reading your résumé."* Subtle, non-rotating. Drop zone visually settles (border becomes solid `hairline-strong`, no animation). | Steady, not anxious. Browser-side text extraction is fast (<2s for typical résumés). |
| **Loading — parsing (server-side AI)** | Caption swaps to *"Thinking about what we read. About ten seconds."* Same composition, no spinner. | The wait is named, not hidden. PRODUCT.md's "honest before hopeful" applied to UI state. |
| **Review (default after parse)** | Profile renders. `<ReviewCallout/>` sits above the profile in `paper-raised`, separated by a single `hairline`. Body copy: *"Here's what we noticed in your résumé. Tell us what we got wrong before they flow into your coaching."* Three actions in flat horizontal rhythm: [Looks right] (filled, ink-on-paper), [Edit] (outlined hairline-strong), [Re-upload] (link-style). | Read first, decide second. The user can take the editorial moment without being rushed to confirm. |
| **Reviewed** | ReviewCallout disappears. ProfileView remains. An "Edit profile" affordance lives quietly in the header (lucide `Pencil` + label, hairline-bordered pill). | The data is now theirs. No fanfare. |
| **Edit** | ProfileView swaps for ProfileEditForm. Each Experience/Education entry becomes a small card in `paper` with `hairline` border. Save/Cancel at the bottom. | A focused modal-feel without a modal — you're now editing, full surface. |
| **Error — wrong file type** | Inline error below the drop zone in `state-error`: *"We can read PDF and DOCX. Try one of those."* | Recoverable. No tone shift, no shame. |
| **Error — file too big** | *"That file's a bit large. Try a copy under 5 MB."* | Same. |
| **Error — extraction failed** | *"We couldn't read this file. It might be a scan — try exporting a fresh PDF."* | Names the likely cause. Hopeful next step. |
| **Error — parse failed (upstream)** | *"Something on our side gave up. Try again — or wait a moment if it keeps happening."* | Honest about whose problem it is. |
| **Error — rate limit** | *"You've parsed five résumés today. Take a breath; tomorrow we'll be ready again."* | Friendly cap, not punitive. |

## 7. Interaction model

- **Upload:** Click anywhere on the drop zone, OR drag a file onto it. No "Browse" button — the entire zone is the affordance. Selected file kicks off extraction immediately; no separate "Upload" submit.
- **Review:** ReviewCallout is non-modal. The user can scroll past it, scroll back, click Edit, click Looks-right, or just leave. It only disappears when explicitly dismissed (via Looks-right) or via Edit-then-Save. No auto-dismiss on scroll.
- **Edit:** Edit affordance opens an inline form on the same URL (no route change, no modal). Form replaces the read view; the user has one focus. Save closes the form and shows the read view. Cancel closes without changes (state local to the component).
- **Re-upload:** Re-upload from the callout calls `clear()` — explicit, destructive, with a confirm step in copy: *"This will replace what we noticed. Continue?"* (single-shot inline confirm, not a separate modal).
- **Empty re-entry:** After clear, the page returns to the empty state. The user can upload again immediately.

No motion beyond `transition-colors` on hover/focus. No "celebration" on successful parse. Calm, considered, present.

## 8. Content requirements

All copy in the editorial register. Final wording can be refined during polish but must not regress toward chatbot/recruiter tone. Source-of-truth list (matches spec §7):

| Surface | Copy |
|---|---|
| Empty heading | *"Where would you like to begin?"* (working draft) |
| Empty body | *"Drop a résumé here and we'll read it carefully."* (working draft) |
| Empty hint | *"Supports PDF and DOCX."* |
| Extracting state | *"Reading your résumé."* |
| Parsing state | *"Thinking about what we read. About ten seconds."* |
| ReviewCallout heading | *"Here's what we noticed in your résumé."* |
| ReviewCallout body | *"Tell us what we got wrong before they flow into your coaching."* |
| Action: confirm | *"Looks right"* |
| Action: edit | *"Edit"* |
| Action: re-upload | *"Re-upload"* |
| Re-upload confirm | *"This will replace what we noticed. Continue?"* |
| Edit form save | *"Save and mark reviewed"* |
| Wrong type error | *"We can read PDF and DOCX. Try one of those."* |
| Too-big error | *"That file's a bit large. Try a copy under 5 MB."* |
| Extraction error | *"We couldn't read this file. It might be a scan — try exporting a fresh PDF."* |
| Parse error | *"Something on our side gave up. Try again — or wait a moment if it keeps happening."* |
| Rate-limit error | *"You've parsed five résumés today. Take a breath; tomorrow we'll be ready again."* |

Section labels in ProfileView use `type-label` and quiet uppercase tracking: SUMMARY, EXPERIENCE, EDUCATION, SKILLS. (Lowercase versions are also acceptable per `DESIGN.md` — try both at /polish.)

No emoji anywhere. Lucide-only iconography (per `.claude/rules/ui-quality.md`). Specific lucide picks: `UploadCloud` (drop zone), `Pencil` (edit affordance), `Plus` / `Trash2` (form rows), `FileText` / `IdCard` (segmented toggle for CV / LinkedIn placeholder).

## 9. Recommended references

During implementation, consult:

- `DESIGN.md` §2 (Colors) and §5 (Components: Cards, Inputs, Segmented Toggle, Hairline Bullet) — the primitives we're composing.
- `frontend-design/reference/spatial-design.md` — for the vertical rhythm decisions in ProfileView and the gaps between sections.
- `frontend-design/reference/typography.md` — to confirm the editorial type ramp choices for ProfileView's section labels and Experience entries.
- `frontend-design/reference/interaction-design.md` — for the form-heavy ProfileEditForm patterns (focus states, error states, field arrays).
- `.claude/rules/ui-quality.md` — the project's own gates (shadcn primitives over custom CSS, Tailwind tokens, no raw `<img>`, mobile first, no emoji).

## 10. Open questions

- **Empty-state heading copy.** *"Where would you like to begin?"* is a working draft and may regress to "Upload your résumé" under pressure. Possible alternatives: *"Let's start with what you've already done."*, *"Begin with a résumé."* Decide at /polish.
- **Section label case.** UPPERCASE-tracked vs. lowercase Title Case. DESIGN.md allows both for `type-label`. A/B during /polish.
- **Re-upload confirm.** Inline single-shot confirm vs. a tiny `<Dialog/>` is a real call. The spec says inline; if it ends up clumsy at /polish we can revisit.
- **First-run education.** Does an authenticated user landing on /profile for the first time need any explanation of what's about to happen, or does the empty-state heading + body carry it? Implementer's call during build.

---

**Brief approved when the user signs off. Once confirmed, this hands off to the executing implementer for Tasks 13–17.**
