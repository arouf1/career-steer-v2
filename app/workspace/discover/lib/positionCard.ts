// True 2x2 Cartesian quadrant layout for the Discover canvas.
//
// User node sits at (0, 0). Each lane occupies one corner-anchored quadrant:
//   linear            → top-left      (x < 0, y < 0)  "Next steps"
//   adjacent          → top-right     (x > 0, y < 0)  "Sideways moves"
//   earlier           → bottom-left   (x < 0, y > 0)  "Earlier chapters"
//   transformational  → bottom-right  (x > 0, y > 0)  "A different chapter"
//
// Cards FILL the quadrant area (not just the perimeter) — within each
// quadrant, distance from the user node is driven by slot kind and arcScore,
// and a per-axis hash adds scatter so cards don't all line up.

// Inner edge: how close cards can sit to the user node (avoids collision).
export const INNER_PADDING = 160;
// Outer edge of each quadrant. With fitView the canvas scales to fit;
// these values just establish the canvas's logical extent.
export const QUADRANT_HALF_WIDTH = 720;
export const QUADRANT_HALF_HEIGHT = 520;

type Lane = "linear" | "adjacent" | "earlier" | "transformational";
type Slot = "strong" | "bridge" | "aspirational" | "extra";

// Quadrant signs: which corner the quadrant occupies in screen coords (Y down).
// (-1,-1) = top-left, (1,-1) = top-right, (-1,1) = bottom-left, (1,1) = bottom-right.
const QUADRANT_SIGN: Record<Lane, { x: -1 | 1; y: -1 | 1 }> = {
  linear: { x: -1, y: -1 }, // top-left
  adjacent: { x: 1, y: -1 }, // top-right
  earlier: { x: -1, y: 1 }, // bottom-left
  transformational: { x: 1, y: 1 }, // bottom-right
};

// How far OUT from user the card sits, as a fraction of the quadrant's
// available radial span (0 = at INNER_PADDING, 1 = at outer edge).
// Strong fits cluster closer; aspirational sits at the outer edge.
const SLOT_BIAS: Record<Slot, number> = {
  strong: 0.18,
  bridge: 0.42,
  aspirational: 0.78,
  extra: 0.62,
};

function hashStringTo01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 0xffffffff;
}

export function positionCard(args: {
  lane: Lane;
  slotKind: Slot;
  arcScore: number;
  guideId: string;
}): { x: number; y: number } {
  const sign = QUADRANT_SIGN[args.lane];

  // Available radial span within this quadrant (from inner padding to outer edge).
  const spanX = QUADRANT_HALF_WIDTH - INNER_PADDING;
  const spanY = QUADRANT_HALF_HEIGHT - INNER_PADDING;

  // Card distance fraction (0 = at inner padding, 1 = at outer edge).
  // Combine slot bias (where the slot kind tends to sit) with arcScore-based
  // pull toward user (high arcScore = closer). Slot bias dominates so the
  // strong/bridge/aspirational tiers stay visually distinct.
  const arcPull = 1 - args.arcScore; // 0 = at user, 1 = far
  const slotBias = SLOT_BIAS[args.slotKind];
  // Weighted blend: 70% slot bias, 30% arc-score pull.
  const t = Math.max(0, Math.min(1, 0.7 * slotBias + 0.3 * arcPull));

  // Two independent hashes so cards spread in BOTH dimensions.
  const hashA = hashStringTo01(args.guideId);
  const hashB = hashStringTo01(args.guideId + ":y");
  // Bias each axis toward t with ± scatter so cards don't all line up.
  const SCATTER = 0.32; // ±32% of the span
  const fx = Math.max(0, Math.min(1, t + (hashA - 0.5) * SCATTER));
  const fy = Math.max(0, Math.min(1, t + (hashB - 0.5) * SCATTER));

  // Project into the quadrant: sign · (INNER_PADDING + f * span).
  const x = sign.x * (INNER_PADDING + fx * spanX);
  const y = sign.y * (INNER_PADDING + fy * spanY);

  return { x, y };
}

// Margin past the outer card position so the lane labels sit at the visual
// centre of each quadrant tint cell without crowding the outermost cards.
// Now that the canvas is plain CSS (no React Flow fitView), this is purely
// a layout offset for label placement — the canvas extent is fixed by the
// virtual canvas dimensions in DiscoverCanvas.
const ANCHOR_OFFSET = 80;

// Centre of each quadrant — used by DiscoverCanvas for lane label positions.
// Each visual quadrant (one of the four tint cells) occupies a 1/2 × 1/2
// fraction of the canvas viewport. The centre of each cell sits at half of
// the extended quadrant extent (QUADRANT_HALF + ANCHOR_OFFSET).
const VIEWPORT_HALF_WIDTH = QUADRANT_HALF_WIDTH + ANCHOR_OFFSET; // 800
const VIEWPORT_HALF_HEIGHT = QUADRANT_HALF_HEIGHT + ANCHOR_OFFSET; // 600

export const QUADRANT_CENTER: Record<Lane, { x: number; y: number }> = {
  linear: { x: -VIEWPORT_HALF_WIDTH / 2, y: -VIEWPORT_HALF_HEIGHT / 2 }, // (-400, -300)
  adjacent: { x: VIEWPORT_HALF_WIDTH / 2, y: -VIEWPORT_HALF_HEIGHT / 2 }, // (400, -300)
  earlier: { x: -VIEWPORT_HALF_WIDTH / 2, y: VIEWPORT_HALF_HEIGHT / 2 }, // (-400, 300)
  transformational: {
    x: VIEWPORT_HALF_WIDTH / 2,
    y: VIEWPORT_HALF_HEIGHT / 2,
  }, // (400, 300)
};
