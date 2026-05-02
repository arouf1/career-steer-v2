import { describe, it, expect } from "vitest";
import { positionCard, SELF_RING_RADIUS, MAX_RADIUS } from "./positionCard";

describe("positionCard", () => {
  it("strong-fit linear card with arcScore=1 sits exactly on the self-ring at 12 o'clock area", () => {
    const p = positionCard({
      lane: "linear",
      slotKind: "strong",
      arcScore: 1,
      guideId: "any",
    });
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    expect(r).toBeCloseTo(SELF_RING_RADIUS, 0);
    // Top wedge (270° centre, 225..315 spread): y must be negative-leaning.
    expect(p.y).toBeLessThan(0);
  });

  it("arcScore=0 sits near MAX_RADIUS (with slot jitter)", () => {
    const p = positionCard({
      lane: "transformational",
      slotKind: "strong",
      arcScore: 0,
      guideId: "x",
    });
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    expect(r).toBeCloseTo(MAX_RADIUS, -1); // within ~10px
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

  it("aspirational slot lands ~35px farther than its arcScore would suggest", () => {
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
    const rStrong = Math.sqrt(strong.x ** 2 + strong.y ** 2);
    const rAsp = Math.sqrt(asp.x ** 2 + asp.y ** 2);
    expect(rAsp - rStrong).toBeCloseTo(35, -1);
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
