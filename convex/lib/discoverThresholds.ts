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
