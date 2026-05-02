import { describe, it, expect } from "vitest";
import { cosineSim, assignLane, clamp01 } from "./discoverScoring";

describe("cosineSim", () => {
  it("returns 1.0 for identical vectors", () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns clamped 0 for opposite vectors (negative cosine)", () => {
    expect(cosineSim([1, 0], [-1, 0])).toBe(0);
  });

  it("throws on dimension mismatch", () => {
    expect(() => cosineSim([1, 0], [1, 0, 0])).toThrow();
  });

  it("returns 0 if either vector is all zeros (avoid NaN)", () => {
    expect(cosineSim([0, 0, 0], [1, 1, 1])).toBe(0);
    expect(cosineSim([1, 1, 1], [0, 0, 0])).toBe(0);
  });
});

describe("assignLane", () => {
  it("assigns >= 0.75 to linear", () => {
    expect(assignLane(0.75)).toBe("linear");
    expect(assignLane(0.95)).toBe("linear");
  });

  it("assigns 0.6..<0.75 to adjacent", () => {
    expect(assignLane(0.6)).toBe("adjacent");
    expect(assignLane(0.7499)).toBe("adjacent");
  });

  it("assigns < 0.6 to transformational", () => {
    expect(assignLane(0.5999)).toBe("transformational");
    expect(assignLane(0)).toBe("transformational");
  });
});

describe("clamp01", () => {
  it("clamps below 0", () => expect(clamp01(-0.5)).toBe(0));
  it("clamps above 1", () => expect(clamp01(1.5)).toBe(1));
  it("passes in-range", () => expect(clamp01(0.42)).toBe(0.42));
});
