// convex/discover.ts
import { v, ConvexError } from "convex/values";
import { z } from "zod";
import { generateText, Output } from "ai";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import {
  ARC_SIM_FLOOR,
  ASPIRATIONAL_RERANK_TOP_N,
  CANDIDATE_POOL_K,
  LANE_BUDGET,
  LANE_DOMAIN_SIM_FLOOR,
  LANE_WHOLE_SIM_FLOOR,
  REGEN_DEBOUNCE_MS,
  SNAPSHOT_MAX_ATTEMPTS,
} from "./lib/discoverThresholds";
import { cosineSim, compareStages } from "./lib/discoverScoring";
import { TIER_RANK, type Tier } from "./lib/ladders";
import { rerank as openRouterRerank, chatModel } from "../lib/ai/providers";

/**
 * Model id for Step 8's batched why-match LLM. Matches the
 * structured-output background-work model used by other Convex actions
 * (enrichments, careerPaths, outreach), so cost / capability stays
 * consistent across the codebase. See `lib/ai/prompts/career-paths.ts` for
 * the canonical constant; we redeclare the literal here to avoid pulling
 * in unrelated prompt strings.
 */
const REASONS_MODEL_ID = "google/gemini-3.1-pro-preview";

/**
 * Test-injectable rerank seam. Production binding is the real OpenRouter
 * call; tests overwrite via `globalThis.__testRerank__` so the deterministic
 * suite never touches the network. Tests should clean up with
 * `delete (globalThis as any).__testRerank__` (preferably in a finally
 * block) so the stub can't leak between tests.
 */
async function callRerank(args: {
  query: string;
  documents: string[];
  topN: number;
}): Promise<Array<{ index: number; relevanceScore: number }>> {
  const injected = (globalThis as any).__testRerank__;
  if (injected) return injected(args);
  return openRouterRerank({
    query: args.query,
    documents: args.documents,
    topN: args.topN,
    model: "cohere/rerank-4-pro",
  });
}

/**
 * Step 8 — batched why-match reasons.
 *
 * Returns one one-line reason per input pair, keyed by `guideId`. Production
 * binding calls Gemini 3.1 Pro via OpenRouter with structured output; tests
 * inject a deterministic implementation via `globalThis.__testReasonsLLM__`
 * (clean up in a `finally` so the stub doesn't leak).
 *
 * Schema: per memory note `feedback_gemini_structured_output_schema_limits`,
 * Gemini structured output rejects bound/array-length constraints (`.int()`,
 * `.min/max`, array-length). We keep the schema constraint-free and encode
 * "one reason per input, ≤18 words" in the prompt instead.
 */
async function callReasonsLLM(args: {
  arcSourceText: string;
  pairs: Array<{
    guideId: Id<"career_guides">;
    title: string;
    overview: string;
    slotKind: Slot;
  }>;
}): Promise<Map<string, string>> {
  const injected = (globalThis as any).__testReasonsLLM__;
  if (injected) return injected(args);

  const ReasonsSchema = z.object({
    reasons: z.array(
      z.object({
        guideId: z.string(),
        reason: z.string(),
      }),
    ),
  });

  const promptPairs = args.pairs.map((p) => ({
    guideId: p.guideId,
    title: p.title,
    overview: p.overview.slice(0, 600),
    slotKind: p.slotKind,
  }));

  const { output } = await generateText({
    model: chatModel(REASONS_MODEL_ID, { zdr: true }),
    output: Output.object({ schema: ReasonsSchema }),
    prompt: `You are writing one-line "why this matches" reasons for a user's career-discovery canvas.

USER'S ASPIRATIONS / WHAT THEY WANT NEXT (free text):
${args.arcSourceText}

For each guide below, write ONE sentence (≤18 words), in second person ("you"/"your"), explaining why this guide matches THIS user. The "slotKind" gives you the framing: "strong" = directly fits, "bridge" = transferable skills, "aspirational" = far from current life but resonates with what they want, "extra" = adjacent good-to-know.

Return EXACTLY one reason per input guide. Do NOT skip any. The "guideId" in each output MUST be copied verbatim from the input.

GUIDES:
${JSON.stringify(promptPairs, null, 2)}`,
  });

  const map = new Map<string, string>();
  for (const r of output.reasons) map.set(r.guideId, r.reason);
  return map;
}

/**
 * Per-lane judge prompt rubric. Each non-transformational lane defines what
 * "belongs" in that lane in qualitative terms, so the LLM can demote
 * candidates that pass embedding + stage gates but are clearly wrong for
 * THIS user. Transformational is the catch-all bucket and is never
 * adjudicated — demoted candidates from the other three lanes land here.
 *
 * Rubric design rules (apply equally to all three lanes):
 *   - Demote-only. The judge cannot promote a candidate from one lane to
 *     another; it can only keep or push to transformational.
 *   - Conservative on uncertainty. Default to "keep" — an extra noisy card
 *     in the right lane is less costly than an empty lane.
 *   - Cross-domain test, not difficulty test. The judge is checking domain
 *     coherence ("does this make sense for THIS user's professional path"),
 *     not whether the role is "good enough" or "hard enough."
 */
type JudgeLane = "earlier" | "linear" | "adjacent";

const JUDGE_RUBRICS: Record<
  JudgeLane,
  { laneLabel: string; description: string; examples: string }
> = {
  earlier: {
    laneLabel: "earlier chapters",
    description:
      'roles in the user\'s professional domain that they could plausibly have held earlier in their career. Return "keep" if it is genuinely a same-domain earlier-stage role for THIS user, or "demote" if it is a cross-domain pivot or unrelated noise that does not fit "earlier chapters of MY career."',
    examples: `Examples for a Head of Machine Learning:
- "Data Scientist" → keep (same quantitative/ML domain, earlier stage)
- "AI Engineer" → keep (same domain, earlier stage)
- "Software Engineer" → keep (adjacent technical domain)
- "Actuary" → demote (quantitative-adjacent but different professional domain)
- "SEO Manager" → demote (cross-domain marketing)
- "Massage Therapist" → demote (clearly unrelated)`,
  },
  linear: {
    laneLabel: "next steps",
    description:
      'roles that are a credible promotion / forward step at one level up from where the user sits today, in the user\'s professional domain. Return "keep" if the role is genuinely a next-step in THIS user\'s career trajectory, or "demote" if it is a forward-but-cross-domain leap that is not a natural progression for them.',
    examples: `Examples for a Head of Machine Learning:
- "VP of Engineering" → keep (forward step in same technical leadership domain)
- "Director of Data Science" → keep (next-level data/ML leadership)
- "Chief Technology Officer" → keep (executive variant of engineering leadership)
- "VP of Marketing" → demote (forward step but unrelated function)
- "General Counsel" → demote (cross-domain executive role)
- "Head of Sales" → demote (forward in seniority but different function)`,
  },
  adjacent: {
    laneLabel: "sideways moves",
    description:
      'roles at the same career level as the user today, in a related or overlapping professional domain. The signature move here is a track switch (manager ↔ senior-IC) or a function pivot at the same seniority. Return "keep" if the role is genuinely a viable sideways move for THIS user, or "demote" if it is a same-stage role in a clearly unrelated function.',
    examples: `Examples for a Head of Machine Learning (manager track):
- "Principal Machine Learning Engineer" → keep (IC-track equivalent at same level)
- "Head of Data Science" → keep (peer leadership in adjacent function)
- "Staff Software Engineer" → keep (senior-IC in adjacent technical domain)
- "Head of MLOps" → keep (same level, adjacent ML specialty)
- "Restaurant General Manager" → demote (same seniority but unrelated industry)
- "Head of Sales" → demote (peer leadership but unrelated function)
- "Senior Marketing Manager" → demote (adjacent seniority but unrelated function)`,
  },
};

/**
 * Lane judge — provisional candidates admitted to a non-transformational
 * lane via embeddings + stage gates are re-evaluated by Gemini Flash to
 * catch cross-domain mismatches that pass the math but fail the smell test.
 *
 * Flow:
 *  - earlier:   admitted by `cmp === "earlier" && wholeSim ≥ 0.68 && domainSim ≥ 0.72`
 *  - linear:    admitted by `cmp === "forward" && wholeSim ≥ 0.72`
 *  - adjacent:  admitted by `cmp === "sideways" && wholeSim ≥ 0.72`
 *
 * Override-admitted candidates (literal past roles via seedingGuideSlugs)
 * skip the judge entirely — clean signal, no fuzz to clean up.
 *
 * Demoted candidates are moved to `transformational` (their semantic home
 * — cross-domain or otherwise off-track for the user). Conservative on
 * uncertainty: defaults to "keep" on any LLM failure or missing output,
 * so a flaky judge never silently empties a lane.
 *
 * Production binding calls Gemini Flash (project's standard for trivial
 * structured-extraction work — same reasoning as the canonicalizer);
 * tests inject a deterministic implementation via
 * `globalThis.__testJudgeLLM__` (clean up in a `finally` so the stub
 * doesn't leak).
 */
/**
 * Judge verdict shape. `verdict` is the binary lane gate; `confidence`
 * influences within-lane positioning when verdict === "keep":
 *   - high     → no penalty; candidate competes on cosine scores alone.
 *   - medium   → judgePenalty = 1; candidate sorts behind every
 *                high-confidence candidate, so it lands in bridge /
 *                aspirational / extra rather than strong unless it is the
 *                only one in the lane.
 *   - low      → treated identically to verdict="demote"; the judge is
 *                saying "this barely makes sense for this user," so move
 *                it out of the lane entirely.
 */
type JudgeVerdict = {
  verdict: "keep" | "demote";
  confidence: "high" | "medium" | "low";
};

async function callJudgeLLM(args: {
  lane: JudgeLane;
  userHeadline: string | null;
  userExperience: Array<{ title: string; company: string }>;
  candidates: Array<{
    guideId: Id<"career_guides">;
    title: string;
  }>;
}): Promise<Map<string, JudgeVerdict>> {
  const verdicts = new Map<string, JudgeVerdict>();
  if (args.candidates.length === 0) return verdicts;

  const injected = (globalThis as any).__testJudgeLLM__;
  if (injected) return injected(args);

  const JudgeSchema = z.object({
    judgments: z.array(
      z.object({
        guideId: z.string(),
        verdict: z.enum(["keep", "demote"]),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    ),
  });

  const rubric = JUDGE_RUBRICS[args.lane];
  const headline = args.userHeadline ?? "(no headline)";
  const experienceLines = args.userExperience
    .slice(0, 6)
    .map((e) => `- ${e.title} at ${e.company}`)
    .join("\n");
  const candidateLines = args.candidates
    .map((c) => `- guideId=${c.guideId} title=${c.title}`)
    .join("\n");

  try {
    const { experimental_output } = await generateText({
      model: chatModel("google/gemini-3-flash-preview", { zdr: true }),
      experimental_output: Output.object({ schema: JudgeSchema }),
      prompt: `You are categorizing career-discovery cards for a single user.

Each candidate below has been provisionally admitted to the "${rubric.laneLabel}" lane (= ${rubric.description})

For each candidate, return BOTH a verdict and a confidence level:

VERDICT — "keep" if the candidate fits this lane for THIS user; "demote" if it is a clear cross-domain or off-track mismatch. Be CONSERVATIVE — when in doubt, KEEP. Only demote clear mismatches.

CONFIDENCE — how strongly the candidate fits the lane for this user:
- "high"   = textbook fit. Reads as a natural, expected card in this lane for this user's path.
- "medium" = reasonable but a stretch. Same general direction but feels slightly off — a niche specialty, an unusual industry crossover, or a role where the user would need significant pivot effort.
- "low"    = barely makes sense even though the embeddings agree. Treat the same as "demote" — return verdict="demote" alongside confidence="low".

If you return verdict="demote", you must return confidence="low" (don't hedge a demotion as medium). If you return verdict="keep", confidence is "high" or "medium".

${rubric.examples}

USER PROFILE:
Headline: ${headline}
Experience:
${experienceLines || "(none)"}

CANDIDATES:
${candidateLines}

Return EXACTLY one judgment per input candidate. Copy guideId verbatim.`,
    });

    for (const j of experimental_output.judgments) {
      verdicts.set(j.guideId, {
        verdict: j.verdict,
        confidence: j.confidence,
      });
    }
  } catch (err) {
    console.warn("discover.judge:llm-error", {
      lane: args.lane,
      error: err instanceof Error ? err.message : String(err),
      candidateCount: args.candidates.length,
    });
    // Conservative fallback: if the judge fails, keep everything as
    // high-confidence. Better to have a noisy card in the right lane than
    // to silently empty it or wrongly penalize positioning.
  }

  // Conservative fallback for any candidate the judge omitted.
  for (const c of args.candidates) {
    if (!verdicts.has(c.guideId as string)) {
      verdicts.set(c.guideId as string, {
        verdict: "keep",
        confidence: "high",
      });
    }
  }

  return verdicts;
}

/**
 * Deterministic per-slot fallback reason used when the batched LLM call
 * throws. Pulls a representative skill from the guide's content when
 * available; otherwise drops to a generic phrasing. Keeping this pure +
 * module-scope so the cache write path can also use it for stub-grade
 * reasons without re-implementing the templates.
 */
function defaultReasonFor(
  slot: Slot,
  g: Doc<"career_guides"> | null | undefined,
): string {
  const skill = g?.content?.typicalSkills?.[0] ?? "your background";
  if (slot === "strong") return `Strong fit on ${skill}.`;
  if (slot === "bridge") return `Builds on your ${skill}.`;
  if (slot === "aspirational")
    return `A different direction matched to your aspirations.`;
  return `Worth a look — overlaps with your ${skill}.`;
}

/**
 * Resolve the calling user's userId. Throws if unauthenticated.
 *
 * NOTE: this project's `users` table is keyed by Clerk's `tokenIdentifier`
 * (not `subject` / `clerkId`), so we look up by the `by_tokenIdentifier`
 * index — matching the pattern in `convex/users.ts`.
 */
async function requireUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) throw new Error("user-not-provisioned");
  return user._id;
}

/**
 * Single entry-point for all snapshot regeneration triggers. Debounces
 * within REGEN_DEBOUNCE_MS per userId so a flurry of writes doesn't fire
 * ten generations. `dedupKey` is currently informational only (logged on
 * debounce-skip for traceability); we may partition the debounce window
 * per (userId, dedupKey) if we observe legitimate concurrent triggers
 * needing independent regen.
 *
 * `dedupKey` examples:
 *   "init"          — first eager generation on profile completion
 *   "embedding"     — profile embedding regenerated
 *   "guide:<id>"    — guide content/embedding changed (fan-out)
 *   "manual"        — user-initiated refresh
 */
export const scheduleSnapshotRegeneration = internalMutation({
  args: {
    userId: v.id("users"),
    dedupKey: v.string(),
    /** When true, bypasses the discover_match_reasons cache for fresh LLM calls. */
    forceFreshReasons: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!profile) {
      console.warn("discover.schedule:no-profile", { userId: args.userId });
      return;
    }
    const embedding = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (!embedding) {
      console.warn("discover.schedule:no-embedding", { profileId: profile._id });
      return;
    }

    // Dedup: if a snapshot exists with status "generating" started within
    // the debounce window for this user, skip enqueueing.
    const existing = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (
      existing &&
      existing.status === "generating" &&
      Date.now() - existing.generatedAt < REGEN_DEBOUNCE_MS
    ) {
      console.debug("discover.schedule:debounced", {
        userId: args.userId,
        dedupKey: args.dedupKey,
        ageMs: Date.now() - existing.generatedAt,
      });
      return;
    }

    // Mark a generating row (insert or replace) so subsequent triggers
    // within the window dedup. The action will replace it on success.
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "generating",
        generatedAt: Date.now(),
        attempts: 0,
        failureReason: undefined,
      });
    } else {
      await ctx.db.insert("discover_canvases", {
        userId: args.userId,
        profileId: profile._id,
        profileEmbeddingId: embedding._id,
        generatedAt: Date.now(),
        status: "generating",
        lanes: [],
        attempts: 0,
      });
    }

    await ctx.scheduler.runAfter(0, internal.discover.generateSnapshot, {
      userId: args.userId,
      profileId: profile._id,
      expectedProfileEmbeddingId: embedding._id,
      forceFreshReasons: args.forceFreshReasons ?? false,
    });
  },
});

// ─── generateSnapshot action ────────────────────────────────────────────
//
// Pipeline (built up across Tasks 2.2 – 2.9):
//
//   Step 1  Read profile_embedding + all guide embeddings           [2.2]
//   Step 2  Score each guide on arc/currentState/domain/whole        [2.2]
//   Step 3  Top-K by wholeSim, filter by ARC_SIM_FLOOR               [2.2]
//   Step 4  Drop dismissed guides (with saved-override pin)          [2.3]
//   Step 5  Bucket into linear/adjacent/transformational lanes       [2.3]
//   Step 6  Curate strong/bridge/aspirational slots per lane         [2.4-2.5]
//   Step 7  Top up extras for the slider                             [2.6]
//   Step 8  Generate why-match reasons (cached)                      [2.7]
//   Step 9  Persist snapshot + junction rows                         [this file]
//
// This task implements 1–3; later tasks layer on top, replacing the
// degenerate "everything strong in linear" stub below.

type ScoredCandidate = {
  guideId: Id<"career_guides">;
  arcSim: number;
  currentStateSim: number;
  domainSim: number;
  wholeSim: number;
  /**
   * Distance penalty applied by the lane judge. 0 = no penalty (high
   * confidence or never adjudicated); 1 = "medium-confidence" demotion
   * — the judge kept the candidate in this lane but flagged it as a
   * stretch. Picked up as a primary sort key by `pickStrong` / `pickBridge`
   * / aspirational rerank pool, so penalized candidates fall behind every
   * non-penalized candidate regardless of cosine score. Effect: a
   * "stretch" sideways gets bridge / aspirational / extra rather than
   * strong, unless it is the only candidate in the lane.
   */
  judgePenalty?: number;
};

/** Slot kinds populated across Steps 6a–6c + Step 7 (extras). */
type Slot = "strong" | "bridge" | "aspirational" | "extra";

type CardStub = {
  guideId: Id<"career_guides">;
  slotKind: Slot;
  arcScore: number;
  currentStateScore: number;
  domainScore: number;
  wholeScore: number;
  whyMatchReason: string;
};

type LaneKindFour = "linear" | "adjacent" | "earlier" | "transformational";

type LaneStub = {
  kind: LaneKindFour;
  cards: CardStub[];
};

/**
 * Sort key composer used by the slot pickers. Primary key: `judgePenalty`
 * ascending (no-penalty before medium-confidence demoted) so a stretch
 * candidate flagged by the LLM judge can never out-rank a clean candidate
 * regardless of how well it scores on arcSim/domainSim. Secondary key:
 * the metric the picker cares about (arcSim for strong, domainSim then
 * arcSim for bridge).
 */
const penaltyOf = (c: ScoredCandidate): number => c.judgePenalty ?? 0;

/**
 * Step 6a — strong-fit picks: top-N by arcSim. These are the cards that
 * most resemble the user's narrative arc; they anchor the lane.
 */
function pickStrong(pool: ScoredCandidate[]): ScoredCandidate[] {
  return [...pool]
    .sort(
      (a, b) => penaltyOf(a) - penaltyOf(b) || b.arcSim - a.arcSim,
    )
    .slice(0, LANE_BUDGET.STRONG);
}

/**
 * Step 6b — bridge picks: top-N by domainSim, with arcSim as tiebreaker.
 * Excludes guides already taken by `pickStrong` so the same card never
 * appears in two slots within a lane.
 */
function pickBridge(
  pool: ScoredCandidate[],
  excluded: Set<string>,
): ScoredCandidate[] {
  return [...pool]
    .filter((c) => !excluded.has(c.guideId as string))
    .sort(
      (a, b) =>
        penaltyOf(a) - penaltyOf(b) ||
        b.domainSim - a.domainSim ||
        b.arcSim - a.arcSim,
    )
    .slice(0, LANE_BUDGET.BRIDGE);
}

/**
 * Step 6c — aspirational pick. Pulls the top ASPIRATIONAL_RERANK_TOP_N
 * remaining candidates by arcSim, fetches their overview text, and asks
 * Cohere rerank (via the `callRerank` test seam) to pick the single
 * most-resonant guide for the user's `arcSourceText`. If rerank throws
 * (network down, provider hiccup) or returns nothing, falls back to the
 * deterministic formula `max(arcSim - currentStateSim)` over the same
 * remaining set so a snapshot still ships.
 *
 * `excluded` carries the strong + bridge guideIds for this lane so the
 * aspirational slot never duplicates a card already on the lane.
 */
async function pickAspirational(
  ctx: ActionCtx,
  pool: ScoredCandidate[],
  excluded: Set<string>,
  arcSourceText: string,
): Promise<ScoredCandidate | undefined> {
  // Penalty-aware ordering: medium-confidence judge candidates land behind
  // every clean candidate before the rerank pool is sliced, so they only
  // make the rerank shortlist when there are not enough clean candidates.
  const remaining = pool
    .filter((c) => !excluded.has(c.guideId as string))
    .sort(
      (a, b) => penaltyOf(a) - penaltyOf(b) || b.arcSim - a.arcSim,
    )
    .slice(0, ASPIRATIONAL_RERANK_TOP_N);
  if (remaining.length === 0) return undefined;

  // Pull each candidate's overview text for rerank. `content` is optional
  // on the schema; fall back to `title` so the rerank query always sees
  // *some* text per candidate.
  const guides = await ctx.runQuery(internal.discover._readGuideOverviews, {
    guideIds: remaining.map((c) => c.guideId),
  });
  const docs = remaining.map((c) => {
    const g = guides.find((x) => x._id === c.guideId);
    return g?.content?.overview ?? g?.title ?? "";
  });

  try {
    const ranked = await callRerank({
      query: arcSourceText,
      documents: docs,
      topN: 1,
    });
    if (ranked.length > 0) {
      const idx = ranked[0].index;
      if (idx >= 0 && idx < remaining.length) return remaining[idx];
    }
  } catch (err) {
    console.warn("discover.rerank_failed", { err: String(err) });
  }

  // Formula fallback: highest stretch (arcSim - currentStateSim) wins.
  return remaining
    .slice()
    .sort(
      (a, b) =>
        b.arcSim - b.currentStateSim - (a.arcSim - a.currentStateSim),
    )[0];
}

/**
 * Canonical card-shape factory. Tasks 2.5/2.6/2.7 build their own slot
 * pickers on top of this helper so the persisted shape stays consistent.
 */
function withSlot(
  c: ScoredCandidate,
  slotKind: Slot,
  whyMatchReason: string,
): CardStub {
  return {
    guideId: c.guideId,
    slotKind,
    arcScore: c.arcSim,
    currentStateScore: c.currentStateSim,
    domainScore: c.domainSim,
    wholeScore: c.wholeSim,
    whyMatchReason,
  };
}

export const generateSnapshot = internalAction({
  args: {
    userId: v.id("users"),
    profileId: v.id("profiles"),
    expectedProfileEmbeddingId: v.id("profile_embeddings"),
    forceFreshReasons: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      await runPipeline(ctx, args);
    } catch (err) {
      // Concurrency abort from `_writeSnapshot` is expected racing behavior —
      // a fresher in-flight generation has already (or is about to) replaced
      // the snapshot. Don't mark this run as failed; just bail silently so
      // the live row keeps whatever the winning action wrote.
      if (
        err instanceof ConvexError &&
        (err as ConvexError<string>).data === "profile-embedding-superseded"
      ) {
        return;
      }
      const reason =
        err instanceof Error ? err.message.slice(0, 500) : "unknown";
      await ctx.runMutation(internal.discover._markSnapshotFailed, {
        userId: args.userId,
        reason,
      });
      throw err;
    }
  },
});

/**
 * Inner pipeline body. Extracted from the action handler so the outer
 * try/catch wrapping it stays uncluttered and the existing Steps 0–9
 * structure is preserved verbatim. `_markSnapshotFailed` only patches an
 * existing `discover_canvases` row — in production
 * `scheduleSnapshotRegeneration` always inserts the generating row before
 * dispatching this action, so the patch target reliably exists.
 */
async function runPipeline(
  ctx: ActionCtx,
  args: {
    userId: Id<"users">;
    profileId: Id<"profiles">;
    expectedProfileEmbeddingId: Id<"profile_embeddings">;
    forceFreshReasons: boolean;
  },
) {
  // Step 0: Read the user's profile embedding. If it's gone, the embedding
  // was regenerated or deleted between scheduling and execution; abort.
  const profileEmbedding = await ctx.runQuery(
    internal.discover._readProfileEmbedding,
    { profileEmbeddingId: args.expectedProfileEmbeddingId },
  );
  if (!profileEmbedding) {
    throw new ConvexError("profile-not-ready");
  }

  // Step 1: Pull all guide embeddings.
  const guideEmbeddings = await ctx.runQuery(
    internal.discover._readAllGuideEmbeddings,
    {},
  );

  // Step 2: Compute facet sims per guide.
  const scoredAll: ScoredCandidate[] = [];
  for (const ge of guideEmbeddings) {
    scoredAll.push({
      guideId: ge.guideId,
      arcSim: cosineSim(profileEmbedding.arcVector, ge.arcVector),
      currentStateSim: cosineSim(
        profileEmbedding.currentStateVector,
        ge.currentStateVector,
      ),
      domainSim: cosineSim(profileEmbedding.domainVector, ge.domainVector),
      wholeSim: cosineSim(profileEmbedding.wholeVector, ge.wholeVector),
    });
  }

  // Step 3: Top-K by wholeSim, then quality floor on arcSim.
  const candidates: ScoredCandidate[] = scoredAll
    .slice()
    .sort((a, b) => b.wholeSim - a.wholeSim)
    .slice(0, CANDIDATE_POOL_K)
    .filter((c) => c.arcSim >= ARC_SIM_FLOOR);

  // Step 4: Drop dismissed guides for this user. We also collect the saved
  // set up front since Step 5's saved-override needs it.
  const reactions: Array<Doc<"discover_reactions">> = await ctx.runQuery(
    internal.discover._readReactions,
    { userId: args.userId },
  );
  const dismissed = new Set<string>(
    reactions
      .filter((r) => r.reaction === "dismissed")
      .map((r) => r.guideId as string),
  );
  const savedSet = new Set<string>(
    reactions
      .filter((r) => r.reaction === "saved")
      .map((r) => r.guideId as string),
  );

  const surviving = candidates.filter(
    (c) => !dismissed.has(c.guideId as string),
  );

  // Step 5: 4-lane bucketing using career stage comparison + per-lane wholeSim
  // floor (and, for `earlier`, an additional domainSim floor).
  //
  // Lane semantics:
  //   linear            ("Next steps")        — guide stage > user stage AND wholeSim ≥ LANE_WHOLE_SIM_FLOOR.linear
  //   adjacent          ("Sideways moves")    — guide stage == user stage AND wholeSim ≥ LANE_WHOLE_SIM_FLOOR.adjacent
  //   earlier           ("Earlier chapters")  — guide stage < user stage AND wholeSim ≥ LANE_WHOLE_SIM_FLOOR.earlier AND domainSim ≥ LANE_DOMAIN_SIM_FLOOR.earlier
  //   transformational  ("A different chapter") — fails any of the above gates OR stage missing
  //
  // Per-lane wholeSim floors (linear/adjacent: 0.72, earlier: 0.68): the
  // stage signal disambiguates forward/sideways/earlier, but the wholeSim
  // floor's job is narrower — keep cross-domain noise out of the three
  // high-signal lanes.
  //
  // Why earlier also gets a domainSim gate: the lane is rendered as "Earlier
  // chapters", which reads as roles in the user's own past. wholeSim alone
  // admits cross-domain stage-down roles (e.g. for a Head of ML, "Actuary"
  // and "SEO Manager" both cleared the wholeSim 0.68 floor at ~0.69-0.70
  // despite being unrelated industries). The domainSim floor restores label
  // honesty — a role only enters `earlier` if it both sits at a lower stage
  // AND shares the user's professional domain. Cross-domain stage-down roles
  // fall through to `transformational` ("a different chapter"), which is
  // exactly the lane intended for cross-domain pivots.
  //
  // When user or guide stage is missing the candidate falls through to
  // transformational rather than guessing — so guides that haven't been
  // backfilled with `typicalCareerStage` yet still have a place to land.
  //
  // Why this replaces percentile-based wholeSim bucketing: senior users (Head
  // of ML, Director) were seeing roles like Data Engineer / AI Engineer in
  // "Next steps" because the previous bucketing had no concept of seniority.
  // Career stage comparison fixes that: lateral/downward roles now route to
  // sideways/earlier instead of misrepresented as next-steps.
  const enrichment = await ctx.runQuery(
    internal.discover._readProfileEnrichment,
    { profileId: args.profileId },
  );
  const userStage = enrichment?.careerStage;

  const guideIds = surviving.map((c) => c.guideId);
  const guideStageRows = await ctx.runQuery(
    internal.discover._readGuideStages,
    { guideIds },
  );
  const stageByGuide = new Map<string, string | undefined>(
    guideStageRows.map((g) => [g._id as string, g.stage]),
  );
  const slugByGuide = new Map<string, string | undefined>(
    guideStageRows.map((g) => [g._id as string, g.slug]),
  );

  // Experience override: pull the user's seeded guide slugs (the canonical
  // titles of the roles they've actually held, populated by
  // `internal.profileGuideSeeding.seedGuidesFromProfile`). Any candidate
  // whose slug appears here is a literal past role and will be force-routed
  // into the `earlier` lane below — bypassing the embedding-based
  // classifier, which can mis-route past roles when the stage embedding
  // overlaps with the user's current state or the domainSim/wholeSim floors
  // don't admit them.
  const profileLaning = await ctx.runQuery(
    internal.discover._readProfileLaningContext,
    { profileId: args.profileId },
  );
  const seededSlugSet = new Set<string>(profileLaning.seedingGuideSlugs);
  const titleByGuide = new Map<string, string | undefined>(
    guideStageRows.map((g) => [g._id as string, g.title]),
  );

  const byLane: Record<LaneKindFour, ScoredCandidate[]> = {
    linear: [],
    adjacent: [],
    earlier: [],
    transformational: [],
  };

  // Try the ladder-aware bucketing path first. The user has a "position"
  // when their seedingGuideSlugs[0] resolves to a guide that's been placed
  // on a career_ladder. When present, structural lane assignment beats the
  // embedding+judge guesswork:
  //   - Linear      = candidates on the user's ladder at a higher tier
  //   - Earlier     = candidates on the user's ladder at a lower tier
  //   - Adjacent    = candidates on a DIFFERENT ladder at the user's tier
  //   - Transformational = everything else (cross-ladder, cross-tier)
  //
  // The LLM judge is skipped for ladder-classified candidates — the
  // structural relationship doesn't need second-guessing. Only the
  // transformational lane runs through any further filtering, and even
  // that's just the existing slot pickers (no judge call).
  const userPosition = await ctx.runQuery(
    internal.careerLadders.getPositionByProfile,
    { profileId: args.profileId },
  );

  if (userPosition) {
    // Pre-load all ladder positions for the surviving candidates in one
    // batched query. Avoids N round-trips inside the for-loop.
    const positionRows = await ctx.runQuery(
      internal.careerLadders._readPositionsForGuides,
      { guideIds: surviving.map((c) => c.guideId) },
    );
    const positionsByGuide = new Map<
      string,
      Array<{ ladderId: Id<"career_ladders">; rung: number; tier: Tier }>
    >();
    for (const row of positionRows) {
      positionsByGuide.set(row.guideId as string, row.positions);
    }

    const userTierRank = TIER_RANK[userPosition.tier];

    for (const c of surviving) {
      const guideSlug = slugByGuide.get(c.guideId as string);

      // Override branch (preserved): literal past roles → earlier, regardless
      // of ladder placement.
      if (guideSlug && seededSlugSet.has(guideSlug)) {
        byLane.earlier.push(c);
        continue;
      }

      const positions = positionsByGuide.get(c.guideId as string) ?? [];
      const sameLadderPos = positions.find(
        (p) => p.ladderId === userPosition.ladderId,
      );

      if (sameLadderPos) {
        const candTierRank = TIER_RANK[sameLadderPos.tier];
        if (candTierRank > userTierRank) {
          byLane.linear.push(c);
        } else if (candTierRank < userTierRank) {
          byLane.earlier.push(c);
        }
        // candTierRank === userTierRank → same tier on user's own ladder;
        // skip — it's effectively the user's own role.
        continue;
      }

      // Not on user's ladder: check for peer at same tier on another ladder.
      const peerPos = positions.find((p) => p.tier === userPosition.tier);
      if (peerPos) {
        byLane.adjacent.push(c);
      } else {
        byLane.transformational.push(c);
      }
    }
  } else {
    // Fallback: profile isn't on a known ladder yet (no seededSlugs, or
    // seeded guide has no ladder position). Use the legacy stage-based
    // bucketing + LLM judge — same logic as before ladders existed.
    const embeddingAdmissions: Record<JudgeLane, ScoredCandidate[]> = {
      earlier: [],
      linear: [],
      adjacent: [],
    };

    for (const c of surviving) {
      const guideStage = stageByGuide.get(c.guideId as string);
      const guideSlug = slugByGuide.get(c.guideId as string);

      if (guideSlug && seededSlugSet.has(guideSlug)) {
        byLane.earlier.push(c);
        continue;
      }

      const cmp = compareStages(userStage, guideStage);
      if (cmp === "forward" && c.wholeSim >= LANE_WHOLE_SIM_FLOOR.linear) {
        embeddingAdmissions.linear.push(c);
      } else if (
        cmp === "sideways" &&
        c.wholeSim >= LANE_WHOLE_SIM_FLOOR.adjacent
      ) {
        embeddingAdmissions.adjacent.push(c);
      } else if (
        cmp === "earlier" &&
        c.wholeSim >= LANE_WHOLE_SIM_FLOOR.earlier &&
        c.domainSim >= LANE_DOMAIN_SIM_FLOOR.earlier
      ) {
        embeddingAdmissions.earlier.push(c);
      } else {
        byLane.transformational.push(c);
      }
    }

    const lanesToAdjudicate: JudgeLane[] = ["earlier", "linear", "adjacent"];
    const verdictsByLane = new Map<JudgeLane, Map<string, JudgeVerdict>>();
    await Promise.all(
      lanesToAdjudicate.map(async (lane) => {
        const candidates = embeddingAdmissions[lane];
        if (candidates.length === 0) {
          verdictsByLane.set(lane, new Map());
          return;
        }
        const verdicts = await callJudgeLLM({
          lane,
          userHeadline: profileLaning.headline,
          userExperience: profileLaning.experience,
          candidates: candidates.map((c) => ({
            guideId: c.guideId,
            title: titleByGuide.get(c.guideId as string) ?? "(untitled)",
          })),
        });
        verdictsByLane.set(lane, verdicts);
      }),
    );
    for (const lane of lanesToAdjudicate) {
      const verdicts = verdictsByLane.get(lane) ?? new Map();
      for (const c of embeddingAdmissions[lane]) {
        const judgment = verdicts.get(c.guideId as string) ?? {
          verdict: "keep" as const,
          confidence: "high" as const,
        };
        const isDemoted =
          judgment.verdict === "demote" || judgment.confidence === "low";
        if (isDemoted) {
          byLane.transformational.push(c);
        } else if (judgment.confidence === "medium") {
          byLane[lane].push({ ...c, judgePenalty: 1 });
        } else {
          byLane[lane].push(c);
        }
      }
    }
  }

  // Sort each lane's pool: judgePenalty asc first (clean candidates ahead
  // of medium-confidence ones), then wholeSim desc within each tier. The
  // slot pickers each apply their own metric-specific sort with the same
  // penalty-first rule, so this initial sort is mostly cosmetic for the
  // empty-lane override below — but keeping it consistent avoids surprises
  // for any downstream code that walks `byLane[k]` linearly.
  for (const k of ["linear", "adjacent", "earlier", "transformational"] as const) {
    byLane[k].sort(
      (a, b) => penaltyOf(a) - penaltyOf(b) || b.wholeSim - a.wholeSim,
    );
  }

  // Saved-guide override: if a lane ends up empty pull a saved guide from
  // elsewhere to fill it. Under stage-based bucketing this can happen
  // legitimately for senior users (no senior-leadership guides exist yet so
  // "Next steps" is empty for a Director/VP profile); the saved override
  // doesn't paper over that — only saved guides on the user's account count.
  const emptyLanes = (
    Object.keys(byLane) as Array<LaneKindFour>
  ).filter((k) => byLane[k].length === 0);
  if (emptyLanes.length > 0) {
    const savedCandidates = surviving
      .filter((c) => savedSet.has(c.guideId as string))
      .sort((a, b) => b.arcSim - a.arcSim);
    for (const emptyLane of emptyLanes) {
      const pick = savedCandidates.find((c) => {
        const currentLane = (
          ["linear", "adjacent", "earlier", "transformational"] as const
        ).find((kind) => byLane[kind].includes(c));
        return currentLane !== undefined && currentLane !== emptyLane;
      });
      if (pick) {
        byLane[emptyLane].push(pick);
        for (const kind of [
          "linear",
          "adjacent",
          "earlier",
          "transformational",
        ] as const) {
          if (kind !== emptyLane) {
            byLane[kind] = byLane[kind].filter((x) => x !== pick);
          }
        }
      }
    }
  }

  // Step 6a + 6b + 6c: pick strong-fit + bridge + aspirational cards per
  // lane. Step 7 then top-ups extras for the slider expansion pool.
  const builtLanes: LaneStub[] = await Promise.all(
    (
      ["linear", "adjacent", "earlier", "transformational"] as const
    ).map(async (kind) => {
      const pool = byLane[kind];
      const strong = pickStrong(pool);
      const strongIds = new Set(strong.map((c) => c.guideId as string));
      const bridge = pickBridge(pool, strongIds);
      const usedIds = new Set([
        ...strongIds,
        ...bridge.map((c) => c.guideId as string),
      ]);
      const aspirational = await pickAspirational(
        ctx,
        pool,
        usedIds,
        profileEmbedding.arcSourceText ?? "",
      );

      // Step 7 — extras: anything remaining in the lane pool, ranked by
      // arcSim desc, capped at LANE_BUDGET.EXTRA_MAX. The slider reveals
      // these in the order we ship them.
      const usedIds2 = new Set([
        ...strongIds,
        ...bridge.map((c) => c.guideId as string),
        ...(aspirational ? [aspirational.guideId as string] : []),
      ]);
      const extras = pool
        .filter((c) => !usedIds2.has(c.guideId as string))
        .sort((a, b) => b.arcSim - a.arcSim)
        .slice(0, LANE_BUDGET.EXTRA_MAX);

      return {
        kind,
        cards: [
          ...strong.map((c) => withSlot(c, "strong", "(stub)")),
          ...bridge.map((c) => withSlot(c, "bridge", "(stub)")),
          ...(aspirational
            ? [withSlot(aspirational, "aspirational", "(stub)")]
            : []),
          ...extras.map((c) => withSlot(c, "extra", "(stub)")),
        ],
      };
    }),
  );

  // Step 8 — why-match reasons. Cache-first read, single batched LLM call
  // for uncached pairs across ALL lanes, persist new reasons, fall back to
  // deterministic templates if the LLM throws.
  const allCards = builtLanes.flatMap((l) => l.cards);
  const cardGuideIds = allCards.map((c) => c.guideId);

  const cachedRows: Array<Doc<"discover_match_reasons">> =
    args.forceFreshReasons || cardGuideIds.length === 0
      ? []
      : await ctx.runQuery(internal.discover._readCachedReasons, {
          userId: args.userId,
          profileEmbeddingId: args.expectedProfileEmbeddingId,
          guideIds: cardGuideIds,
        });
  const cachedByGuide = new Map<string, string>(
    cachedRows.map((r) => [r.guideId as string, r.reason]),
  );

  // Dedup uncached cards by guideId — a guide could in principle land in
  // two lanes (saved-override path); we only want one entry per guideId
  // when we batch into the LLM call.
  const uncachedByGuide = new Map<string, CardStub>();
  for (const c of allCards) {
    const gid = c.guideId as string;
    if (!cachedByGuide.has(gid) && !uncachedByGuide.has(gid)) {
      uncachedByGuide.set(gid, c);
    }
  }
  const uncached = Array.from(uncachedByGuide.values());

  const llmReasons = new Map<string, string>();
  let guideMap = new Map<string, Doc<"career_guides">>();
  if (uncached.length > 0) {
    const guides: Doc<"career_guides">[] = await ctx.runQuery(
      internal.discover._readGuideOverviews,
      { guideIds: uncached.map((c) => c.guideId) },
    );
    guideMap = new Map(guides.map((g) => [g._id as string, g]));
    const pairs = uncached.map((c) => {
      const g = guideMap.get(c.guideId as string);
      return {
        guideId: c.guideId,
        title: g?.title ?? "",
        overview: g?.content?.overview ?? "",
        slotKind: c.slotKind as Slot,
      };
    });
    try {
      const fresh = await callReasonsLLM({
        arcSourceText: profileEmbedding.arcSourceText ?? "",
        pairs,
      });
      for (const [gid, reason] of fresh) llmReasons.set(gid, reason);
      // Persist freshly generated reasons so the next snapshot hits cache.
      const entries = Array.from(llmReasons.entries()).map(
        ([gid, reason]) => ({
          guideId: gid as Id<"career_guides">,
          reason,
        }),
      );
      if (entries.length > 0) {
        await ctx.runMutation(internal.discover._writeReasons, {
          userId: args.userId,
          profileEmbeddingId: args.expectedProfileEmbeddingId,
          entries,
        });
      }
    } catch (err) {
      console.warn("discover.reasons_llm_failed", { err: String(err) });
      // Fall back to deterministic per-slot templates. We don't persist
      // these — caching a template would block a real reason from being
      // generated on the next run.
      for (const c of uncached) {
        const g = guideMap.get(c.guideId as string);
        llmReasons.set(c.guideId as string, defaultReasonFor(c.slotKind, g));
      }
    }
  }

  // Apply reasons to every card on every lane.
  const lanesWithReasons: LaneStub[] = builtLanes.map((lane) => ({
    ...lane,
    cards: lane.cards.map((c) => {
      const gid = c.guideId as string;
      const reason =
        cachedByGuide.get(gid) ??
        llmReasons.get(gid) ??
        defaultReasonFor(c.slotKind, guideMap.get(gid));
      return { ...c, whyMatchReason: reason };
    }),
  }));

  await ctx.runMutation(internal.discover._writeSnapshot, {
    userId: args.userId,
    profileId: args.profileId,
    profileEmbeddingId: args.expectedProfileEmbeddingId,
    lanes: lanesWithReasons,
  });
}

// ─── Internal helpers ────────────────────────────────────────────────────

/**
 * Mark the live snapshot row (if any) as failed, increment `attempts`, and
 * record a 500-char-truncated `failureReason`. No-op when no row exists —
 * the pipeline catches that case in `generateSnapshot`'s outer try/catch.
 *
 * Phase 4 (Task 4.3) introduces a cron sweep that uses
 * `SNAPSHOT_MAX_ATTEMPTS` to retry stuck rows; we don't enforce that gate
 * here, just bump the counter so the sweep has accurate state.
 */
export const _markSnapshotFailed = internalMutation({
  args: { userId: v.id("users"), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      status: "failed",
      attempts: (row.attempts ?? 0) + 1,
      failureReason: args.reason,
    });
  },
});

export const _readProfileEmbedding = internalQuery({
  args: { profileEmbeddingId: v.id("profile_embeddings") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.profileEmbeddingId);
  },
});

export const _readAllGuideEmbeddings = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("career_guide_embeddings").collect();
  },
});

/**
 * Reads guides by id for the Step 6c rerank prompt. Returns the full guide
 * docs so the caller can pull `content?.overview` (preferred) or fall back
 * to `title` when overviews are missing. Order is not guaranteed — callers
 * resolve by id.
 */
export const _readGuideOverviews = internalQuery({
  args: { guideIds: v.array(v.id("career_guides")) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.guideIds.map((id) => ctx.db.get(id)));
    return docs.filter((g): g is Doc<"career_guides"> => g !== null);
  },
});

/**
 * Reads the user's profile enrichment row so the Step 5 lane bucketer can
 * compare the user's `careerStage` against each guide's `typicalCareerStage`.
 * Returns `null` when no enrichment exists yet (cold-start) — the bucketer
 * treats `undefined` user stage as "unknown" and falls every candidate
 * through to the transformational lane in that case.
 */
export const _readProfileEnrichment = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();
  },
});

/**
 * Reads each guide's `typicalCareerStage` and `slug` for the Step 5 4-lane
 * bucketer. Returns `{ _id, stage, slug }` per id so the caller can build
 * maps without pulling the full guide doc (the snapshot pipeline already
 * reads `_readGuideOverviews` for content, which would double-up
 * unnecessarily). Missing or unbackfilled guides return `stage: undefined`
 * and route to the transformational lane. Slug is included so the lane
 * bucketer can match candidates against `profile.seedingGuideSlugs` and
 * apply the experience override (literal past roles → `earlier`).
 */
export const _readGuideStages = internalQuery({
  args: { guideIds: v.array(v.id("career_guides")) },
  handler: async (ctx, args) => {
    return await Promise.all(
      args.guideIds.map(async (id) => {
        const g = await ctx.db.get(id);
        return {
          _id: id,
          stage: g?.content?.typicalCareerStage,
          slug: g?.slug,
          title: g?.title,
        };
      }),
    );
  },
});

/**
 * Reads the user's profile fields needed by the Step 5 lane bucketer:
 *
 *  - `seedingGuideSlugs`: slugs of public career guides seeded from the
 *    user's own work-history canonical titles via
 *    `internal.profileGuideSeeding.seedGuidesFromProfile`. The bucketer's
 *    experience override admits any candidate whose slug matches into
 *    `earlier` regardless of embedding scores.
 *  - `headline` + `experience`: passed to the LLM judge that adjudicates
 *    embedding-admitted earlier candidates (Step 5b). Without user context
 *    the judge can't tell same-domain earlier-stage roles ("Data Scientist"
 *    for a Head of ML — keep) from cross-domain noise ("Actuary" — demote).
 *
 * Returns conservative defaults when the profile is missing or unseeded.
 */
export const _readProfileLaningContext = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    return {
      seedingGuideSlugs: profile?.seedingGuideSlugs ?? [],
      headline: profile?.headline ?? null,
      experience: profile?.experience ?? [],
    };
  },
});

export const _readReactions = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("discover_reactions")
      .withIndex("by_user_and_guide", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

/**
 * Phase 4.2 helper — affected-user lookup for guide fan-out.
 *
 * Returns the deduped set of `userId`s whose live snapshot currently
 * contains `guideId`, by scanning the `discover_snapshot_guides` junction
 * table on the indexed `by_guideId` field. A single user may appear more
 * than once in the junction (saved-override edge case where a saved guide
 * shows up across lanes); we dedup via `Set` so the caller schedules at
 * most one regen per user.
 *
 * Bounded by N = number of users with this guide on their canvas. Indexed,
 * NOT a table scan — see `convex-patterns.md` "indexes over filters".
 */
export const _readUsersForGuide = internalQuery({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args): Promise<Id<"users">[]> => {
    const rows = await ctx.db
      .query("discover_snapshot_guides")
      .withIndex("by_guideId", (q) => q.eq("guideId", args.guideId))
      .collect();
    return Array.from(new Set(rows.map((r) => r.userId)));
  },
});

/**
 * Phase 4.2 helper — cached-reason invalidation for guide fan-out.
 *
 * Deletes any `discover_match_reasons` rows for `(userId, guideId)` across
 * the supplied user set so the next regen produces fresh framing against
 * the updated guide's vectors/content. Uses the `by_user_and_guide` index
 * (indexed two-key lookup per user, no scan).
 *
 * `userIds` is supplied by the caller — we don't redo the
 * `discover_snapshot_guides` query here, both to keep the contract clean
 * and to avoid racing the action's read-then-mutate split (the action has
 * already collected the set the regen will be scheduled against).
 */
export const _invalidateReasonsForGuide = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.userIds.map((userId) =>
        ctx.db
          .query("discover_match_reasons")
          .withIndex("by_user_and_guide", (q) =>
            q.eq("userId", userId).eq("guideId", args.guideId),
          )
          .unique(),
      ),
    );
    await Promise.all(
      rows
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => ctx.db.delete(r._id)),
    );
  },
});

/**
 * Step 8 cache read. The `discover_match_reasons` table is indexed on
 * `(userId, guideId)`; we narrow to the matching `profileEmbeddingId`
 * with a follow-up `.filter()` so a stale reason for a previous embedding
 * version doesn't get returned (the snapshot pipeline keys reasons to the
 * exact embedding they were generated against).
 */
export const _readCachedReasons = internalQuery({
  args: {
    userId: v.id("users"),
    profileEmbeddingId: v.id("profile_embeddings"),
    guideIds: v.array(v.id("career_guides")),
  },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.guideIds.map((guideId) =>
        ctx.db
          .query("discover_match_reasons")
          .withIndex("by_user_and_guide", (q) =>
            q.eq("userId", args.userId).eq("guideId", guideId),
          )
          .filter((q) => q.eq(q.field("profileEmbeddingId"), args.profileEmbeddingId))
          .unique(),
      ),
    );
    return rows.filter((r): r is Doc<"discover_match_reasons"> => r !== null);
  },
});

/**
 * Step 8 cache write. Inserts or replaces reasons for the
 * (user, guide, embedding) tuple so subsequent snapshots hit cache. We
 * never persist the deterministic-template fallback (only fresh LLM
 * results), so a transient outage doesn't poison the cache.
 */
export const _writeReasons = internalMutation({
  args: {
    userId: v.id("users"),
    profileEmbeddingId: v.id("profile_embeddings"),
    entries: v.array(
      v.object({
        guideId: v.id("career_guides"),
        reason: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await Promise.all(
      args.entries.map((e) =>
        ctx.db
          .query("discover_match_reasons")
          .withIndex("by_user_and_guide", (q) =>
            q.eq("userId", args.userId).eq("guideId", e.guideId),
          )
          .filter((q) => q.eq(q.field("profileEmbeddingId"), args.profileEmbeddingId))
          .unique(),
      ),
    );
    await Promise.all(
      args.entries.map(async (e, i) => {
        const row = existing[i];
        const doc = {
          userId: args.userId,
          guideId: e.guideId,
          profileEmbeddingId: args.profileEmbeddingId,
          reason: e.reason,
          generatedAt: Date.now(),
        };
        if (row) await ctx.db.replace(row._id, doc);
        else await ctx.db.insert("discover_match_reasons", doc);
      }),
    );
  },
});

const cardValidator = v.object({
  guideId: v.id("career_guides"),
  slotKind: v.union(
    v.literal("strong"),
    v.literal("bridge"),
    v.literal("aspirational"),
    v.literal("extra"),
  ),
  arcScore: v.number(),
  currentStateScore: v.number(),
  domainScore: v.number(),
  wholeScore: v.number(),
  whyMatchReason: v.string(),
});

const laneValidator = v.object({
  kind: v.union(
    v.literal("linear"),
    v.literal("adjacent"),
    v.literal("earlier"),
    v.literal("transformational"),
  ),
  cards: v.array(cardValidator),
});

export const _writeSnapshot = internalMutation({
  args: {
    userId: v.id("users"),
    profileId: v.id("profiles"),
    profileEmbeddingId: v.id("profile_embeddings"),
    lanes: v.array(laneValidator),
  },
  handler: async (ctx, args) => {
    // Concurrency abort: if the live profile_embeddings row for this profile
    // has moved past the embedding we computed against, the snapshot is
    // already stale before we write. Bail out so a fresher in-flight
    // generation wins.
    const liveEmbedding = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .unique();
    if (liveEmbedding && liveEmbedding._id !== args.profileEmbeddingId) {
      throw new ConvexError("profile-embedding-superseded");
    }

    const existing = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const allGuideIds: Id<"career_guides">[] = [];
    for (const lane of args.lanes) {
      for (const card of lane.cards) allGuideIds.push(card.guideId);
    }

    if (existing) {
      // Wipe stale junction rows for this snapshot before re-fanning.
      const stale = await ctx.db
        .query("discover_snapshot_guides")
        .withIndex("by_snapshotId", (q) => q.eq("snapshotId", existing._id))
        .collect();
      for (const row of stale) await ctx.db.delete(row._id);

      await ctx.db.replace(existing._id, {
        userId: args.userId,
        profileId: args.profileId,
        profileEmbeddingId: args.profileEmbeddingId,
        generatedAt: Date.now(),
        status: "ready",
        lanes: args.lanes,
        attempts: 0,
      });

      for (const guideId of allGuideIds) {
        await ctx.db.insert("discover_snapshot_guides", {
          snapshotId: existing._id,
          userId: args.userId,
          guideId,
        });
      }
    } else {
      const snapshotId = await ctx.db.insert("discover_canvases", {
        userId: args.userId,
        profileId: args.profileId,
        profileEmbeddingId: args.profileEmbeddingId,
        generatedAt: Date.now(),
        status: "ready",
        lanes: args.lanes,
        attempts: 0,
      });
      for (const guideId of allGuideIds) {
        await ctx.db.insert("discover_snapshot_guides", {
          snapshotId,
          userId: args.userId,
          guideId,
        });
      }
    }
  },
});

// ─── Public reaction mutations (Task 3.1) ───────────────────────────────
//
// These three mutations are the canvas UI's write surface for the saved /
// dismissed reaction state on a guide. All three are auth-gated via
// `requireUserId` (which throws "Not authenticated" on missing identity).
// The `discover_reactions` table is keyed on (userId, guideId) via the
// `by_user_and_guide` index — so each (user, guide) pair has at most one
// row regardless of which mutation last touched it.

/**
 * Save a guide for the current user. Upserts into `discover_reactions` —
 * if a row already exists for (userId, guideId), patches its `reaction` to
 * `"saved"` (overwriting a prior `"dismissed"` state); otherwise inserts a
 * fresh row. Idempotent: calling twice in a row leaves a single saved row.
 */
export const saveGuide = mutation({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("discover_reactions")
      .withIndex("by_user_and_guide", (q) =>
        q.eq("userId", userId).eq("guideId", args.guideId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        reaction: "saved",
        reactedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("discover_reactions", {
        userId,
        guideId: args.guideId,
        reaction: "saved",
        reactedAt: Date.now(),
      });
    }
  },
});

/**
 * Dismiss a guide for the current user. Same upsert semantics as
 * `saveGuide` but writes `"dismissed"`. After persisting the reaction we
 * schedule `internal.discover.refillAfterDismiss` to backfill the dismissed
 * card slot on the canvas. v1 of `refillAfterDismiss` triggers a full
 * snapshot regen (the dismissal filter in `generateSnapshot` Step 4 then
 * drops the dismissed guide); surgical per-slot refill is a follow-up.
 */
export const dismissGuide = mutation({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("discover_reactions")
      .withIndex("by_user_and_guide", (q) =>
        q.eq("userId", userId).eq("guideId", args.guideId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        reaction: "dismissed",
        reactedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("discover_reactions", {
        userId,
        guideId: args.guideId,
        reaction: "dismissed",
        reactedAt: Date.now(),
      });
    }
    await ctx.scheduler.runAfter(0, internal.discover.refillAfterDismiss, {
      userId,
      guideId: args.guideId,
    });
  },
});

/**
 * Remove a save for the current user. Deletes the `discover_reactions` row
 * only when the existing reaction is `"saved"` — calling `removeSave` on a
 * dismissed guide is a deliberate no-op so the user can't accidentally
 * undo a dismissal through the save-undo path.
 */
export const removeSave = mutation({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("discover_reactions")
      .withIndex("by_user_and_guide", (q) =>
        q.eq("userId", userId).eq("guideId", args.guideId),
      )
      .unique();
    if (existing && existing.reaction === "saved") {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Undo a dismissal — used by the "Recently dismissed" recovery affordance
 * (and the voice undismissCard tool). Deletes the dismissed reaction so
 * the guide is eligible for the next snapshot regen, then schedules the
 * regen so the card actually reappears without the user also clicking
 * refresh. Mirrors the pattern dismissGuide uses on the way out.
 *
 * Symmetrically deliberate no-op when the reaction is "saved" — restoring
 * a saved guide is meaningless, and silently no-op'ing here protects
 * against UI bugs that would call into this from the wrong path.
 */
export const undismissGuide = mutation({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("discover_reactions")
      .withIndex("by_user_and_guide", (q) =>
        q.eq("userId", userId).eq("guideId", args.guideId),
      )
      .unique();
    if (!existing || existing.reaction !== "dismissed") return;
    await ctx.db.delete(existing._id);
    await ctx.scheduler.runAfter(
      0,
      internal.discover.scheduleSnapshotRegeneration,
      {
        userId,
        dedupKey: `undismiss:${args.guideId}`,
        forceFreshReasons: false,
      },
    );
  },
});

/**
 * List the user's dismissed guides — title + slug + when it was dismissed
 * — so the UI can offer a "recently dismissed" recovery view and the voice
 * adviser can address them by name. Sorted most-recent-first; bounded at
 * 20 to keep prompt and popover sizes reasonable. Older dismisses still
 * exist in the table; we just don't surface them.
 */
export const queryDismissedGuides = query({
  args: {},
  returns: v.array(
    v.object({
      guideId: v.id("career_guides"),
      title: v.string(),
      slug: v.string(),
      reactedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return [];

    const reactions = await ctx.db
      .query("discover_reactions")
      .withIndex("by_user_and_reaction", (q) =>
        q.eq("userId", user._id).eq("reaction", "dismissed"),
      )
      .collect();

    reactions.sort((a, b) => b.reactedAt - a.reactedAt);
    const recent = reactions.slice(0, 20);

    const out: Array<{
      guideId: Id<"career_guides">;
      title: string;
      slug: string;
      reactedAt: number;
    }> = [];
    for (const r of recent) {
      const g = await ctx.db.get(r.guideId);
      if (!g) continue;
      out.push({
        guideId: r.guideId,
        title: g.title,
        slug: g.slug,
        reactedAt: r.reactedAt,
      });
    }
    return out;
  },
});

/**
 * User-initiated discover refresh (Task 3.4).
 *
 * Invoked by the canvas UI when the user taps "refresh." Schedules a
 * snapshot regeneration with `forceFreshReasons: true` so the why-match
 * cache is bypassed — even if no underlying signal has changed, the user
 * sees fresh phrasing on every card. Other regen triggers
 * (`refillAfterDismiss`, profile-completion, embedding-regenerated) leave
 * `forceFreshReasons: false` so unchanged cards reuse their cached reasons.
 *
 * The 30s debounce gate inside `scheduleSnapshotRegeneration` (`REGEN_
 * DEBOUNCE_MS`) deliberately swallows rapid-fire clicks: firing this
 * mutation 10 times within 30s only triggers one regen, which is what we
 * want.
 *
 * Why `ctx.scheduler.runAfter(0, ...)` and not `ctx.runMutation(...)`:
 * the regen mutation itself schedules `generateSnapshot` (a third hop),
 * and the `runMutation` → scheduler composition has the same
 * "Transaction already committed" failure mode in `convex-test` that
 * `refillAfterDismiss` works around. Production semantics are identical
 * — both paths queue the regen mutation; the dedup gate handles bursts.
 */
export const manualRefresh = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    await ctx.scheduler.runAfter(
      0,
      internal.discover.scheduleSnapshotRegeneration,
      {
        userId,
        dedupKey: "manual",
        forceFreshReasons: true,
      },
    );
  },
});

/**
 * Refill the dismissed slot after a `dismissGuide` mutation.
 *
 * v1 simplicity: instead of surgically patching the dismissed card in the
 * live snapshot, we trigger a full snapshot regeneration via
 * `scheduleSnapshotRegeneration`. The dismissal is already persisted in
 * `discover_reactions`, so when `generateSnapshot` re-runs, Step 4's
 * dismissal filter drops the dismissed guide and Steps 5–8 fill its slot
 * from fresh candidates. `forceFreshReasons` is `false` so unchanged cards
 * reuse their cached why-match reasons.
 *
 * The body uses `ctx.scheduler.runAfter(0, ...)` rather than
 * `ctx.runMutation(...)` deliberately: the regen mutation itself goes on to
 * schedule `generateSnapshot` (a third hop), and a `runMutation`-then-
 * scheduler-call composition has had subtle race conditions in
 * `convex-test`. Scheduling all hops via `runAfter` keeps the chain uniform
 * and matches how production fan-out works for this flow anyway.
 *
 * Surgical per-slot refill (no full regen, just patch one card in place) is
 * a deliberate post-v1 follow-up — see the discover plan.
 */
export const refillAfterDismiss = internalAction({
  args: {
    userId: v.id("users"),
    guideId: v.id("career_guides"),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(
      0,
      internal.discover.scheduleSnapshotRegeneration,
      {
        userId: args.userId,
        dedupKey: `refill:${args.guideId}`,
        forceFreshReasons: false,
      },
    );
  },
});

/**
 * Phase 4.2 fan-out trigger — fired from `guideEmbeddings.upsert` after
 * a career guide's embedding row has been written. For every user whose
 * live snapshot currently contains the guide:
 *
 *   1. Evict the cached `discover_match_reasons` row for `(userId, guideId)`
 *      so the next regen produces fresh framing against the updated guide
 *      (cached reasons are keyed on `profileEmbeddingId`, but the guide
 *      side has changed too — the reason is a function of both, so we drop
 *      it to be safe).
 *   2. Schedule a snapshot regeneration via
 *      `scheduleSnapshotRegeneration`. The 30s per-user debounce there
 *      coalesces concurrent fan-outs (e.g. multiple guides re-embed at
 *      once); `forceFreshReasons: false` lets unaffected cards still hit
 *      cache during the next regen.
 *
 * Hooked at `guideEmbeddings.upsert` (NOT at content-update mutations) so
 * the regen always reads the freshly-written embedding vectors. Hooking at
 * content-update would race the embedding regeneration job, and the
 * debounce would suppress the second (correct) fire.
 *
 * Affected-user discovery uses `discover_snapshot_guides.by_guideId` —
 * one indexed query, bounded by N affected users per guide. No table scan
 * (see `convex-patterns.md`). Cached-reason invalidation runs in a single
 * mutation hop so all deletes share one transaction.
 *
 * Schedule pattern: each per-user regen is scheduled via
 * `ctx.scheduler.runAfter(0, ...)` (matching `refillAfterDismiss` and the
 * Phase 4.1 triggers) — `convex-test`'s multi-hop transaction state can
 * race when an action `runMutation`s into a function that itself
 * schedules. Production semantics are equivalent.
 */
export const fanOutGuideUpdate = internalAction({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    const userIds: Id<"users">[] = await ctx.runQuery(
      internal.discover._readUsersForGuide,
      { guideId: args.guideId },
    );
    if (userIds.length === 0) {
      // No live snapshot references this guide — nothing to invalidate or
      // regenerate. Common path for newly-published guides whose first
      // embedding lands before any user's snapshot has surfaced them.
      return;
    }
    await ctx.runMutation(internal.discover._invalidateReasonsForGuide, {
      guideId: args.guideId,
      userIds,
    });
    for (const userId of userIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.discover.scheduleSnapshotRegeneration,
        {
          userId,
          dedupKey: `guide:${args.guideId}`,
          forceFreshReasons: false,
        },
      );
    }
  },
});

/**
 * Phase 4.3 — nightly sweep of failed snapshots.
 *
 * Cron-driven (registered in `convex/crons.ts`, fires daily at 03:00 UTC).
 * Picks up `discover_canvases` rows in `status: "failed"` whose
 * `generatedAt` is older than 24h and whose `attempts` counter is still
 * below `SNAPSHOT_MAX_ATTEMPTS` (3), then schedules a regen for each via
 * `scheduleSnapshotRegeneration`.
 *
 * Why 24h: gives transient upstream issues (OpenRouter outage, Convex
 * deploy hiccup) time to recover before we burn another retry. Why
 * `attempts < SNAPSHOT_MAX_ATTEMPTS`: caps total retry cost at 3 per
 * permanently-broken snapshot — after that the row stays `failed` and the
 * UI surfaces the failure to the user (see `getSnapshot`).
 *
 * `dedupKey: "sweep"` distinguishes cron-driven retries from user/
 * embedding/guide-driven ones in logs. `forceFreshReasons: false` matches
 * other automated triggers — cached why-match reasons are reused when
 * possible.
 *
 * The sweep delegates to `scheduleSnapshotRegeneration` rather than
 * patching the row directly, so the dedup gate (REGEN_DEBOUNCE_MS) and the
 * insert/patch handling stay centralized in one place.
 *
 * Schedule pattern: per-row regen is scheduled via
 * `ctx.scheduler.runAfter(0, ...)` (matching `refillAfterDismiss`,
 * `manualRefresh`, and Phase 4.1/4.2 triggers) — `convex-test`'s multi-hop
 * transaction state can race when an action `runMutation`s into a function
 * that itself schedules. Production semantics are equivalent.
 */
export const sweepFailedSnapshots = internalAction({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const failed = await ctx.runQuery(internal.discover._listOldFailed, {
      cutoff,
    });
    for (const row of failed) {
      if ((row.attempts ?? 0) < SNAPSHOT_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          0,
          internal.discover.scheduleSnapshotRegeneration,
          {
            userId: row.userId,
            dedupKey: "sweep",
            forceFreshReasons: false,
          },
        );
      }
    }
  },
});

/**
 * Phase 4.3 — failed-snapshot lookup for the cron sweep.
 *
 * Indexed on `by_status` (narrows to `status: "failed"`); the
 * `.filter()` on `generatedAt` is a transformation on the indexed result
 * set, not a narrowing operation — see `convex-patterns.md` "indexes over
 * filters." Bounded by N = number of failed snapshots in the system, which
 * stays small in practice (sweep runs daily; hard failures rare).
 */
export const _listOldFailed = internalQuery({
  args: { cutoff: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("discover_canvases")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) => q.lt(q.field("generatedAt"), args.cutoff))
      .collect();
  },
});

// ─── Public read surface (Task 3.3) ─────────────────────────────────────
//
// Two queries the canvas + saved-guides UIs call:
//   - getSnapshot()       → the user's current discover_canvases row, with
//                           per-card guide details (title, slug, overview,
//                           top-3 typical skills) hydrated server-side so
//                           the UI renders without a follow-up query.
//   - querySavedGuides()  → the user's saved guides (from
//                           discover_reactions, reaction = "saved"),
//                           ordered by reactedAt desc, with snapshot card
//                           metadata (lane, whyMatchReason, arcScore)
//                           joined when the guide is currently on the
//                           canvas.
// Both auth-gate via `requireUserId` (throws on unauthenticated).

/**
 * Hydrated snapshot for the current user. Returns `null` when no snapshot
 * row exists (new user, pre-generation). The client uses `null` to
 * distinguish "loading" from "empty"; do NOT throw here.
 *
 * `attempts` is internal bookkeeping (used by the cron retry sweep) and is
 * deliberately omitted from the response. `failureReason` IS included so
 * the UI can show a "we couldn't generate, try again" message.
 *
 * Hydration cost: 3 lanes × ~7 cards = ~21 `ctx.db.get(guideId)` reads per
 * call. Bounded by the lane budget; fine for a query.
 */
export const getSnapshot = query({
  args: {},
  handler: async (ctx) => {
    // Speculative read: return null on missing identity rather than throwing,
    // matching the pattern in `users.current`. The Clerk → Convex JWT
    // handshake can race the first render of <Authenticated>'s children, so a
    // hard throw shows up as an uncaught error in the browser. Mutations
    // still throw via `requireUserId` because they're user-driven actions.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;
    const userId = user._id;
    const snap = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!snap) return null;
    // Stale-lane guard: only hydrate and return lanes when the snapshot is
    // `ready`. If `status` is `"generating"` or `"failed"`, the lanes array
    // may still hold a previous successful generation (since
    // `_markSnapshotFailed` doesn't clear lanes), so suppress them at the
    // boundary to keep the UI contract simple.
    if (snap.status !== "ready") {
      return {
        status: snap.status,
        generatedAt: snap.generatedAt,
        profileEmbeddingId: snap.profileEmbeddingId,
        failureReason: snap.failureReason,
        lanes: [] as Array<{
          kind: "linear" | "adjacent" | "earlier" | "transformational";
          cards: Array<{
            guideId: Id<"career_guides">;
            slotKind: "strong" | "bridge" | "aspirational" | "extra";
            arcScore: number;
            currentStateScore: number;
            domainScore: number;
            wholeScore: number;
            whyMatchReason: string;
            slug: string;
            title: string;
            overview: string;
            typicalSkills: string[];
          }>;
        }>,
      };
    }
    const lanes = await Promise.all(
      snap.lanes.map(async (lane) => ({
        kind: lane.kind,
        cards: await Promise.all(
          lane.cards.map(async (c) => {
            const g = await ctx.db.get(c.guideId);
            return {
              ...c,
              slug: g?.slug ?? "",
              title: g?.title ?? "(missing)",
              overview: g?.content?.overview ?? "",
              typicalSkills: (g?.content?.typicalSkills ?? []).slice(0, 3),
            };
          }),
        ),
      })),
    );
    return {
      status: snap.status,
      generatedAt: snap.generatedAt,
      profileEmbeddingId: snap.profileEmbeddingId,
      failureReason: snap.failureReason,
      lanes,
    };
  },
});

/**
 * Saved guides for the current user, ordered by `reactedAt` desc. Each
 * entry includes guide details (title, slug) and — when the guide also
 * appears on the live snapshot — the card's `lane`, `whyMatchReason`, and
 * `arcScore`. Saved guides not currently on the canvas return `null` for
 * those fields.
 *
 * Sort happens in memory: `discover_reactions` is indexed on
 * `(userId, reaction)` (not `reactedAt`), so we collect then sort. For an
 * MVP user the saved set is in the dozens at most.
 *
 * Excludes `dismissed` reactions by index-narrowing on `reaction = "saved"`.
 */
export const querySavedGuides = query({
  args: {},
  handler: async (ctx) => {
    // Same speculative-read pattern as getSnapshot: return [] on missing
    // identity to avoid auth-race throws on the client.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return [];
    const userId = user._id;
    const reactions = await ctx.db
      .query("discover_reactions")
      .withIndex("by_user_and_reaction", (q) =>
        q.eq("userId", userId).eq("reaction", "saved"),
      )
      .collect();
    reactions.sort((a, b) => b.reactedAt - a.reactedAt);
    const snap = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    const cardByGuide = new Map<
      string,
      { lane: string; whyMatchReason: string; arcScore: number }
    >();
    // Stale-lane guard: only join to the snapshot's cards when the snapshot
    // is `ready`. A `"failed"` snapshot may carry the previous successful
    // generation's lanes (since `_markSnapshotFailed` doesn't clear them);
    // surfacing those here would show stale `lane`/`whyMatchReason`/`arcScore`
    // on saved guides. Saved rows with no live card join cleanly to nulls.
    if (snap && snap.status === "ready") {
      for (const lane of snap.lanes) {
        for (const c of lane.cards) {
          cardByGuide.set(c.guideId as string, {
            lane: lane.kind,
            whyMatchReason: c.whyMatchReason,
            arcScore: c.arcScore,
          });
        }
      }
    }
    return await Promise.all(
      reactions.map(async (r) => {
        const g = await ctx.db.get(r.guideId);
        const card = cardByGuide.get(r.guideId as string);
        return {
          guideId: r.guideId,
          title: g?.title ?? "(missing)",
          slug: g?.slug ?? "",
          reactedAt: r.reactedAt,
          lane: card?.lane ?? null,
          whyMatchReason: card?.whyMatchReason ?? null,
          arcScore: card?.arcScore ?? null,
        };
      }),
    );
  },
});
