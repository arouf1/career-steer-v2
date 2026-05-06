import { haversineKm } from "./haversine";
import type { Id } from "../_generated/dataModel";

export type LadderCandidate = {
  _id: Id<"job_postings">;
  gps?: { lat: number; lon: number };
  countryCode?: string;
  lastSeenAt: number;
  citySlug?: string;
};

export type LadderViewer = {
  lat?: number;
  lon?: number;
  countryCode?: string;
};

export type LadderHit = "radius" | "country" | "anywhere";

export type LadderResult<T extends LadderCandidate> = {
  picked: T[];
  ladderHit: LadderHit;
};

export function applyLocationLadder<T extends LadderCandidate>(
  candidates: T[],
  viewer: LadderViewer,
  limit: number,
  radiusKm: number,
): LadderResult<T> {
  if (viewer.lat !== undefined && viewer.lon !== undefined) {
    const within = candidates
      .filter((c) => c.gps !== undefined)
      .map((c) => ({
        c,
        d: haversineKm(viewer.lat!, viewer.lon!, c.gps!.lat, c.gps!.lon),
      }))
      .filter((x) => x.d <= radiusKm)
      .sort((a, b) => a.d - b.d);

    if (within.length > 0) {
      return {
        picked: within.slice(0, limit).map((x) => x.c),
        ladderHit: "radius",
      };
    }
  }

  if (viewer.countryCode) {
    const sameCountry = candidates
      .filter((c) => c.countryCode === viewer.countryCode)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);

    if (sameCountry.length > 0) {
      return {
        picked: sameCountry.slice(0, limit),
        ladderHit: "country",
      };
    }
  }

  const anywhere = [...candidates].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return {
    picked: anywhere.slice(0, limit),
    ladderHit: "anywhere",
  };
}
