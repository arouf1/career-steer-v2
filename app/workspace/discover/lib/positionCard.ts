export const SELF_RING_RADIUS = 140;
export const MAX_RADIUS = 720;

// 4-wedge cardinal-compass layout. Each wedge spans 90° and is centred on
// one of the four cardinals (top / right / bottom / left). Together they
// cover the full canvas — no dead zones — so every lane can splay outward
// from the centre user node along a clear direction.
//
// Screen coords (CCW from +X, Y grows downward):
//   linear            top    270° centre,  225..315 wedge
//   adjacent          right    0° centre,  -45..+45 wedge (handled via shift)
//   earlier           bottom  90° centre,   45..135  wedge
//   transformational  left   180° centre,  135..225  wedge
//
// The "right" wedge wraps around 0° so we offset its start by -45° in the
// position calc below — the resulting angles span [-45, 45] which is
// trigonometrically equivalent to [315, 405].
const WEDGE = {
  linear: { centerDeg: 270, spreadDeg: 90 },
  adjacent: { centerDeg: 0, spreadDeg: 90 },
  earlier: { centerDeg: 90, spreadDeg: 90 },
  transformational: { centerDeg: 180, spreadDeg: 90 },
} as const;

const SLOT_JITTER = {
  strong: 0,
  bridge: 15,
  aspirational: 35,
  extra: 8,
} as const;

type Lane = "linear" | "adjacent" | "earlier" | "transformational";
type Slot = "strong" | "bridge" | "aspirational" | "extra";

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
  const wedge = WEDGE[args.lane];
  const angleDeg =
    wedge.centerDeg -
    wedge.spreadDeg / 2 +
    hashStringTo01(args.guideId) * wedge.spreadDeg;
  const angleRad = (angleDeg * Math.PI) / 180;

  // Screen coords: y grows downward. cos/sin of the angle puts the card on
  // the correct side of the user node automatically:
  //   top    (270°) → cos≈0,  sin≈-1 → y negative (upward)
  //   right    (0°) → cos=1,  sin=0  → x positive
  //   bottom  (90°) → cos≈0,  sin=1  → y positive (downward)
  //   left   (180°) → cos=-1, sin≈0  → x negative
  const baseRadius =
    SELF_RING_RADIUS + (1 - args.arcScore) * (MAX_RADIUS - SELF_RING_RADIUS);
  const radius = baseRadius + SLOT_JITTER[args.slotKind];

  // L∞ (max-norm / Chebyshev) projection so the locus at "distance R" is a
  // SQUARE inscribed at that radius — not a circle. With 4 cardinal-direction
  // wedges, the cards in each lane then sit along one straight EDGE of the
  // square frame around the user, instead of along an arc of a diamond.
  //
  // - At cardinal angles (0°, 90°, 180°, 270°): denom = 1 → unchanged.
  // - At 45° corners: denom = √2/2 ≈ 0.707 → scale ×√2 ≈ 1.41 outward to
  //   reach the corner of the square inscribed at `radius`.
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const denom = Math.max(Math.abs(cos), Math.abs(sin));
  const k = denom === 0 ? 0 : radius / denom;

  return {
    x: k * cos,
    y: k * sin,
  };
}
