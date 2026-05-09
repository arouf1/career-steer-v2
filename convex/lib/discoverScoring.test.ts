import { describe, it, expect } from "vitest";
import {
  cosineSim,
  clamp01,
  compareStages,
  STAGE_RANK,
} from "./discoverScoring";

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

describe("clamp01", () => {
  it("clamps below 0", () => expect(clamp01(-0.5)).toBe(0));
  it("clamps above 1", () => expect(clamp01(1.5)).toBe(1));
  it("passes in-range", () => expect(clamp01(0.42)).toBe(0.42));
});

describe("compareStages", () => {
  it("returns 'forward' when guide stage is higher than user stage", () => {
    expect(compareStages("mid-career", "manager")).toBe("forward");
    expect(compareStages("manager", "director")).toBe("forward");
    expect(compareStages("director", "exec")).toBe("forward");
    expect(compareStages("early-career", "exec")).toBe("forward");
  });

  it("returns 'sideways' when guide stage equals user stage", () => {
    expect(compareStages("mid-career", "mid-career")).toBe("sideways");
    expect(compareStages("manager", "manager")).toBe("sideways");
    // senior-IC and manager share the same rank (both at 7+ yrs / comparable
    // scope) so they're sideways relative to each other.
    expect(compareStages("senior-IC", "manager")).toBe("sideways");
    expect(compareStages("manager", "senior-IC")).toBe("sideways");
  });

  it("returns 'earlier' when guide stage is lower than user stage", () => {
    expect(compareStages("manager", "mid-career")).toBe("earlier");
    expect(compareStages("director", "manager")).toBe("earlier");
    expect(compareStages("exec", "early-career")).toBe("earlier");
  });

  it("returns 'unknown' when either side is missing", () => {
    expect(compareStages(undefined, "manager")).toBe("unknown");
    expect(compareStages("manager", undefined)).toBe("unknown");
    expect(compareStages(undefined, undefined)).toBe("unknown");
  });

  it("returns 'unknown' when either side is unrecognised", () => {
    expect(compareStages("not-a-stage", "manager")).toBe("unknown");
    expect(compareStages("manager", "not-a-stage")).toBe("unknown");
  });

  it("treats 'transitioning' (profile-only) as mid-career rank", () => {
    // Sideways relative to other mid-career-rank stages.
    expect(compareStages("transitioning", "mid-career")).toBe("sideways");
    // Forward to senior stages.
    expect(compareStages("transitioning", "manager")).toBe("forward");
    // Earlier than... nothing (it's the lowest practical rank besides early).
    expect(compareStages("transitioning", "early-career")).toBe("earlier");
  });

  it("STAGE_RANK is monotonically ordered for the canonical career path", () => {
    expect(STAGE_RANK["early-career"]).toBeLessThan(STAGE_RANK["mid-career"]);
    expect(STAGE_RANK["mid-career"]).toBeLessThan(STAGE_RANK["manager"]);
    expect(STAGE_RANK["manager"]).toBeLessThan(STAGE_RANK["director"]);
    expect(STAGE_RANK["director"]).toBeLessThan(STAGE_RANK["exec"]);
  });
});
