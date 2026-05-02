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
 * Absolute wholeSim threshold for the "sideways moves" lane. A candidate must
 * be in the top 20-50% rank AND exceed this threshold to land in adjacent —
 * otherwise it falls through to transformational ("a different chapter").
 *
 * Why: Gemini text embeddings have a ~0.6-0.7 noise floor for any two
 * career-related texts (shared "professional language"). Pure rank bucketing
 * always populates sideways with whatever's in the middle of the user's pool
 * even when nothing is genuinely a lateral move. This threshold prevents the
 * lane from filling with cross-domain false positives. If the user has no
 * real sideways candidates, the lane is correctly empty.
 *
 * Calibrated against the AI Engineer demo: real lateral moves (ML Engineer,
 * Platform Engineer) score ~0.78+; cross-domain noise (Massage Therapist,
 * Zoologist) scores ~0.65-0.7. 0.72 splits them cleanly.
 */
export const SIDEWAYS_WHOLE_SIM_FLOOR = 0.72;

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
