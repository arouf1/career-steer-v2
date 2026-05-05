/**
 * Pure helpers for the Career Compass voice assistant ("Talk to your compass").
 *
 * Mirrors voiceCallContext.ts (per-guide call) — no Convex APIs imported,
 * unit-testable, called from convex/compassVoice.ts after the loader has
 * pulled the necessary documents through ctx.db.
 */

import type { Doc, Id } from "./_generated/dataModel";
import type { VoiceAdviserPromptContext } from "../lib/ai/prompts/voiceAdviser";
// We re-use the existing profile snapshot builder (purely user-side; the
// compass surface needs the same career-stage / archetype / motivations / pivots
// shape as the per-guide surface). Anything that's compass-specific lives below.
export { buildProfileSnapshotForVoice } from "./voiceCallContext";

const MAX_CITATIONS_FOR_PROMPT = 12;

export type DensityLevel = "focused" | "explore" | "wide";

// Per-lane visibility cap as a function of density. Mirrors DiscoverCanvas's
// `perLaneCap = Math.floor(density / 3)` so the model sees exactly what the
// user sees: focused = curated only (6/lane), explore = +6 extras (12/lane),
// wide = +14 extras (20/lane).
const DENSITY_TO_PER_LANE_CAP: Record<DensityLevel, number> = {
  focused: 6,
  explore: 12,
  wide: 20,
};

type LaneKind = "linear" | "adjacent" | "earlier" | "transformational";
type SlotKind = "strong" | "bridge" | "aspirational" | "extra";

const LANE_LABEL: Record<LaneKind, string> = {
  linear: "Linear Lanes",
  adjacent: "Adjacent Avenues",
  earlier: "Foundational Footprints",
  transformational: "Transformational Tracks",
};

const LANE_DESCRIPTION: Record<LaneKind, string> = {
  linear: "natural next steps from where the user is now",
  adjacent: "sideways moves into nearby fields",
  earlier: "earlier-stage roles that share the user's foundation",
  transformational: "bigger pivots that reshape the user's trajectory",
};

const SLOT_LABEL: Record<SlotKind, string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "Extra",
};

type CanvasCardForPrompt = {
  // guideId is rendered into the prompt as a hidden [id:...] marker so the
  // model can pass it back as a tool argument (saveCard, openCard, etc.).
  // Branded `Id<"career_guides">` serialises as a plain string over the wire.
  guideId: Id<"career_guides">;
  title: string;
  slug: string;
  slotKind: SlotKind;
  slotLabel: string;
  arcScore: number;
  currentStateScore: number;
  domainScore: number;
  wholeScore: number;
  whyMatchReason: string;
  isSaved: boolean;
};

export type CanvasContextForVoice = {
  generatedAt: number;
  lanes: Array<{
    kind: LaneKind;
    label: string;
    description: string;
    cards: CanvasCardForPrompt[];
  }>;
  savedCount: number;
};

type RawCanvasCard = {
  guideId: Id<"career_guides">;
  slotKind: SlotKind;
  arcScore: number;
  currentStateScore: number;
  domainScore: number;
  wholeScore: number;
  whyMatchReason: string;
};

type RawCanvas = Doc<"discover_canvases">;
type RawReaction = Doc<"discover_reactions">;
type RawGuide = Doc<"career_guides">;

/**
 * Project a hydrated canvas snapshot down to the cards currently visible on
 * the user's canvas at the given density. Mirrors DiscoverCanvas's filter:
 * curated cards always pass; "extra" filler cards pass when their lane
 * position is below the density-driven per-lane cap. Sort each lane by
 * `wholeScore` desc so the model's first instinct is to mention the
 * strongest fits.
 */
export function buildCanvasSnapshotForVoice(args: {
  canvas: RawCanvas;
  guidesById: Map<Id<"career_guides">, RawGuide>;
  savedGuideIds: Set<Id<"career_guides">>;
  density: DensityLevel;
}): CanvasContextForVoice {
  const perLaneCap = DENSITY_TO_PER_LANE_CAP[args.density];
  const lanes = args.canvas.lanes.map((lane) => {
    const visible = lane.cards.filter(
      (c, i) => c.slotKind !== "extra" || i < perLaneCap,
    );
    const enriched = visible
      .map((c): CanvasCardForPrompt | null => {
        const g = args.guidesById.get(c.guideId);
        if (!g) return null;
        return {
          guideId: c.guideId,
          title: g.title,
          slug: g.slug,
          slotKind: c.slotKind,
          slotLabel: SLOT_LABEL[c.slotKind],
          arcScore: c.arcScore,
          currentStateScore: c.currentStateScore,
          domainScore: c.domainScore,
          wholeScore: c.wholeScore,
          whyMatchReason: c.whyMatchReason,
          isSaved: args.savedGuideIds.has(c.guideId),
        };
      })
      .filter((c): c is CanvasCardForPrompt => c !== null);

    enriched.sort((a, b) => b.wholeScore - a.wholeScore);

    return {
      kind: lane.kind,
      label: LANE_LABEL[lane.kind],
      description: LANE_DESCRIPTION[lane.kind],
      cards: enriched.slice(0, perLaneCap),
    };
  });

  return {
    generatedAt: args.canvas.generatedAt,
    lanes,
    savedCount: args.savedGuideIds.size,
  };
}

type Citation = {
  url: string;
  title: string;
  publisher?: string;
  fetchedAt: number;
};

type AggregatedCitation = {
  url: string;
  title: string;
  publisher?: string;
  sectionPath: string;
};

/**
 * Aggregate citations from every guide on the visible canvas. The compass
 * surface doesn't have its own citation store — the AI's grounding comes
 * from whichever guides are on the canvas. We dedupe by URL and surface the
 * most recent N so the prompt stays bounded.
 */
export function aggregateCompassCitations(args: {
  guides: RawGuide[];
}): AggregatedCitation[] {
  const seen = new Map<string, AggregatedCitation & { fetchedAt: number }>();

  for (const guide of args.guides) {
    if (!guide.citations) continue;
    for (const [path, list] of Object.entries(guide.citations)) {
      for (const c of list as Citation[]) {
        if (!c?.url) continue;
        const sectionPath = `${guide.slug}::${path}`;
        const existing = seen.get(c.url);
        if (!existing || c.fetchedAt > existing.fetchedAt) {
          seen.set(c.url, {
            url: c.url,
            title: c.title,
            publisher: c.publisher,
            sectionPath,
            fetchedAt: c.fetchedAt,
          });
        }
      }
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .slice(0, MAX_CITATIONS_FOR_PROMPT)
    .map(({ fetchedAt: _f, ...rest }) => rest);
}

/**
 * Saved-guide set for the user — small wrapper around the reactions list so
 * the compass prompt builder doesn't need to know about the
 * discover_reactions schema.
 */
export function buildSavedGuideSet(
  reactions: RawReaction[],
): Set<Id<"career_guides">> {
  const saved = new Set<Id<"career_guides">>();
  for (const r of reactions) {
    if (r.reaction === "saved") saved.add(r.guideId);
  }
  return saved;
}

/**
 * Compose the full system instruction string for a Gemini Live session
 * anchored to the canvas. Thin wrapper that imports the prompt builder so
 * compassVoice.ts doesn't need to know about the prompt module's path.
 */
export type CompassVoicePromptContext = {
  canvas: CanvasContextForVoice;
  profile?: VoiceAdviserPromptContext["profile"];
  pivots: ReadonlyArray<{
    year?: number;
    kind: "role" | "function" | "industry";
    deltaDescription: string;
  }>;
  citations: AggregatedCitation[];
};
