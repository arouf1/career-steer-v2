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

export type CompassAdviserPromptContext = {
  canvas: CanvasContextForVoice;
  profile?: ProfileContext;
  pivots: ReadonlyArray<PivotEntry>;
  citations: AggregatedCitation[];
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

  const canvasBlock = ctx.canvas.lanes
    .map((lane) => {
      if (lane.cards.length === 0) {
        return `**${lane.label}** — ${lane.description}\n  (no curated cards in this lane)`;
      }
      const lines = lane.cards
        .map((c) => {
          const savedFlag = c.isSaved ? " [SAVED]" : "";
          const fit = `whole ${pct(c.wholeScore)}, arc ${pct(c.arcScore)}, current-state ${pct(c.currentStateScore)}`;
          return `  - ${c.title}${savedFlag} (${c.slotLabel}; ${fit}). Why: ${truncate(c.whyMatchReason, 200)}`;
        })
        .join("\n");
      return `**${lane.label}** — ${lane.description}\n${lines}`;
    })
    .join("\n\n");

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

${ctx.canvas.savedCount > 0 ? `They've already saved ${ctx.canvas.savedCount} guide${ctx.canvas.savedCount === 1 ? "" : "s"} — when relevant, refer back to them by title.` : ""}${sourcesBlock}

**About ${candidateName}:**
${aboutCandidate}

**Their historical career pivots (from their CV/LinkedIn):**
${pivotsBlock}

When they ask about "their pivots", weave together (a) these historical transitions and (b) what's currently in the **Transformational Tracks** lane — those represent future pivots aligned with their narrative.

**Conversational rules:**

1. **Greet them warmly.** Two short sentences. Ask how they're doing or what's on their mind today. Do not enumerate the lanes in your greeting — let them ask.

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
- Never read out loud the source list above. It's context for *your* claims, not a script.`;
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
