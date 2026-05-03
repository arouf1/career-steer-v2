"use node";

// Autonomous career-guide catalog expansion. Fired hourly from convex/crons.ts.
// One tick = one new guide (best case). The pipeline is deliberately
// dedup-paranoid because duplicate guides split discoverability and waste
// substantial spend (8 Exa calls + content LLM + 5 illustrations + podcast
// per guide).
//
// Per-tick flow:
//   1. Pick this hour's industry bucket (deterministic round-robin, 12-hour cycle).
//   2. Load a sample of recent slugs as anti-dup context for the brainstorm prompt.
//   3. Brainstorm 5 candidate canonical titles via Gemini Flash + structured output.
//   4. For each candidate, in priority order:
//      a. Canonicalize via existing titleCanonicalization.getOrCreateCanonical.
//      b. Pre-check the DB against the canonicalized slug+title — drop if exists.
//      c. Verify legitimacy via Exa + LLM judge (confidence >= 0.7).
//      d. Re-canonicalize using the judge's refined title (catches the case
//         where Exa points at a more standard variant than what was brainstormed).
//      e. Re-check the DB after the second canonicalization — drop if exists.
//      f. Schedule generation via _requestGenerationForCron. The mutation does
//         a final OCC-protected dedup, so concurrent fan-outs from any other
//         entry point (user-driven seeding, search create) resolve to one row.
//      g. If the mutation reports a brand-new row was inserted, fire the email.
//      Bail on first success — we want one new guide per tick, not five.
//   5. If no candidate survives, log and return; the next hourly tick retries
//      with a different industry bucket.
//
// Failure semantics: any unhandled exception is caught at the action boundary
// and logged. The cron's hourly cadence absorbs transient failures; the
// downstream content/illustration/embedding/podcast chain has its own retry
// policies (see _retryFailedGuides cron).

import { generateText, Output } from "ai";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { chatModel } from "../lib/ai/providers";
import { exaAnswer } from "../lib/server/exa";
import { normalizeTitle, slugify } from "./lib/normalize";
import {
  BRAINSTORM_SYSTEM_PROMPT,
  LEGITIMACY_JUDGE_SYSTEM_PROMPT,
  buildBrainstormPrompt,
  buildLegitimacyExaQuery,
  buildLegitimacyJudgePrompt,
  pickIndustryBucket,
  type IndustryBucket,
} from "../lib/ai/prompts/catalog-expansion";

// Brainstorm + judge are structured-extraction tasks; Flash is the right
// tier (matches the canonicalization model choice — neither needs reasoning).
const BRAINSTORM_MODEL_ID = "google/gemini-3-flash-preview";
const JUDGE_MODEL_ID = "google/gemini-3-flash-preview";

// How many recent guide titles to surface to the brainstorm prompt as
// anti-duplication context. Bounded so the prompt stays within token budget;
// the actual DB-backed dedup happens later in the pipeline.
const SLUG_SAMPLE_SIZE = 200;

// Gates that drop a candidate. Per the rules in catalog-expansion.ts the
// canonicalization step returns 0.0–1.0; the seeding pipeline already uses
// 0.3 as its floor, but for autonomous catalog growth we want a higher bar.
const MIN_CANONICALIZATION_CONFIDENCE = 0.5;
const MIN_LEGITIMACY_CONFIDENCE = 0.7;

const CANDIDATES_PER_TICK = 5;

const brainstormSchema = z.object({
  candidates: z
    .array(z.string())
    .describe(
      "Exactly 5 canonical job titles, each in Title Case, none duplicating " +
        "or paraphrasing the existing-catalog sample, all in the requested " +
        "industry bucket.",
    ),
});

const legitimacyJudgeSchema = z.object({
  isLegitimate: z
    .boolean()
    .describe("True only if all 4 rubric rules pass."),
  canonicalTitle: z
    .string()
    .describe(
      "The corrected canonical Title Case form of this role. May equal the " +
        "candidate or be a corrected variant from the Exa evidence.",
    ),
  confidence: z
    .number()
    .describe("0.0–1.0 confidence the rubric is satisfied."),
  reasoning: z
    .string()
    .describe("1–2 sentence rationale, plain text, for logs."),
});

type LegitimacyVerdict = z.infer<typeof legitimacyJudgeSchema>;

const brainstormCandidates = async (params: {
  industryBucket: IndustryBucket;
  existingSample: ReadonlyArray<{ slug: string; title: string }>;
}): Promise<string[]> => {
  const { industryBucket, existingSample } = params;
  const model = chatModel(BRAINSTORM_MODEL_ID, { zdr: true });
  const { experimental_output } = await generateText({
    model,
    experimental_output: Output.object({ schema: brainstormSchema }),
    system: BRAINSTORM_SYSTEM_PROMPT,
    prompt: buildBrainstormPrompt({ industryBucket, existingSample }),
  });
  // Trim + drop empties + de-dup within this brainstorm to avoid wasting
  // downstream calls if the model accidentally repeats itself.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of experimental_output.candidates ?? []) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.slice(0, CANDIDATES_PER_TICK);
};

const judgeLegitimacy = async (
  candidateTitle: string,
): Promise<LegitimacyVerdict | null> => {
  let exaResult: Awaited<ReturnType<typeof exaAnswer>>;
  try {
    exaResult = await exaAnswer(buildLegitimacyExaQuery(candidateTitle));
  } catch (err) {
    console.warn(
      `[catalogExpansion] Exa failed for "${candidateTitle}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  if (!exaResult.answer || exaResult.answer.trim().length < 50) {
    console.warn(
      `[catalogExpansion] Exa answer too short for "${candidateTitle}" — rejecting`,
    );
    return null;
  }

  const model = chatModel(JUDGE_MODEL_ID, { zdr: true });
  const { experimental_output } = await generateText({
    model,
    experimental_output: Output.object({ schema: legitimacyJudgeSchema }),
    system: LEGITIMACY_JUDGE_SYSTEM_PROMPT,
    prompt: buildLegitimacyJudgePrompt({
      candidateTitle,
      exaAnswer: exaResult.answer,
    }),
  });
  return experimental_output;
};

export const runExpansion = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    status: "created" | "skipped" | "exhausted";
    slug?: string;
    title?: string;
    industryBucket: IndustryBucket;
    candidatesTried: number;
  }> => {
    const industryBucket = pickIndustryBucket(new Date());
    const existingSample: Array<{ slug: string; title: string }> =
      await ctx.runQuery(internal.careerGuides._loadRecentSlugSample, {
        limit: SLUG_SAMPLE_SIZE,
      });

    let candidates: string[];
    try {
      candidates = await brainstormCandidates({
        industryBucket,
        existingSample,
      });
    } catch (err) {
      console.error(
        "[catalogExpansion] brainstorm failed:",
        err instanceof Error ? err.message : err,
      );
      return {
        status: "skipped",
        industryBucket,
        candidatesTried: 0,
      };
    }

    if (candidates.length === 0) {
      console.warn(
        `[catalogExpansion] brainstorm returned no candidates for bucket ${industryBucket}`,
      );
      return {
        status: "skipped",
        industryBucket,
        candidatesTried: 0,
      };
    }

    let tried = 0;
    for (const rawCandidate of candidates) {
      tried += 1;

      // Step 4a — first canonicalization (catches "Sr. PM" → "Product Manager").
      const firstPass: {
        canonicalTitle: string;
        confidence: number;
        cached: boolean;
      } = await ctx.runAction(
        internal.titleCanonicalization.getOrCreateCanonical,
        { rawTitle: rawCandidate },
      );
      if (firstPass.confidence < MIN_CANONICALIZATION_CONFIDENCE) {
        console.log(
          `[catalogExpansion] dropping "${rawCandidate}" — canonicalization confidence ${firstPass.confidence}`,
        );
        continue;
      }

      // Step 4b — pre-Exa DB dedup against the first-pass canonical.
      const firstPassCheck = await ctx.runQuery(
        internal.careerGuides._lookupBySlugOrTitle,
        {
          slug: slugify(firstPass.canonicalTitle),
          titleNormalized: normalizeTitle(firstPass.canonicalTitle),
        },
      );
      if (firstPassCheck.exists) {
        console.log(
          `[catalogExpansion] "${firstPass.canonicalTitle}" already in catalog (${firstPassCheck.contentStatus}) — skipping`,
        );
        continue;
      }

      // Step 4c — legitimacy verification via Exa + LLM judge.
      const verdict = await judgeLegitimacy(firstPass.canonicalTitle);
      if (
        !verdict ||
        !verdict.isLegitimate ||
        verdict.confidence < MIN_LEGITIMACY_CONFIDENCE
      ) {
        console.log(
          `[catalogExpansion] rejecting "${firstPass.canonicalTitle}" — verdict:`,
          verdict
            ? {
                isLegitimate: verdict.isLegitimate,
                confidence: verdict.confidence,
                reasoning: verdict.reasoning,
              }
            : "exa_or_judge_failed",
        );
        continue;
      }

      // Step 4d — re-canonicalize using the judge's refined title. The judge
      // may have surfaced a more standard variant than the brainstorm output;
      // we want the canonicalization cache and the final guide row to use the
      // best canonical form available.
      const finalPass: {
        canonicalTitle: string;
        confidence: number;
        cached: boolean;
      } = await ctx.runAction(
        internal.titleCanonicalization.getOrCreateCanonical,
        { rawTitle: verdict.canonicalTitle },
      );
      if (finalPass.confidence < MIN_CANONICALIZATION_CONFIDENCE) {
        console.log(
          `[catalogExpansion] dropping after judge — second canonicalization confidence ${finalPass.confidence}`,
        );
        continue;
      }

      // Step 4e — re-check after second canonicalization. The judge's refined
      // title may now collide with an existing slug that the first-pass
      // canonical didn't.
      const finalCheck = await ctx.runQuery(
        internal.careerGuides._lookupBySlugOrTitle,
        {
          slug: slugify(finalPass.canonicalTitle),
          titleNormalized: normalizeTitle(finalPass.canonicalTitle),
        },
      );
      if (finalCheck.exists) {
        console.log(
          `[catalogExpansion] post-judge canonical "${finalPass.canonicalTitle}" already in catalog — skipping`,
        );
        continue;
      }

      // Step 4f — request generation. Mutation does its own OCC-protected
      // dedup as the final line of defense against races.
      const result: { slug: string; created: boolean } | { error: string } =
        await ctx.runMutation(internal.careerGuides._requestGenerationForCron, {
          title: finalPass.canonicalTitle,
        });

      if ("error" in result) {
        console.warn(
          `[catalogExpansion] _requestGenerationForCron rejected "${finalPass.canonicalTitle}":`,
          result.error,
        );
        // Hitting the global rate limit is terminal for this tick — don't
        // burn more candidates if we can't insert anyway.
        if (result.error.includes("rate limit")) {
          return {
            status: "skipped",
            industryBucket,
            candidatesTried: tried,
          };
        }
        continue;
      }

      if (!result.created) {
        // Race winner inserted before us, or a "failed" row we declined to
        // reset. Either way, not our publish.
        console.log(
          `[catalogExpansion] "${finalPass.canonicalTitle}" already exists post-mutation (race) — skipping email`,
        );
        continue;
      }

      // Step 4g — fire-and-forget email notification.
      await ctx.scheduler.runAfter(
        0,
        internal.catalogEmail.sendCatalogCreateEmail,
        {
          slug: result.slug,
          title: finalPass.canonicalTitle,
          industryBucket,
          judgeReasoning: verdict.reasoning,
          judgeConfidence: verdict.confidence,
        },
      );

      console.log(
        `[catalogExpansion] queued "${finalPass.canonicalTitle}" (${result.slug}) for ${industryBucket}`,
      );
      return {
        status: "created",
        slug: result.slug,
        title: finalPass.canonicalTitle,
        industryBucket,
        candidatesTried: tried,
      };
    }

    console.log(
      `[catalogExpansion] no survivors for ${industryBucket} after ${tried} candidates`,
    );
    return {
      status: "exhausted",
      industryBucket,
      candidatesTried: tried,
    };
  },
});

