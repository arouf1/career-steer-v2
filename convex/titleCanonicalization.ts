import { v } from "convex/values";
import { generateText, Output } from "ai";
import { z } from "zod";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { chatModel } from "../lib/ai/providers";
import { expandTitleAbbreviations } from "./lib/titleAbbreviations";

export const _lookup = internalQuery({
  args: { prefilteredKey: v.string() },
  handler: async (ctx, { prefilteredKey }) => {
    return await ctx.db
      .query("title_canonicalizations")
      .withIndex("by_prefiltered_key", (q) =>
        q.eq("prefilteredKey", prefilteredKey),
      )
      .first();
  },
});

// Read-then-insert under Convex's serializable transaction. If a concurrent
// writer commits first, our commit OCC-conflicts and retries; on retry the
// read finds the existing row and we return it instead of inserting a
// duplicate. This is the layer-2 dedup primitive — guarantees one
// canonical title per prefilteredKey forever.
export const _writeThrough = internalMutation({
  args: {
    prefilteredKey: v.string(),
    sourceTitle: v.string(),
    canonicalTitle: v.string(),
    model: v.string(),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("title_canonicalizations")
      .withIndex("by_prefiltered_key", (q) =>
        q.eq("prefilteredKey", args.prefilteredKey),
      )
      .first();
    if (existing) {
      return {
        _id: existing._id,
        canonicalTitle: existing.canonicalTitle,
        confidence: existing.confidence,
        cached: true as const,
      };
    }
    const _id = await ctx.db.insert("title_canonicalizations", {
      prefilteredKey: args.prefilteredKey,
      sourceTitle: args.sourceTitle,
      canonicalTitle: args.canonicalTitle,
      model: args.model,
      confidence: args.confidence,
      createdAt: Date.now(),
    });
    return {
      _id,
      canonicalTitle: args.canonicalTitle,
      confidence: args.confidence,
      cached: false as const,
    };
  },
});

// Gemini structured output rejects bound/array-length constraints (.int(),
// .min/max, etc) — encode bounds in the prompt instead.
const canonicalSchema = z.object({
  canonical_title: z.string().describe(
    "The canonical, fully-spelled-out form of this job title for use as a " +
      "shared, public career-guide topic. Strip seniority qualifiers " +
      "(Junior, Senior, Lead, Staff, Principal, etc) UNLESS the seniority " +
      "is part of the role itself (e.g. 'Vice President', 'Chief Technology " +
      "Officer'). Spell out abbreviations. Use Title Case. Examples: " +
      "'Sr. Software Engineer' -> 'Software Engineer'; 'Sr. PM' -> " +
      "'Product Manager'; 'VP of Engineering' -> 'Vice President of " +
      "Engineering'.",
  ),
  confidence: z.number().describe(
    "Your confidence in this canonicalization, from 0.0 to 1.0. Use 1.0 " +
      "for unambiguous mappings, 0.5 for guesses, below 0.5 if the input " +
      "is too ambiguous to canonicalize.",
  ),
});

// Canonicalization is a trivial structured-extraction transform — it does
// not need a reasoning model. Project precedent: Gemini Flash is the
// standard choice for this tier of task (BRANCH_MODEL_ID, VALIDATION_MODEL_ID,
// PERSONALIZATION_MODEL_ID, PEOPLE_EXTRACT_MODEL_ID all use it). Earlier
// pick of gemini-3.1-pro-preview burned ~190 reasoning tokens before the
// JSON answer started, hitting MAX_TOKENS and yielding empty content.
const CANONICAL_MODEL_ID = "google/gemini-3-flash-preview";

export const getOrCreateCanonical = internalAction({
  args: { rawTitle: v.string() },
  handler: async (
    ctx,
    { rawTitle },
  ): Promise<{
    canonicalTitle: string;
    confidence: number;
    cached: boolean;
  }> => {
    const prefilteredKey = expandTitleAbbreviations(rawTitle);
    if (!prefilteredKey) {
      return { canonicalTitle: rawTitle.trim(), confidence: 0, cached: false };
    }

    const hit = await ctx.runQuery(internal.titleCanonicalization._lookup, {
      prefilteredKey,
    });
    if (hit) {
      return {
        canonicalTitle: hit.canonicalTitle,
        confidence: hit.confidence,
        cached: true,
      };
    }

    // No maxOutputTokens cap — Flash returns ~10–20 tokens for this prompt
    // naturally, and other Flash callers in the project don't cap either.
    const model = chatModel(CANONICAL_MODEL_ID, { zdr: true });
    const { experimental_output } = await generateText({
      model,
      experimental_output: Output.object({ schema: canonicalSchema }),
      prompt:
        "Canonicalize this job title to its general, public, " +
        "seniority-stripped form for use as a shared career-guide topic. " +
        "Output JSON matching the schema.\n\n" +
        `Raw title: ${rawTitle}`,
    });

    const canonical = experimental_output.canonical_title.trim();
    const confidence = experimental_output.confidence;

    const written = await ctx.runMutation(
      internal.titleCanonicalization._writeThrough,
      {
        prefilteredKey,
        sourceTitle: rawTitle,
        canonicalTitle: canonical,
        model: CANONICAL_MODEL_ID,
        confidence,
      },
    );

    return {
      canonicalTitle: written.canonicalTitle,
      confidence: written.confidence,
      cached: written.cached,
    };
  },
});
