import { describe, it, expect } from "vitest";
import { haversineKm } from "./haversine";

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(51.5074, -0.1278, 51.5074, -0.1278)).toBeCloseTo(0, 6);
  });

  it("computes London → Paris within 1km of 344km", () => {
    const d = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(343);
    expect(d).toBeLessThan(345);
  });

  it("computes London → New York within 5km of 5570km", () => {
    const d = haversineKm(51.5074, -0.1278, 40.7128, -74.006);
    expect(d).toBeGreaterThan(5565);
    expect(d).toBeLessThan(5575);
  });

  it("handles antipodal points symmetrically", () => {
    const a = haversineKm(0, 0, 0, 180);
    const b = haversineKm(0, 180, 0, 0);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeGreaterThan(20015);
    expect(a).toBeLessThan(20020);
  });

  it("handles equator + cross-180 longitude", () => {
    const d = haversineKm(0, 179, 0, -179);
    expect(d).toBeGreaterThan(220);
    expect(d).toBeLessThan(225);
  });
});
