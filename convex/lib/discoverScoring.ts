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
