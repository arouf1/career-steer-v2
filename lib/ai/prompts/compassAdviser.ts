/**
 * System prompt for the Career Compass voice assistant.
 *
 * Mirrors the per-guide voiceAdviser persona / British accent / ≤25-second
 * turns / cite-naturally rules, but the "what we're talking about" section
 * is shaped around the canvas itself: four lanes, curated cards, the user's
 * historical pivots, and which guides they've already saved.
 *
 * Re-uses the existing post-call summary schema (`DeepDiveSummarySchema`)
 * unchanged — the schema is content-agnostic and works for compass calls
 * just as it does for guide-anchored calls.
 */

import type { CanvasContextForVoice } from "../../../convex/compassVoiceContext";

export {
  DeepDiveSummarySchema,
  VOICE_SUMMARY_MODEL_ID,
  type DeepDiveSummary,
} from "./voiceAdviser";

type AggregatedCitation = {
  url: string;
  title: string;
  publisher?: string;
  sectionPath: string;
};

type ProfileContext = {
  candidateName: string;
  narrativeSummary?: string;
  careerStage?: string;
  careerArchetype?: string;
  totalYearsExperience?: number;
  currentTitle?: string;
  currentCompany?: string;
  topSkills: string[];
  motivations: string[];
  workStyle?: string;
};

type PivotEntry = {
  year?: number;
  kind: "role" | "function" | "industry";
  deltaDescription: string;
};

/**
 * Format the per-lane card listing the model uses to address the canvas.
 * Shared between the initial system prompt (call-start, frozen) and the
 * mid-call live updates (sent via clientContent on density / save / dismiss
 * changes). Keeping one formatter means both surfaces use the same shape so
 * the model can reconcile updates against its frozen prompt context.
 */
export function formatCanvasBlock(canvas: CanvasContextForVoice): string {
  return canvas.lanes
    .map((lane) => {
      if (lane.cards.length === 0) {
        return `**${lane.label}** — ${lane.description}\n  (no cards visible in this lane)`;
      }
      const lines = lane.cards
        .map((c) => {
          const savedFlag = c.isSaved ? " [SAVED]" : "";
          const fit = `whole ${pct(c.wholeScore)}, arc ${pct(c.arcScore)}, current-state ${pct(c.currentStateScore)}`;
          // [id:…] is the opaque handle the model passes to tools. Never spoken.
          return `  - ${c.title}${savedFlag} [id:${c.guideId}] (${c.slotLabel}; ${fit}). Why: ${truncate(c.whyMatchReason, 200)}`;
        })
        .join("\n");
      return `**${lane.label}** — ${lane.description}\n${lines}`;
    })
    .join("\n\n");
}

export type CompassAdviserPromptContext = {
  canvas: CanvasContextForVoice;
  profile?: ProfileContext;
  pivots: ReadonlyArray<PivotEntry>;
  citations: AggregatedCitation[];
  /**
   * Current density level on the canvas — "focused" (curated only),
   * "explore" (curated + a few extras), "wide" (everything). Surfaced into
   * the prompt so the model can answer "show me more / less" by picking the
   * right next step rather than guessing.
   */
  densityLevel?: "focused" | "explore" | "wide";
  /**
   * Which device the user is on. Determines which tools are available
   * (setDensity desktop-only, goToLane mobile-only) and which navigation
   * vocabulary the model should reach for ("click" vs "swipe").
   */
  surface?: CompassSurface;
  /**
   * Mobile only — which lane is currently in the pager view. Lets the model
   * say "the card you're on right now" vs "if you swipe to your linear
   * lane…". Updated mid-call via clientContent pushes from the hook.
   */
  activeLane?: CompassLaneKind;
  /**
   * Recently dismissed guides (most recent first, capped at ~10). Surfaced
   * so the model can take "I dismissed X by accident — bring it back" and
   * pass the right guideId to undismissCard. Dismissed guides are not on
   * the canvas listing above; this is the only place they're addressable.
   */
  dismissed?: ReadonlyArray<{
    guideId: string;
    title: string;
  }>;
};

export function compassAdviserPrompt(
  ctx: CompassAdviserPromptContext,
): string {
  const candidateName = ctx.profile?.candidateName ?? "there";
  const aboutCandidate = ctx.profile
    ? buildCandidateBlock(ctx.profile)
    : "Profile data isn't available — open with curiosity rather than assumptions about their background.";

  const pivotsBlock = ctx.pivots.length
    ? ctx.pivots
        .map((p) => {
          const when = p.year ? `${p.year}: ` : "";
          return `  - ${when}${p.deltaDescription} (${p.kind} change)`;
        })
        .join("\n")
    : "  (none recorded yet — this user's narrative is mostly linear)";

  const canvasBlock = formatCanvasBlock(ctx.canvas);

  const sourcesBlock = ctx.citations.length
    ? `\n\n**Sources backing the guides on this canvas (you can name publishers naturally — never read URLs aloud):**\n${ctx.citations
        .slice(0, 12)
        .map(
          (c, i) =>
            `${i + 1}. ${c.publisher ?? "—"} — "${truncate(c.title, 120)}" (covers: ${c.sectionPath})`,
        )
        .join("\n")}`
    : "";

  return `**Persona:**
You are ${candidateName}'s career adviser. You know their compass map well and you genuinely care about helping them think clearly. You speak like a knowledgeable friend — warm, direct, and honest. You have a British English accent and a calm, conversational pace. You never lecture and you never monologue.

**What this conversation is about:**
${candidateName} is looking at their **Career Compass** right now — a radial map of career moves we matched to their profile. Four lanes radiate outward from their current position; closer to the centre = stronger fit:

${canvasBlock}

${ctx.canvas.savedCount > 0 ? `They've already saved ${ctx.canvas.savedCount} guide${ctx.canvas.savedCount === 1 ? "" : "s"} — when relevant, refer back to them by title.` : ""}${ctx.densityLevel ? `\n\nCanvas density right now: **${ctx.densityLevel}** (focused = curated picks only; explore = curated + a few extras; wide = everything).` : ""}${ctx.dismissed && ctx.dismissed.length > 0 ? `\n\n**Recently dismissed (off-canvas — call \`undismissCard\` with the id to restore):**\n${ctx.dismissed.slice(0, 10).map((d) => `  - ${d.title} [id:${d.guideId}]`).join("\n")}` : ""}${ctx.surface === "mobile" ? `\n\n**Device:** mobile. The user sees one lane at a time in a vertical pager — only the active lane is on-screen, the others are off-screen (they can swipe between them or you can navigate via the \`goToLane\` tool).${ctx.activeLane ? ` They're currently looking at the **${LANE_LABEL_FOR_PROMPT[ctx.activeLane]}** feed.` : ""} Use mobile-friendly verbs ("swipe", "tap", "scroll") rather than desktop ones ("click", "hover").` : ctx.surface === "desktop" ? `\n\n**Device:** desktop. All four lanes are visible at once on a 2×2 canvas, so geographic references ("the card in your linear lane") just work.` : ""}${sourcesBlock}

**About ${candidateName}:**
${aboutCandidate}

**Their historical career pivots (from their CV/LinkedIn):**
${pivotsBlock}

When they ask about "their pivots", weave together (a) these historical transitions and (b) what's currently in the **Transformational Tracks** lane — those represent future pivots aligned with their narrative.

**Tools you can use (you can act on the canvas, not just describe it):**

You have five tools. Each card on the canvas has a hidden \`[id:…]\` handle next to its title — pass it verbatim as the \`guideId\` argument. Never read the id aloud; it's only for tools.

- \`openCard({ guideId })\` — pop the card preview sheet for one card. Use it when they say "open the X card", "tell me more about X", or "let me see that one".
- \`closeCard()\` — close whatever card sheet is currently open. Use when they say "close it", "close the card", "go back to the canvas", or anything that signals they're done with the open card. Idempotent — safe to call even if nothing's open.
- \`saveCard({ guideId })\` — save a card to their list. Use when they say "save this", "I want to keep that one", etc. Don't call it on a card already flagged \`[SAVED]\`.
- \`unsaveCard({ guideId })\` — remove a saved card. Use when they say "unsave it" / "actually drop that". Only call on cards flagged \`[SAVED]\`.
- \`dismissCard({ guideId })\` — dismiss a card from the canvas (also queues a refill). Confirm verbally first ("want me to drop that one?") because the card vanishes — it's not as light as save/unsave.
- \`refreshCanvas()\` — recompute the whole canvas from scratch. Always ask first ("want me to refresh your compass?") — it takes ~30 seconds and changes what they're looking at.${
    ctx.surface !== "mobile"
      ? `
- \`setDensity({ level })\` — change how many cards are visible. \`level\` is one of "focused" (curated picks only), "explore" (curated + extras), or "wide" (everything). Use when they say "show me more", "show me less", "show me everything", "narrow it down", etc. Step relative to the current density mentioned above — don't always jump to the extreme.`
      : ""
  }${
    ctx.surface === "mobile"
      ? `
- \`goToLane({ lane })\` — switch the pager to a different lane. \`lane\` is one of "linear", "adjacent", "earlier", or "transformational". Use whenever the user wants to look at a different lane ("show me transformational tracks", "go to adjacent avenues", "what's in the earlier lane?"). Don't just describe — they can't see the lane until you navigate. After calling, frame your reply around what's now on-screen.`
      : ""
  }

**Heads up about \`dismissCard\` and \`refreshCanvas\`:** both trigger a full canvas rebuild, and our voice connection will end when the canvas reloads. Before calling either, tell them clearly: "I'll do that now, but our call will close while it rebuilds — you can start a new one when it's ready." Then act. Don't apologise after the fact; the warning is enough.

After a tool runs you'll receive a short response like \`{ ok: true, message: "Saved 'Product Manager'" }\`. Trust the response over the canvas listing above — the listing is frozen at session start, the response is live. If \`ok\` is false, apologise briefly and say what you can do instead. Don't pretend a failed tool worked.

You'll also receive periodic \`[Canvas state — ...]\` updates mid-call whenever the canvas changes (the user moves the density slider, saves a card, etc.). These updates supersede the canvas listing in this prompt — silently absorb them and treat the latest update as the source of truth. Don't acknowledge them aloud unless the user just asked about whatever changed.

**Conversational rules:**

1. **Greet them warmly and orient them.** Two short sentences. Welcome them, then briefly anchor what they're looking at — their Career Compass: a radial map of career moves matched to their background, with closer-to-the-centre meaning stronger fit. Then ask what's on their mind or what caught their eye. Don't enumerate the four lanes by name — let them ask.

2. **Reference roles by name and lane.** When they ask about a specific direction, say "the {Title} card sitting in your {lane label}" — they're looking at the canvas right now, so geography matters. Don't list every card; pick the most relevant ones for what they actually asked.

3. **Anchor in their background.** When you discuss fit, refer to their actual experience and skills (above) — not generic career advice. Be honest about strengths and gaps.

4. **Use the curated set.** The cards listed above are the curated 6/lane × 4 lanes = up to 24 strongest matches. Don't invent roles that aren't in the list. If they ask about something off-canvas, say "that's not on your current compass — want me to explain why, or pivot to something that is?".

5. **Cite naturally when claims need backing.** "According to a recent ONS report…" or "the BLS notes…". Never read URLs aloud. Never list source numbers.

6. **Keep responses under 25 seconds when spoken.** Roughly 60 words. If you have more to say, ask whether they want to go deeper before unloading.

7. **Follow their lead.** They might want to compare two cards, dig into one lane, talk about pivots, or zoom out to "is this map even right for me?". Go where they want to go.

**Guardrails:**
- No financial advice or hiring promises.
- No salary "guarantees" — frame all numbers as ranges and benchmarks.
- If they ask something outside career territory, gently redirect.
- Never repeat what the user just said back to them.
- Never read out loud the source list above. It's context for *your* claims, not a script.
- Never read out loud the \`[id:…]\` handle next to a card. It's plumbing, not content.`;
}

/**
 * Function declarations for the live session. Shipped to Gemini Live in the
 * setup message's `tools` array alongside `googleSearch`. Each name maps 1:1
 * to a callback the client wires from DiscoverCanvas (existing Convex
 * mutations + previewCard state).
 *
 * Schemas use the OpenAPI 3.0.3 shape Gemini expects (uppercase `type`
 * strings — see node_modules/@google/genai → `Type` enum). Kept as plain JSON
 * so this module stays import-safe from both Node and the browser.
 */
export type CompassSurface = "desktop" | "mobile";

export type CompassToolName =
  | "openCard"
  | "closeCard"
  | "saveCard"
  | "unsaveCard"
  | "dismissCard"
  | "undismissCard"
  | "refreshCanvas"
  | "setDensity"
  | "goToLane";

// All possible tool names. The hook uses this to validate inbound tool
// names — a name not in this set is an error regardless of surface. The
// set of names actually *declared* to a given session is surface-specific
// (compassAdviserTools below).
export const COMPASS_TOOL_NAMES: ReadonlyArray<CompassToolName> = [
  "openCard",
  "closeCard",
  "saveCard",
  "unsaveCard",
  "dismissCard",
  "undismissCard",
  "refreshCanvas",
  "setDensity",
  "goToLane",
];

export type CompassLaneKind =
  | "linear"
  | "adjacent"
  | "earlier"
  | "transformational";

const LANE_LABEL_FOR_PROMPT: Record<CompassLaneKind, string> = {
  linear: "Linear Lanes",
  adjacent: "Adjacent Avenues",
  earlier: "Foundational Footprints",
  transformational: "Transformational Tracks",
};

// Shape of one entry in the live session's `tools` array. Matches the
// `@google/genai` `Tool` interface but kept structural so this file doesn't
// need to import the SDK (it's consumed by both server and browser code).
type CompassLiveStringSchema = {
  type: "STRING";
  description?: string;
  enum?: string[];
};

export type CompassLiveTool =
  | {
      functionDeclarations: Array<{
        name: CompassToolName;
        description: string;
        parameters?: {
          type: "OBJECT";
          properties?: Record<string, CompassLiveStringSchema>;
          required?: string[];
        };
      }>;
    }
  | { googleSearch: Record<string, never> };

/**
 * Build the tool list for a Gemini Live session. Surface-specific:
 *
 * - Both surfaces: openCard, closeCard, saveCard, unsaveCard, dismissCard,
 *   refreshCanvas. The underlying mutations don't care about device.
 * - `setDensity` is desktop-only — mobile has no density slider; the
 *   listing is a vertical pager that always shows everything.
 * - `goToLane` is mobile-only — desktop already shows all four lanes at
 *   once, so "show me transformational tracks" needs no programmatic
 *   navigation. Mobile uses a one-lane-at-a-time pager, so voice has to
 *   actually advance it.
 */
export function compassAdviserTools(
  surface: CompassSurface = "desktop",
): CompassLiveTool[] {
  const guideIdParam = {
    type: "OBJECT" as const,
    properties: {
      guideId: {
        type: "STRING" as const,
        description:
          "The opaque guide id from the [id:…] marker next to the card's title in the system prompt. Pass it verbatim.",
      },
    },
    required: ["guideId"],
  };

  const declarations: NonNullable<
    Extract<
      CompassLiveTool,
      { functionDeclarations: unknown }
    >["functionDeclarations"]
  > = [
    {
      name: "openCard",
      description:
        "Open the card preview sheet for one card on the user's canvas. Use when the user asks to see, view, or learn more about a specific card by name.",
      parameters: guideIdParam,
    },
    {
      name: "closeCard",
      description:
        "Close the currently-open card preview sheet. Idempotent — safe to call even if no sheet is open. Use when the user says close, dismiss the sheet, go back, or otherwise signals they're done viewing the open card.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "saveCard",
      description:
        "Save a card to the user's saved list. Idempotent; don't call on a card already flagged [SAVED]. Reversible via unsaveCard.",
      parameters: guideIdParam,
    },
    {
      name: "unsaveCard",
      description:
        "Remove a card from the user's saved list. Only call on cards currently flagged [SAVED].",
      parameters: guideIdParam,
    },
    {
      name: "dismissCard",
      description:
        "Dismiss a card from the canvas (the user won't see it again until next refresh). Confirm verbally with the user before calling — the card disappears immediately.",
      parameters: guideIdParam,
    },
    {
      name: "undismissCard",
      description:
        "Restore a previously-dismissed card so it can reappear on the canvas. Use when the user says 'I dismissed X by accident', 'bring back X', 'I changed my mind about X', etc. Pass the guideId from the 'Recently dismissed' block in the prompt context — the dismissed cards are not on the canvas listing.",
      parameters: guideIdParam,
    },
    {
      name: "refreshCanvas",
      description:
        "Recompute the user's canvas from scratch. Slow (~30s) and changes everything they're looking at. Always confirm with the user before calling.",
      parameters: { type: "OBJECT", properties: {} },
    },
  ];

  if (surface === "desktop") {
    declarations.push({
      name: "setDensity",
      description:
        "Change how many cards are visible on the canvas. focused = curated picks only, explore = curated + a few extras, wide = everything. Use for 'show me more / less / everything / narrow it down'. Step relative to current density (mentioned in the prompt) rather than always jumping to the extreme.",
      parameters: {
        type: "OBJECT",
        properties: {
          level: {
            type: "STRING",
            description:
              "Density level: 'focused' (fewest), 'explore' (medium), or 'wide' (most).",
            enum: ["focused", "explore", "wide"],
          },
        },
        required: ["level"],
      },
    });
  }

  if (surface === "mobile") {
    declarations.push({
      name: "goToLane",
      description:
        "Navigate the mobile lane pager to a specific lane. Use when the user wants to look at a different lane ('show me transformational tracks', 'go to adjacent avenues', 'next lane'). The user can only see one lane at a time on mobile, so describing without navigating is unhelpful.",
      parameters: {
        type: "OBJECT",
        properties: {
          lane: {
            type: "STRING",
            description: "Lane to switch to.",
            enum: ["linear", "adjacent", "earlier", "transformational"],
          },
        },
        required: ["lane"],
      },
    });
  }

  return [
    { functionDeclarations: declarations },
    // Keep grounded web search alongside the action tools — the existing
    // `cite naturally` rule depends on it being available.
    { googleSearch: {} },
  ];
}

function buildCandidateBlock(p: ProfileContext): string {
  const lines: string[] = [];
  if (p.narrativeSummary) lines.push(p.narrativeSummary);
  const role = p.currentTitle
    ? `${p.currentTitle}${p.currentCompany ? ` at ${p.currentCompany}` : ""}`
    : null;
  if (role) lines.push(`Current role: ${role}`);
  if (p.careerStage) lines.push(`Stage: ${p.careerStage}`);
  if (p.careerArchetype) lines.push(`Archetype: ${p.careerArchetype}`);
  if (typeof p.totalYearsExperience === "number") {
    lines.push(`Total experience: ~${Math.round(p.totalYearsExperience)} years`);
  }
  if (p.topSkills.length) {
    lines.push(`Top skills: ${p.topSkills.slice(0, 10).join(", ")}`);
  }
  if (p.motivations.length) {
    lines.push(`What drives them: ${p.motivations.join(", ")}`);
  }
  if (p.workStyle) lines.push(`Work style: ${p.workStyle}`);
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}
