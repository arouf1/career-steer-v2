// Polar geometry for the mobile Career Compass dial.
//
// The desktop canvas (lib/positionCard.ts) uses the four 90° quadrants of
// polar space with absolute pixel radii (Strong fit at r=360, Skill bridge
// at r=520, Aspirational at r=680, Extra at r=840) on a virtual 2240×1840
// canvas. The mobile compass renders the same model in miniature: a single
// SVG square with a normalised viewBox of [-1, -1, 1, 1] so geometry is
// resolution-independent. Card dots are positioned in normalised space and
// the SVG scales with the rendered compass size.
//
// Quadrant signs match positionCard.ts exactly so a card placed at "Linear,
// strong fit" by the desktop layout falls in the same quadrant on mobile.
//
// The mobile dial draws three rings (strong/bridge/aspirational); the
// "extra" tier sits a hair beyond the aspirational ring, just inside the
// outer edge, so it stays visible without breaking the three-band reading.
import type { CompassLane, CompassSlot } from "./mobileCompassTypes";

export const NORMALISED_RADIUS = {
  strong: 0.34,
  bridge: 0.55,
  aspirational: 0.74,
  extra: 0.9,
} as const satisfies Record<CompassSlot, number>;

const QUADRANT_SIGN: Record<CompassLane, { x: -1 | 1; y: -1 | 1 }> = {
  linear: { x: -1, y: -1 },
  adjacent: { x: 1, y: -1 },
  earlier: { x: -1, y: 1 },
  transformational: { x: 1, y: 1 },
};

const ANGULAR_PADDING = (10 * Math.PI) / 180; // 10°, slightly tighter than desktop because dots are smaller

function hashStringTo01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Normalised dot position in [-1, 1] × [-1, 1] for a single card on the
 * mobile compass. Use SVG viewBox `-1 -1 2 2` (or scale by rendered radius).
 */
export function dotPosition(args: {
  lane: CompassLane;
  slotKind: CompassSlot;
  guideId: string;
}): { x: number; y: number } {
  const sign = QUADRANT_SIGN[args.lane];
  const r = NORMALISED_RADIUS[args.slotKind];
  const hashAngle = hashStringTo01(args.guideId + "::angle");
  const angle =
    ANGULAR_PADDING + hashAngle * (Math.PI / 2 - 2 * ANGULAR_PADDING);
  return {
    x: sign.x * r * Math.cos(angle),
    y: sign.y * r * Math.sin(angle),
  };
}

/**
 * Centre point of a quadrant in normalised space — used to position lane
 * labels at quadrant midpoints.
 */
export function quadrantCenter(lane: CompassLane): { x: number; y: number } {
  const sign = QUADRANT_SIGN[lane];
  // 45° angle, mid-radius ~0.62 (between bridge and aspirational rings)
  const r = 0.62;
  const a = Math.PI / 4;
  return { x: sign.x * r * Math.cos(a), y: sign.y * r * Math.sin(a) };
}

/**
 * Quadrant clip path string for tinting a single quadrant of the compass
 * disc. Used as an SVG clipPath to render lane tints inside the outer ring.
 */
export function quadrantClipPath(lane: CompassLane): string {
  // Each quadrant: from origin, out along one axis, around the outer arc, back
  // along the other axis. The outer radius is 1 in normalised space.
  const { x, y } = QUADRANT_SIGN[lane];
  return `M 0 0 L ${x} 0 A 1 1 0 0 ${x === y ? 1 : 0} 0 ${y} Z`;
}

/**
 * Lane-tint colour for compass quadrants.
 *
 * The active quadrant must be visibly darker than the inactive ones — that
 * difference is now the *only* signal of which lane the user is on (taps
 * are removed; the compass is a passive indicator). `intensity` is a 0..1
 * scalar; in practice values land in the [0.3, 1] band:
 *   - 0.3: inactive lane (subtle cream tint)
 *   - 1.0: active lane (clearly darker tinted slice)
 *   - intermediate values during a horizontal swipe gesture, so the active
 *     quadrant fades out and the adjacent one fades in *during* the drag
 *
 * Hue mirrors the desktop quadrant tints exactly (Linear=70 / Adjacent=220
 * / Earlier=130 / Transformational=290) so mobile and desktop stay
 * chromatically aligned.
 */
export function laneTint(lane: CompassLane, intensity: number): string {
  const i = Math.max(0, Math.min(1, intensity));
  const HUE: Record<CompassLane, number> = {
    linear: 70,
    adjacent: 220,
    earlier: 130,
    transformational: 290,
  };
  // Linearly interpolate L from 0.97 (paper-pale, inactive) → 0.91 (active,
  // visibly darker), and C from 0.005 (barely tinted) → 0.05 (clearly
  // tinted) over the full i range. With QuadrantTint clamping i to
  // [0.3, 1], inactive lands around (L 0.952, C 0.0185) and active around
  // (L 0.91, C 0.05) — calm, but with enough contrast to read at a glance.
  const L = 0.97 - (0.97 - 0.91) * i;
  const C = 0.005 + (0.05 - 0.005) * i;
  return `oklch(${L} ${C} ${HUE[lane]})`;
}

/**
 * Dot colour by lane — slightly more saturated than the tint so dots read
 * against their quadrant background.
 */
export function laneDotColor(lane: CompassLane): string {
  const dots: Record<CompassLane, string> = {
    linear: "oklch(0.55 0.07 70)",
    adjacent: "oklch(0.55 0.06 220)",
    earlier: "oklch(0.55 0.07 130)",
    transformational: "oklch(0.55 0.07 290)",
  };
  return dots[lane];
}

export const COMPASS_LANE_ORDER: ReadonlyArray<CompassLane> = [
  "linear",
  "adjacent",
  "earlier",
  "transformational",
] as const;

export const COMPASS_LANE_LABEL: Record<CompassLane, string> = {
  linear: "Next steps",
  adjacent: "Sideways",
  earlier: "Earlier",
  transformational: "Pivots",
};

export const COMPASS_LANE_TITLE: Record<CompassLane, string> = {
  linear: "Linear Lanes",
  adjacent: "Adjacent Avenues",
  earlier: "Foundational Footprints",
  transformational: "Transformational Tracks",
};
