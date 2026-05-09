/** Universal quality floor on arcSim. Sub-floor candidates never appear. */
export const ARC_SIM_FLOOR = 0.5;

/**
 * Per-lane absolute wholeSim floors. A candidate must clear its lane's floor
 * to enter that lane; below-floor candidates fall through to transformational
 * ("a different chapter").
 *
 * Why per-lane: with 4-way stage bucketing, the stage signal disambiguates
 * forward / sideways / earlier from each other. The wholeSim floor's job is
 * narrower — keep cross-domain noise out of the three high-signal lanes. The
 * floor can be slightly more permissive for `earlier` because stage gives us
 * extra confidence: "wholeSim 0.69 + lower stage" is more clearly a genuine
 * earlier-stage role in the user's domain than "wholeSim 0.69 + same stage"
 * (which is more easily confused with a cross-domain peer).
 *
 * Calibrated against the Head-of-ML demo against the live guide library:
 *   - Real earlier-stage tech roles (Data Engineer, Data Scientist, Actuary,
 *     SEO Manager) cluster at wholeSim 0.69-0.73.
 *   - Real lateral moves at the same level (Data Architect, Cloud Architect)
 *     score ~0.74-0.78.
 *   - Cross-domain noise (Massage Therapist, Park Ranger, Yoga Teacher)
 *     scores ~0.55-0.65.
 *   - Forward (senior-leadership) candidates would score ~0.78+ if guides
 *     existed.
 *
 * Floors split these cleanly: 0.72 keeps Massage Therapist out of sideways;
 * 0.68 lets Data Engineer / Data Scientist into earlier while still keeping
 * Park Ranger out.
 */
export const LANE_WHOLE_SIM_FLOOR = {
  linear: 0.72,
  adjacent: 0.72,
  earlier: 0.68,
} as const;

/**
 * Per-lane absolute domainSim floors. Applied IN ADDITION to the wholeSim
 * floor in {@link LANE_WHOLE_SIM_FLOOR}. Today only `earlier` uses this, to
 * keep cross-domain noise out of the lane the UI labels "Earlier chapters".
 *
 * Why earlier needs a separate domain gate: wholeSim alone admits cross-domain
 * stage-down roles (e.g. for a Head of ML, "Actuary" and "SEO Manager" both
 * cleared the wholeSim 0.68 floor at ~0.69-0.70). Those roles aren't earlier
 * chapters of an ML career — they're cross-domain alternatives that belong in
 * `transformational` ("a different chapter"). domainSim — cosine over the
 * skills/functional sub-vector — is the right signal: high when the role
 * shares the user's professional domain, low otherwise.
 *
 * Calibrated against the Head-of-ML demo:
 *   - Same-domain earlier-stage roles (Data Scientist, AI Engineer, Data
 *     Engineer): domainSim 0.74-0.77.
 *   - Cross-domain noise that previously slipped into earlier (Actuary, SEO
 *     Manager): domainSim 0.68-0.71.
 * 0.72 splits these cleanly. Cross-domain candidates fall through to
 * transformational, which is the correct home.
 *
 * Why no floor on linear/adjacent today: those lanes already require
 * wholeSim ≥ 0.72 (vs 0.68 for earlier), which suppresses cross-domain noise
 * by itself. Add a per-lane domain floor to either if a real false positive
 * surfaces.
 */
export const LANE_DOMAIN_SIM_FLOOR = {
  earlier: 0.72,
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
