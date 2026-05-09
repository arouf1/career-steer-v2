import { describe, it, expect } from "vitest";
import {
  TIER_ORDER,
  TIER_RANK,
  compareTiers,
  isAboveTier,
  isBelowTier,
  isPeerTier,
  tierFromLegacyStage,
} from "./ladders";

describe("TIER_ORDER", () => {
  it("matches the schema's tier vocabulary in altitude order", () => {
    expect(TIER_ORDER).toEqual([
      "ic-entry",
      "ic-mid",
      "ic-senior",
      "manager",
      "head",
      "director",
      "vp",
      "c-suite",
    ]);
  });

  it("TIER_RANK is monotonically ascending in TIER_ORDER", () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      expect(TIER_RANK[TIER_ORDER[i]]).toBeGreaterThan(
        TIER_RANK[TIER_ORDER[i - 1]],
      );
    }
  });
});

describe("compareTiers", () => {
  it("returns -1 when first tier is below second", () => {
    expect(compareTiers("ic-mid", "ic-senior")).toBe(-1);
    expect(compareTiers("ic-entry", "c-suite")).toBe(-1);
    expect(compareTiers("manager", "director")).toBe(-1);
  });

  it("returns 0 when tiers are equal", () => {
    expect(compareTiers("ic-senior", "ic-senior")).toBe(0);
    expect(compareTiers("c-suite", "c-suite")).toBe(0);
  });

  it("returns 1 when first tier is above second", () => {
    expect(compareTiers("ic-senior", "ic-mid")).toBe(1);
    expect(compareTiers("c-suite", "ic-entry")).toBe(1);
    expect(compareTiers("director", "manager")).toBe(1);
  });

  it("places head between manager and director", () => {
    expect(compareTiers("head", "manager")).toBe(1);
    expect(compareTiers("head", "director")).toBe(-1);
  });

  it("places vp between director and c-suite", () => {
    expect(compareTiers("vp", "director")).toBe(1);
    expect(compareTiers("vp", "c-suite")).toBe(-1);
  });
});

describe("isAboveTier / isBelowTier / isPeerTier", () => {
  it("isAboveTier returns true when candidate sits higher", () => {
    // Aqil = ic-senior. Head of Product = head. Should be above.
    expect(isAboveTier("head", "ic-senior")).toBe(true);
    expect(isAboveTier("c-suite", "ic-senior")).toBe(true);
    expect(isAboveTier("ic-senior", "ic-senior")).toBe(false);
    expect(isAboveTier("ic-mid", "ic-senior")).toBe(false);
  });

  it("isBelowTier returns true when candidate sits lower", () => {
    expect(isBelowTier("ic-mid", "ic-senior")).toBe(true);
    expect(isBelowTier("ic-entry", "ic-senior")).toBe(true);
    expect(isBelowTier("ic-senior", "ic-senior")).toBe(false);
    expect(isBelowTier("manager", "ic-senior")).toBe(false);
  });

  it("isPeerTier returns true only when ranks match", () => {
    expect(isPeerTier("ic-senior", "ic-senior")).toBe(true);
    expect(isPeerTier("manager", "manager")).toBe(true);
    expect(isPeerTier("manager", "ic-senior")).toBe(false);
    expect(isPeerTier("head", "director")).toBe(false);
  });
});

describe("tierFromLegacyStage", () => {
  it("maps every legacy stage to a new tier", () => {
    expect(tierFromLegacyStage("early-career")).toBe("ic-entry");
    expect(tierFromLegacyStage("mid-career")).toBe("ic-mid");
    expect(tierFromLegacyStage("senior-IC")).toBe("ic-senior");
    expect(tierFromLegacyStage("manager")).toBe("manager");
    expect(tierFromLegacyStage("director")).toBe("director");
    expect(tierFromLegacyStage("exec")).toBe("c-suite");
  });

  it("returns null when stage is undefined", () => {
    expect(tierFromLegacyStage(undefined)).toBeNull();
  });
});
