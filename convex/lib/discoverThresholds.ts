// Lane assignment cutoffs on currentStateSim (cosine similarity in [0, 1]).
// Calibrated against Gemini embedding-2-preview's distribution: professional
// career text rarely scores below ~0.5 cosine even between unrelated roles
// (shared "professional language" floor), so the bucketing thresholds need
// to sit well above 0.5 to discriminate meaningfully.
export const LANE_THRESHOLDS = {
  /** >= LINEAR_MIN → linear lane ("close to who you are now") */
  LINEAR_MIN: 0.75,
  /** >= ADJACENT_MIN and < LINEAR_MIN → adjacent lane */
  ADJACENT_MIN: 0.6,
  // < ADJACENT_MIN → transformational lane.
} as const;

export type LaneKind = "linear" | "adjacent" | "transformational";

/** Universal quality floor on arcSim. Sub-floor candidates never appear. */
export const ARC_SIM_FLOOR = 0.5;

/**
 * Per-lane absolute wholeSim floors for the linear / adjacent lanes. A
 * candidate must clear its lane's floor to enter that lane; below-floor
 * candidates fall through to transformational ("a different chapter").
 *
 * Floors keep cross-domain noise out of the high-signal lanes. Calibrated
 * against the Head-of-ML demo: real lateral moves at the same level
 * score ~0.74-0.78, cross-domain noise (Massage Therapist, Park Ranger)
 * scores ~0.55-0.65, so 0.72 splits cleanly.
 *
 * The 'earlier' lane is intentionally not in this map: as of the lane-
 * tightening change, 'earlier' admits ONLY guides whose slug appears in
 * profile.seedingGuideSlugs (literal past roles). The previous embedding-
 * based admission via wholeSim ≥ 0.68 was an approximation of past-roleness
 * and was deleted along with the threshold once seedingGuideSlugs became
 * available — it had a long history of admitting cross-domain noise (Actuary,
 * SEO Manager) at the boundary. See convex/discover.ts lane-bucketing loop.
 */
export const LANE_WHOLE_SIM_FLOOR = {
  linear: 0.72,
  adjacent: 0.72,
} as const;

/** Curation budget per lane. */
export const LANE_BUDGET = {
  STRONG: 3,
  BRIDGE: 2,
  ASPIRATIONAL: 1,
  /** Curated 6 + up to 14 extras revealed by the slider = 20 cap per lane. */
  EXTRA_MAX: 14,
  TOTAL_MAX: 20,
} as const;

/** Pre-curation candidate pool size pulled from career_guide_embeddings. */
export const CANDIDATE_POOL_K = 200;

/** Cap on candidates fed into the rerank call for the aspirational slot. */
export const ASPIRATIONAL_RERANK_TOP_N = 30;

/** Snapshot generation retry policy. */
export const SNAPSHOT_MAX_ATTEMPTS = 3;

/** Debounce window for scheduleSnapshotRegeneration (ms). */
export const REGEN_DEBOUNCE_MS = 30_000;
