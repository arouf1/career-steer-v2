// Pure helpers for the career_ladders + career_guide_ladder_positions tables.
// No DB access — keep this file safe to import from queries, mutations, and
// actions alike, and to unit-test without convex-test scaffolding.

export type Tier =
  | "ic-entry"
  | "ic-mid"
  | "ic-senior"
  | "manager"
  | "head"
  | "director"
  | "vp"
  | "c-suite";

export type LadderFamily =
  | "product"
  | "engineering"
  | "design"
  | "data"
  | "marketing"
  | "sales"
  | "finance"
  | "legal"
  | "operations"
  | "people"
  | "customer-success"
  | "research"
  | "healthcare"
  | "education"
  | "trades"
  | "creative"
  | "other";

// Canonical altitude order. Index = "altitude" — higher index means higher
// scope. Used for cross-tier comparisons (Linear lane = candidate tier above
// user tier; Earlier lane = candidate tier below; Adjacent = peer tier on a
// different ladder).
export const TIER_ORDER: readonly Tier[] = [
  "ic-entry",
  "ic-mid",
  "ic-senior",
  "manager",
  "head",
  "director",
  "vp",
  "c-suite",
] as const;

export const TIER_RANK: Record<Tier, number> = {
  "ic-entry": 0,
  "ic-mid": 1,
  "ic-senior": 2,
  manager: 3,
  head: 4,
  director: 5,
  vp: 6,
  "c-suite": 7,
};

/** Returns -1 if a is below b, 0 if equal, 1 if a is above b. */
export function compareTiers(a: Tier, b: Tier): -1 | 0 | 1 {
  const ra = TIER_RANK[a];
  const rb = TIER_RANK[b];
  if (ra < rb) return -1;
  if (ra > rb) return 1;
  return 0;
}

export function isAboveTier(candidate: Tier, reference: Tier): boolean {
  return TIER_RANK[candidate] > TIER_RANK[reference];
}

export function isBelowTier(candidate: Tier, reference: Tier): boolean {
  return TIER_RANK[candidate] < TIER_RANK[reference];
}

export function isPeerTier(candidate: Tier, reference: Tier): boolean {
  return TIER_RANK[candidate] === TIER_RANK[reference];
}

// Map the existing `career_guides.content.typicalCareerStage` vocabulary to
// the new tier vocabulary. Used as a starting hint for the LLM ladder
// assignment classifier and as the tier-source for guides that already have
// `typicalCareerStage` filled in. Returns null when the stage doesn't map
// cleanly (the classifier is then the sole source of truth for that guide).
//
// Note: the legacy `typicalCareerStage` had no concept of "head" — it
// collapsed Head, Director, VP into the broader categories. The classifier
// disambiguates from the title text.
export type LegacyCareerStage =
  | "early-career"
  | "mid-career"
  | "senior-IC"
  | "manager"
  | "director"
  | "exec";

export function tierFromLegacyStage(
  stage: LegacyCareerStage | undefined,
): Tier | null {
  if (!stage) return null;
  switch (stage) {
    case "early-career":
      return "ic-entry";
    case "mid-career":
      return "ic-mid";
    case "senior-IC":
      return "ic-senior";
    case "manager":
      return "manager";
    case "director":
      return "director";
    case "exec":
      return "c-suite";
  }
}
