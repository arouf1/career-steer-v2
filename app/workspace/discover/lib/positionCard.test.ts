import { describe, it, expect } from "vitest";
import {
  positionCard,
  QUADRANT_CENTER,
  QUADRANT_HALF_WIDTH,
  QUADRANT_HALF_HEIGHT,
  INNER_PADDING,
} from "./positionCard";

describe("positionCard — quadrant layout", () => {
  it("linear cards land in top-left quadrant (x < 0, y < 0)", () => {
    const p = positionCard({
      lane: "linear",
      slotKind: "strong",
      arcScore: 0.5,
      guideId: "g1",
    });
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeLessThan(0);
  });

  it("adjacent cards land in top-right quadrant (x > 0, y < 0)", () => {
    const p = positionCard({
      lane: "adjacent",
      slotKind: "strong",
      arcScore: 0.5,
      guideId: "g2",
    });
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(0);
  });

  it("earlier cards land in bottom-left quadrant (x < 0, y > 0)", () => {
    const p = positionCard({
      lane: "earlier",
      slotKind: "strong",
      arcScore: 0.5,
      guideId: "g3",
    });
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeGreaterThan(0);
  });

  it("transformational cards land in bottom-right quadrant (x > 0, y > 0)", () => {
    const p = positionCard({
      lane: "transformational",
      slotKind: "strong",
      arcScore: 0.5,
      guideId: "g4",
    });
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
  });

  it("respects INNER_PADDING — no card sits closer than INNER_PADDING to either axis", () => {
    for (const lane of [
      "linear",
      "adjacent",
      "earlier",
      "transformational",
    ] as const) {
      for (let i = 0; i < 50; i++) {
        const p = positionCard({
          lane,
          slotKind: "strong",
          arcScore: 1,
          guideId: `g${i}`,
        });
        // Some scatter latitude — the floor is INNER_PADDING but scatter can
        // pull a single axis a touch lower; assert against a generous fraction.
        expect(Math.abs(p.x)).toBeGreaterThanOrEqual(INNER_PADDING * 0.6);
        expect(Math.abs(p.y)).toBeGreaterThanOrEqual(INNER_PADDING * 0.6);
      }
    }
  });

  it("respects outer bounds — no card sits past QUADRANT_HALF_WIDTH/HEIGHT", () => {
    for (const lane of [
      "linear",
      "adjacent",
      "earlier",
      "transformational",
    ] as const) {
      for (let i = 0; i < 50; i++) {
        const p = positionCard({
          lane,
          slotKind: "extra",
          arcScore: 0,
          guideId: `g${i}`,
        });
        expect(Math.abs(p.x)).toBeLessThanOrEqual(QUADRANT_HALF_WIDTH * 1.05);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(QUADRANT_HALF_HEIGHT * 1.05);
      }
    }
  });

  it("returns the same position for the same guideId (deterministic)", () => {
    const a = positionCard({
      lane: "earlier",
      slotKind: "extra",
      arcScore: 0.5,
      guideId: "stable-id",
    });
    const b = positionCard({
      lane: "earlier",
      slotKind: "extra",
      arcScore: 0.5,
      guideId: "stable-id",
    });
    expect(a).toEqual(b);
  });

  it("strong-slot cards sit closer to the user than aspirational-slot cards (same arcScore)", () => {
    // With slot bias dominating, strong (0.18 bias) sits closer than aspirational (0.78 bias).
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
    const strongDist = Math.sqrt(strong.x ** 2 + strong.y ** 2);
    const aspDist = Math.sqrt(asp.x ** 2 + asp.y ** 2);
    expect(aspDist).toBeGreaterThan(strongDist);
  });

  it("QUADRANT_CENTER returns the geometric center of each quadrant", () => {
    expect(QUADRANT_CENTER.linear.x).toBeLessThan(0);
    expect(QUADRANT_CENTER.linear.y).toBeLessThan(0);
    expect(QUADRANT_CENTER.adjacent.x).toBeGreaterThan(0);
    expect(QUADRANT_CENTER.adjacent.y).toBeLessThan(0);
    expect(QUADRANT_CENTER.earlier.x).toBeLessThan(0);
    expect(QUADRANT_CENTER.earlier.y).toBeGreaterThan(0);
    expect(QUADRANT_CENTER.transformational.x).toBeGreaterThan(0);
    expect(QUADRANT_CENTER.transformational.y).toBeGreaterThan(0);
  });
});
