// Polar (ring-anchored) layout for the Discover canvas.
//
// User node sits at (0, 0). Each lane occupies one 90° quadrant of polar
// space:
//   linear            → top-left      (x < 0, y < 0)  "Next steps"
//   adjacent          → top-right     (x > 0, y < 0)  "Sideways moves"
//   earlier           → bottom-left   (x < 0, y > 0)  "Earlier chapters"
//   transformational  → bottom-right  (x > 0, y > 0)  "A different chapter"
//
// Within each quadrant, the card's distance from the user node is anchored
// to its slot kind's named ring (radius mapped from `SLOT_RADIUS` below);
// the angular position around the ring is set by a hash of the guideId so
// cards on the same ring don't perfectly stack. Small radial jitter
// breaks ties when multiple cards share a slot.
//
// Why polar instead of the previous rectangular slot-bias-with-scatter:
// the canvas's named concentric rings (rendered in DiscoverCanvas) claim
// "STRONG FIT / SKILL BRIDGE / ASPIRATIONAL" zones. Under the old scatter
// (±0.3 on the slot fraction, plus a 30% arcScore weight), individual
// cards regularly drifted 1-2 rings off their slot label, which made the
// ring labels misleading. Anchoring radius to slot makes the rings a true
// visual classification: every "strong" card sits on the STRONG FIT ring,
// every "bridge" on the SKILL BRIDGE ring, etc.

// Inner edge, preserved for compatibility, not used by the polar layout
// directly. Kept exported because other modules consume it.
export const INNER_PADDING = 160;
// Logical canvas extents, establish the canvas's bounding box for layout
// math elsewhere. Cards may sit anywhere up to roughly QUADRANT_HALF_WIDTH
// from the origin under the new polar layout (extras ring at r=840).
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

// Each slot kind's anchor radius in canvas pixels. Must stay in lockstep
// with the named-ring radii rendered in DiscoverCanvas.tsx (`Strong fit` at
// 360, `Skill bridge` at 520, `Aspirational` at 680). The `extra` ring at
// 840 is rendered but unlabelled, extras are "more to explore" cards
// further out, beyond the named bands.
const SLOT_RADIUS: Record<Slot, number> = {
  strong: 360,
  bridge: 520,
  aspirational: 680,
  extra: 840,
};

// Per-card radial jitter (in pixels) added so multiple cards on the same
// ring don't sit at exactly the same distance from the user node. Stays
// well below the 160px inter-ring gap so a card's ring identity is never
// ambiguous visually.
const RADIAL_JITTER = 18;

// Angular padding (radians, applied at both ends of the 90° quadrant arc).
// Keeps cards a touch away from the dividing axes so a card on one lane's
// boundary doesn't visually crowd the neighbouring lane's column.
const ANGULAR_PADDING = (8 * Math.PI) / 180; // 8°

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
  const baseRadius = SLOT_RADIUS[args.slotKind];

  // Angular position within the 90° quadrant arc. Uniform spread between
  // ANGULAR_PADDING and π/2 - ANGULAR_PADDING; angle=0 hugs the X axis,
  // angle=π/2 hugs the Y axis.
  const hashAngle = hashStringTo01(args.guideId + "::angle");
  const angle =
    ANGULAR_PADDING + hashAngle * (Math.PI / 2 - 2 * ANGULAR_PADDING);

  // Tiny radial jitter so multiple cards on the same ring don't perfectly
  // stack. arcScore biases the jitter direction (high arcScore = pulled
  // very slightly inward within the same ring) so within a slot, the
  // strongest-fit card sits a hair closer than the rest.
  const hashRadial = hashStringTo01(args.guideId + "::radial");
  const arcPull = 1 - Math.max(0, Math.min(1, args.arcScore)); // 0 = best fit
  const jitter =
    (hashRadial - 0.5) * 1.4 * RADIAL_JITTER +
    (arcPull - 0.5) * 0.6 * RADIAL_JITTER;
  const radius = baseRadius + jitter;

  // Polar → Cartesian, with quadrant signs flipping into the right corner.
  // cos(angle) along the X axis, sin(angle) along the Y axis; signs send
  // the result into the appropriate quadrant.
  const x = sign.x * radius * Math.cos(angle);
  const y = sign.y * radius * Math.sin(angle);

  return { x, y };
}

// Margin past the outer card position so the lane labels sit at the visual
// centre of each quadrant tint cell without crowding the outermost cards.
// Now that the canvas is plain CSS (no React Flow fitView), this is purely
// a layout offset for label placement, the canvas extent is fixed by the
// virtual canvas dimensions in DiscoverCanvas.
const ANCHOR_OFFSET = 80;

// Centre of each quadrant, used by DiscoverCanvas for lane label positions.
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
