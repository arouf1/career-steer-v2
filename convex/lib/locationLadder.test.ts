import { describe, it, expect } from "vitest";
import { applyLocationLadder, type LadderCandidate } from "./locationLadder";
import type { Id } from "../_generated/dataModel";

const job = (
  id: string,
  lat: number,
  lon: number,
  countryCode: string | undefined,
  lastSeenAt: number,
  citySlug = "x",
): LadderCandidate => ({
  _id: id as Id<"job_postings">,
  gps: { lat, lon },
  countryCode,
  lastSeenAt,
  citySlug,
});

describe("applyLocationLadder", () => {
  it("returns radius rung when ≥1 candidate within 50km, sorted by distance", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" };
    const cands = [
      job("a", 51.5074, -0.1278, "gb", 1),
      job("b", 51.5556, -0.2796, "gb", 2),
      job("c", 48.8566, 2.3522, "fr", 3),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("radius");
    expect(result.picked.map((p) => p._id)).toEqual(["a", "b"]);
  });

  it("falls through to country rung when no candidate within radius", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" };
    const cands = [
      job("a", 53.4808, -2.2426, "gb", 100),
      job("b", 55.9533, -3.1883, "gb", 200),
      job("c", 48.8566, 2.3522, "fr", 300),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("country");
    expect(result.picked.map((p) => p._id)).toEqual(["b", "a"]);
  });

  it("falls through to anywhere when no country match", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" };
    const cands = [
      job("a", 48.8566, 2.3522, "fr", 1),
      job("b", 40.7128, -74.006, "us", 2),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("anywhere");
    expect(result.picked.map((p) => p._id)).toEqual(["b", "a"]);
  });

  it("skips radius rung when viewer has no lat/lon", () => {
    const viewer = { countryCode: "gb" };
    const cands = [
      job("a", 51.5074, -0.1278, "gb", 1),
      job("b", 48.8566, 2.3522, "fr", 2),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("country");
    expect(result.picked.map((p) => p._id)).toEqual(["a"]);
  });

  it("skips country rung when viewer has no countryCode", () => {
    const viewer = {};
    const cands = [
      job("a", 51.5074, -0.1278, "gb", 1),
      job("b", 48.8566, 2.3522, "fr", 2),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("anywhere");
    expect(result.picked.map((p) => p._id)).toEqual(["b", "a"]);
  });

  it("respects limit", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" };
    const cands = Array.from({ length: 10 }, (_, i) =>
      job(`j${i}`, 51.5 + i * 0.001, -0.13, "gb", i),
    );
    const result = applyLocationLadder(cands, viewer, 3, 50);
    expect(result.picked).toHaveLength(3);
  });

  it("excludes candidates without gps from radius rung", () => {
    const viewer = { lat: 51.5074, lon: -0.1278, countryCode: "gb" };
    const cands: LadderCandidate[] = [
      { ...job("a", 51.5074, -0.1278, "gb", 1), gps: undefined },
      job("b", 51.5556, -0.2796, "gb", 2),
    ];
    const result = applyLocationLadder(cands, viewer, 5, 50);
    expect(result.ladderHit).toBe("radius");
    expect(result.picked.map((p) => p._id)).toEqual(["b"]);
  });
});
