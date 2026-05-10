import { generateText, Output } from "ai";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { chatModel } from "../lib/ai/providers";
import {
  buildCorrectionPrompt,
  CORRECTION_SYSTEM_PROMPT,
  JOB_QUERY_CORRECTION_MODEL_ID,
  normalizeQueryForCorrectionCache,
  QueryCorrectionSchema,
  shouldCorrect,
} from "../lib/ai/prompts/queryCorrection";

// Confidence floor below which we ignore the LLM's "correction" and treat
// the input as unchanged. Bias toward not surprising the user.
const MIN_APPLY_CONFIDENCE = 0.85;

// Hard timeout. Flash usually returns in <1s, but a runaway shouldn't
// block the search action's own deadline.
const RUN_TIMEOUT_MS = 10_000;

// ── Cache lookup ──────────────────────────────────────────────────────────

export const _lookup = internalQuery({
  args: { inputNormalized: v.string() },
  handler: async (ctx, { inputNormalized }) => {
    return await ctx.db
      .query("query_corrections")
      .withIndex("by_inputNormalized", (q) =>
        q.eq("inputNormalized", inputNormalized),
      )
      .first();
  },
});

// Read-then-insert under Convex's serializable transaction. If a concurrent
// writer commits first, our commit OCC-conflicts and retries; on retry the
// read finds the existing row and we return it instead of inserting a
// duplicate. Layer-2 dedup primitive, guarantees one cached correction
// per inputNormalized forever. Mirrors titleCanonicalization._writeThrough.
export const _writeThrough = internalMutation({
  args: {
    inputNormalized: v.string(),
    corrected: v.string(),
    hadTypo: v.boolean(),
    confidence: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("query_corrections")
      .withIndex("by_inputNormalized", (q) =>
        q.eq("inputNormalized", args.inputNormalized),
      )
      .first();
    if (existing) {
      return {
        corrected: existing.corrected,
        hadTypo: existing.hadTypo,
        confidence: existing.confidence,
        cached: true as const,
      };
    }
    await ctx.db.insert("query_corrections", {
      inputNormalized: args.inputNormalized,
      corrected: args.corrected,
      hadTypo: args.hadTypo,
      confidence: args.confidence,
      model: args.model,
      createdAt: Date.now(),
    });
    return {
      corrected: args.corrected,
      hadTypo: args.hadTypo,
      confidence: args.confidence,
      cached: false as const,
    };
  },
});

// ── The action ────────────────────────────────────────────────────────────
//
// Returns the (possibly-corrected) query plus a hadTypo flag the search
// action can surface to the UI. Cheap on cache hit; ~500ms-1s on cache miss.

export const getOrCreateCorrection = internalAction({
  args: { rawQuery: v.string() },
  returns: v.object({
    corrected: v.string(),
    hadTypo: v.boolean(),
    confidence: v.number(),
    cached: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    corrected: string;
    hadTypo: boolean;
    confidence: number;
    cached: boolean;
  }> => {
    const inputNormalized = normalizeQueryForCorrectionCache(args.rawQuery);
    if (!shouldCorrect(inputNormalized)) {
      return {
        corrected: args.rawQuery,
        hadTypo: false,
        confidence: 1,
        cached: false,
      };
    }

    // Cache lookup, free path.
    const hit = await ctx.runQuery(internal.queryCorrection._lookup, {
      inputNormalized,
    });
    if (hit) {
      return {
        corrected: hit.corrected,
        hadTypo: hit.hadTypo,
        confidence: hit.confidence,
        cached: true,
      };
    }

    // Flash call.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
    let parsed: {
      corrected: string;
      hadTypo: boolean;
      confidence: number;
    };
    try {
      const { experimental_output } = await generateText({
        model: chatModel(JOB_QUERY_CORRECTION_MODEL_ID, { zdr: true }),
        experimental_output: Output.object({ schema: QueryCorrectionSchema }),
        system: CORRECTION_SYSTEM_PROMPT,
        prompt: buildCorrectionPrompt(args.rawQuery),
        abortSignal: controller.signal,
      });
      parsed = experimental_output;
    } catch (err) {
      console.error("queryCorrection.getOrCreateCorrection:flash-failed", {
        rawQuery: args.rawQuery,
        err: err instanceof Error ? err.message : String(err),
      });
      // Fail open, return the input unchanged. Don't cache the failure;
      // a transient OpenRouter blip shouldn't lock in a no-correction.
      return {
        corrected: args.rawQuery,
        hadTypo: false,
        confidence: 0,
        cached: false,
      };
    } finally {
      clearTimeout(timeout);
    }

    // Apply confidence floor + reject pathological outputs.
    const confidence = Math.max(0, Math.min(1, parsed.confidence));
    let { corrected, hadTypo } = parsed;
    if (hadTypo && confidence < MIN_APPLY_CONFIDENCE) {
      corrected = args.rawQuery;
      hadTypo = false;
    }
    if (corrected.length === 0) {
      corrected = args.rawQuery;
      hadTypo = false;
    }

    const written = await ctx.runMutation(
      internal.queryCorrection._writeThrough,
      {
        inputNormalized,
        corrected,
        hadTypo,
        confidence,
        model: JOB_QUERY_CORRECTION_MODEL_ID,
      },
    );

    return {
      corrected: written.corrected,
      hadTypo: written.hadTypo,
      confidence: written.confidence,
      cached: written.cached,
    };
  },
});
