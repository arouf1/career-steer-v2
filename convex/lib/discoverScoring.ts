import { LANE_THRESHOLDS, type LaneKind } from "./discoverThresholds";

/** Cosine similarity, clamped to [0, 1]. Returns 0 on zero-vector input. */
export function cosineSim(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSim dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return clamp01(sim);
}

/** Bucket a currentStateSim score into a lane per LANE_THRESHOLDS. */
export function assignLane(currentStateSim: number): LaneKind {
  if (currentStateSim >= LANE_THRESHOLDS.LINEAR_MIN) return "linear";
  if (currentStateSim >= LANE_THRESHOLDS.ADJACENT_MIN) return "adjacent";
  return "transformational";
}

/** Clamp a number to [0, 1]. */
export function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Career-stage rank for the 4-lane bucketing in `discover.ts`.
 *
 * Ranks compare across both ICs and managers — `senior-IC` and `manager` sit
 * at the same level (7+ years, comparable scope) so a senior-IC user looking
 * at a manager guide registers as "sideways", not forward. The `transitioning`
 * stage (used on profile_enrichments only — not on guides) maps to the same
 * rank as `mid-career` so a user mid-pivot still gets meaningful bucketing.
 */
export const STAGE_RANK: Record<string, number> = {
  "early-career": 0,
  "mid-career": 1,
  transitioning: 1,
  "senior-IC": 2,
  manager: 2,
  director: 3,
  exec: 4,
};

/**
 * Compare a user's career stage against a guide's stage and return the lane
 * direction. Returns `"unknown"` when either side is missing or unrecognised
 * — callers fall through to the transformational ("a different chapter")
 * lane rather than guessing.
 *
 *   forward    → guide is at a higher stage than the user (= next steps)
 *   sideways   → guide is at the same stage as the user (= sideways moves)
 *   earlier    → guide is at a lower stage than the user (= earlier chapters)
 *   unknown    → either user or guide stage missing/unrecognised
 */
export function compareStages(
  user: string | undefined,
  guide: string | undefined,
): "forward" | "sideways" | "earlier" | "unknown" {
  if (!user || !guide) return "unknown";
  const u = STAGE_RANK[user];
  const g = STAGE_RANK[guide];
  if (u === undefined || g === undefined) return "unknown";
  if (g > u) return "forward";
  if (g < u) return "earlier";
  return "sideways";
}
