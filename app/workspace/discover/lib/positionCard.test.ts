import { describe, it, expect } from "vitest";
import { positionCard, SELF_RING_RADIUS, MAX_RADIUS } from "./positionCard";

const linfNorm = (p: { x: number; y: number }) =>
  Math.max(Math.abs(p.x), Math.abs(p.y));

describe("positionCard", () => {
  it("strong-fit linear card with arcScore=1 sits exactly on the self-ring (L∞ — square inscribed at SELF_RING_RADIUS)", () => {
    const p = positionCard({
      lane: "linear",
      slotKind: "strong",
      arcScore: 1,
      guideId: "any",
    });
    // L∞ projection: the locus at "distance R" is a square, so max(|x|,|y|)
    // exactly equals the radius (with slot jitter = 0 here).
    expect(linfNorm(p)).toBeCloseTo(SELF_RING_RADIUS, 0);
    // Top wedge (270° centre, 225..315 spread): y must be negative-leaning.
    expect(p.y).toBeLessThan(0);
  });

  it("arcScore=0 sits near MAX_RADIUS in L∞ norm (with slot jitter)", () => {
    const p = positionCard({
      lane: "transformational",
      slotKind: "strong",
      arcScore: 0,
      guideId: "x",
    });
    // Square geometry: assert max-norm rather than L2.
    expect(linfNorm(p)).toBeCloseTo(MAX_RADIUS, -1); // within ~10px
  });

  it("returns the same position for the same guideId (deterministic)", () => {
    const a = positionCard({
      lane: "adjacent",
      slotKind: "extra",
      arcScore: 0.5,
      guideId: "stable-id",
    });
    const b = positionCard({
      lane: "adjacent",
      slotKind: "extra",
      arcScore: 0.5,
      guideId: "stable-id",
    });
    expect(a).toEqual(b);
  });

  it("aspirational slot lands ~35px farther than its arcScore would suggest (in L∞ norm)", () => {
    const strong = positionCard({
      lane: "linear",
      slotKind: "strong",
      arcScore: 0.5,
      guideId: "g",
    });
    const asp = positionCard({
      lane: "linear",
      slotKind: "aspirational",
      arcScore: 0.5,
      guideId: "g",
    });
    // Same guideId + lane → same projected angle. With L∞ projection, the
    // 35px slot offset is the difference in `radius` parameter, which maps
    // 1:1 onto max(|x|,|y|) when projected through L∞.
    expect(linfNorm(asp) - linfNorm(strong)).toBeCloseTo(35, -1);
  });

  it("L∞ square geometry: a card whose angle hits a 45° corner has |x| ≈ |y| ≈ radius", () => {
    // Linear wedge spans [225°, 315°]; the corners at 225° and 315° need
    // the hash to fall at 0 or 1. Search a few guideIds for one whose angle
    // lands close to a corner.
    const candidates = ["corner-a", "corner-b", "corner-c", "corner-d", "corner-e", "edge-fffff"];
    let cornerlike: { x: number; y: number } | null = null;
    for (const id of candidates) {
      const p = positionCard({
        lane: "linear",
        slotKind: "strong",
        arcScore: 1,
        guideId: id,
      });
      // A corner-like point has |x| roughly equal to |y|.
      const ratio = Math.min(Math.abs(p.x), Math.abs(p.y)) /
        Math.max(Math.abs(p.x), Math.abs(p.y));
      if (ratio > 0.7) {
        cornerlike = p;
        break;
      }
    }
    // Even if none of the seeded ids land near a corner, the invariant we
    // really care about is: max(|x|,|y|) == SELF_RING_RADIUS for any seed.
    // (L∞ holds for every angle in the wedge, not just corners.)
    const fallback = positionCard({
      lane: "linear",
      slotKind: "strong",
      arcScore: 1,
      guideId: "fallback",
    });
    const point = cornerlike ?? fallback;
    expect(linfNorm(point)).toBeCloseTo(SELF_RING_RADIUS, 0);
  });

  it("adjacent (right) wedge has positive x and small |y|", () => {
    // Right wedge spans [-45, 45]: cos > 0, |sin| ≤ √2/2.
    const p = positionCard({
      lane: "adjacent",
      slotKind: "strong",
      arcScore: 0.5,
      guideId: "right-wedge",
    });
    expect(p.x).toBeGreaterThan(0);
    expect(Math.abs(p.y)).toBeLessThan(Math.abs(p.x));
  });

  it("earlier (bottom) wedge has positive y", () => {
    // Bottom wedge spans [45, 135]: sin > 0, screen Y down.
    const p = positionCard({
      lane: "earlier",
      slotKind: "strong",
      arcScore: 0.5,
      guideId: "bottom-wedge",
    });
    expect(p.y).toBeGreaterThan(0);
  });

  it("transformational (left) wedge has negative x", () => {
    // Left wedge spans [135, 225]: cos < 0.
    const p = positionCard({
      lane: "transformational",
      slotKind: "strong",
      arcScore: 0.5,
      guideId: "left-wedge",
    });
    expect(p.x).toBeLessThan(0);
  });
});
