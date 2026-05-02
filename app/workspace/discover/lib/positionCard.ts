export const SELF_RING_RADIUS = 140;
export const MAX_RADIUS = 720;

const WEDGE_DEGREES = {
  // Screen coords (CCW from +X, Y grows downward).
  // Wedge centres: linear = top, adjacent = lower-right, transformational = lower-left.
  linear: { startDeg: 240, endDeg: 300 },        // 240..300 maps to upper half
  adjacent: { startDeg: 0, endDeg: 60 },          // lower-right
  transformational: { startDeg: 120, endDeg: 180 }, // lower-left
} as const;

const SLOT_JITTER = {
  strong: 0,
  bridge: 15,
  aspirational: 35,
  extra: 8,
} as const;

type Lane = "linear" | "adjacent" | "transformational";
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
  const wedge = WEDGE_DEGREES[args.lane];
  const wedgeArc = wedge.endDeg - wedge.startDeg;
  const angleDeg = wedge.startDeg + hashStringTo01(args.guideId) * wedgeArc;
  const angleRad = (angleDeg * Math.PI) / 180;

  // Screen coords: y grows downward, so we flip the sin term.
  // For the LINEAR lane (240..300 deg), sin(240..300) is negative — that maps to negative y (upward), correct.
  // For ADJACENT (0..60), sin is positive → y positive (downward), correct.
  // So: x = r*cos, y = r*sin (no extra flip).

  const baseRadius =
    SELF_RING_RADIUS + (1 - args.arcScore) * (MAX_RADIUS - SELF_RING_RADIUS);
  const radius = baseRadius + SLOT_JITTER[args.slotKind];

  return {
    x: radius * Math.cos(angleRad),
    y: radius * Math.sin(angleRad),
  };
}
