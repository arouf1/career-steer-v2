import { describe, expect, it } from "vitest";
import {
  brandfetchLogoUrl,
  normaliseHits,
  pickBestHit,
} from "./brandfetch";

describe("normaliseHits", () => {
  it("returns empty for non-array input", () => {
    expect(normaliseHits(null)).toEqual([]);
    expect(normaliseHits(undefined)).toEqual([]);
    expect(normaliseHits("not an array")).toEqual([]);
    expect(normaliseHits({})).toEqual([]);
  });

  it("maps a well-formed Brandfetch response", () => {
    const raw = [
      {
        name: "Acme Inc",
        domain: "acme.com",
        icon: "https://cdn.brandfetch.io/acme.com/icon",
        brandId: "abc123",
        claimed: true,
      },
    ];
    expect(normaliseHits(raw)).toEqual([
      {
        name: "Acme Inc",
        domain: "acme.com",
        icon: "https://cdn.brandfetch.io/acme.com/icon",
        brandId: "abc123",
        claimed: true,
      },
    ]);
  });

  it("drops entries missing required fields", () => {
    const raw = [
      { name: "Good", domain: "good.com", brandId: "g1" },
      { name: "Missing brandId", domain: "x.com" }, // dropped
      { domain: "noname.com", brandId: "b1" }, // dropped
      { name: "Empty domain", domain: "", brandId: "b2" }, // dropped
    ];
    expect(normaliseHits(raw)).toHaveLength(1);
  });

  it("treats missing icon as null and missing claimed as false", () => {
    const raw = [{ name: "Acme", domain: "acme.com", brandId: "b1" }];
    const hit = normaliseHits(raw)[0];
    expect(hit.icon).toBeNull();
    expect(hit.claimed).toBe(false);
  });

  it("treats empty-string icon as null", () => {
    const raw = [
      { name: "Acme", domain: "acme.com", brandId: "b1", icon: "" },
    ];
    expect(normaliseHits(raw)[0].icon).toBeNull();
  });
});

describe("pickBestHit", () => {
  const claimed = {
    name: "Acme Inc",
    domain: "acme.com",
    icon: null,
    brandId: "b1",
    claimed: true,
  };
  const unclaimed = {
    name: "Acme",
    domain: "acme.io",
    icon: null,
    brandId: "b2",
    claimed: false,
  };

  it("returns null on empty input", () => {
    expect(pickBestHit([], true)).toBeNull();
    expect(pickBestHit([], false)).toBeNull();
  });

  it("returns first hit when takeFirstClaimed is false", () => {
    expect(pickBestHit([unclaimed, claimed], false)).toEqual(unclaimed);
  });

  it("prefers the first claimed hit when takeFirstClaimed is true", () => {
    expect(pickBestHit([unclaimed, claimed], true)).toEqual(claimed);
  });

  it("falls back to first hit when no claimed exist", () => {
    expect(pickBestHit([unclaimed], true)).toEqual(unclaimed);
  });
});

describe("brandfetchLogoUrl", () => {
  it("uses the stable Brandfetch CDN URL pattern", () => {
    expect(brandfetchLogoUrl("acme.com")).toBe(
      "https://cdn.brandfetch.io/acme.com/w/256/h/256/icon",
    );
  });

  it("URL-encodes domains containing reserved characters", () => {
    expect(brandfetchLogoUrl("a/b.com")).toBe(
      "https://cdn.brandfetch.io/a%2Fb.com/w/256/h/256/icon",
    );
  });
});
