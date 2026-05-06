import { describe, it, expect } from "vitest";
import { describeLadderHit } from "./microcopy";

describe("describeLadderHit", () => {
  it("returns city-only label when all picked share the closest citySlug", () => {
    const result = describeLadderHit({
      ladderHit: "radius",
      pickedCitySlugs: ["london", "london", "london"],
      viewerCityLabel: "London",
      viewerCountryLabel: "the UK",
      total: 3,
    });
    expect(result).toBe("3 in London");
  });

  it("returns radius label when picked cards span multiple cities", () => {
    const result = describeLadderHit({
      ladderHit: "radius",
      pickedCitySlugs: ["london", "slough", "london"],
      viewerCityLabel: "London",
      viewerCountryLabel: "the UK",
      total: 3,
    });
    expect(result).toBe("3 within 50 km of London");
  });

  it("falls back to nearby label when no viewer city", () => {
    const result = describeLadderHit({
      ladderHit: "radius",
      pickedCitySlugs: ["london"],
      viewerCityLabel: undefined,
      viewerCountryLabel: "the UK",
      total: 1,
    });
    expect(result).toBe("1 nearby");
  });

  it("returns country label for country rung", () => {
    const result = describeLadderHit({
      ladderHit: "country",
      pickedCitySlugs: ["london", "manchester"],
      viewerCityLabel: "London",
      viewerCountryLabel: "the UK",
      total: 8,
    });
    expect(result).toBe("8 in the UK");
  });

  it("returns global label for anywhere rung", () => {
    const result = describeLadderHit({
      ladderHit: "anywhere",
      pickedCitySlugs: ["nyc"],
      viewerCityLabel: undefined,
      viewerCountryLabel: undefined,
      total: 12,
    });
    expect(result).toBe("12 globally");
  });

  it("renders correctly for total === 1", () => {
    const result = describeLadderHit({
      ladderHit: "country",
      pickedCitySlugs: ["london"],
      viewerCityLabel: "London",
      viewerCountryLabel: "the UK",
      total: 1,
    });
    expect(result).toBe("1 in the UK");
  });
});
