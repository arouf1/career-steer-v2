import { describe, it, expect } from "vitest";
import {
  positionCard,
  QUADRANT_CENTER,
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

  it("respects INNER_PADDING — no card sits closer than INNER_PADDING to the user node", () => {
    // Polar layout: distance from origin is anchored to the slot's ring
    // radius (strong=360 ≫ INNER_PADDING=160). The relevant safety check
    // is the radial distance from origin, not per-axis distance — under
    // the polar layout a card near the angular edge of its quadrant
    // legitimately has a small |x| or |y| while still being far from the
    // user node radially.
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
        const radius = Math.sqrt(p.x ** 2 + p.y ** 2);
        expect(radius).toBeGreaterThanOrEqual(INNER_PADDING);
      }
    }
  });

  it("respects outer bounds — extras ring stays within the canvas's logical extent", () => {
    // Polar layout: extras anchor at r=840, which is outside the rectangular
    // QUADRANT_HALF_WIDTH × QUADRANT_HALF_HEIGHT but inside the canvas's
    // logical viewport (the rings at r=840 and beyond are rendered too).
    // Assert against the radial bound instead — radius shouldn't drift more
    // than RADIAL_JITTER past the extras ring radius.
    const EXTRA_RING = 840;
    const RADIAL_JITTER_BUDGET = 30; // generous: accounts for jitter + arc-pull bias
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
        const radius = Math.sqrt(p.x ** 2 + p.y ** 2);
        expect(radius).toBeLessThanOrEqual(EXTRA_RING + RADIAL_JITTER_BUDGET);
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

  it("strong-slot cards sit closer to the user than aspirational-slot cards (averaged)", () => {
    // With slot bias dominating, strong (0.18 bias) sits closer than aspirational
    // (0.78 bias). Wider scatter means individual cards may flip — average over a
    // sample so the slot-distance ordering shows up reliably.
    let strongTotal = 0;
    let aspTotal = 0;
    const N = 50;
    for (let i = 0; i < N; i++) {
      const strong = positionCard({
        lane: "linear",
        slotKind: "strong",
        arcScore: 0.5,
        guideId: `g${i}`,
      });
      const asp = positionCard({
        lane: "linear",
        slotKind: "aspirational",
        arcScore: 0.5,
        guideId: `g${i}`,
      });
      strongTotal += Math.sqrt(strong.x ** 2 + strong.y ** 2);
      aspTotal += Math.sqrt(asp.x ** 2 + asp.y ** 2);
    }
    expect(aspTotal / N).toBeGreaterThan(strongTotal / N);
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
