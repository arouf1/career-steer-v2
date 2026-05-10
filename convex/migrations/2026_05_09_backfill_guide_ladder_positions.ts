// One-shot: classify every existing career_guide onto a career_ladder via an
// LLM call, then write the resulting position to
// `career_guide_ladder_positions` (or to the `career_guide_ladder_review`
// queue when the classifier returns confidence: "low").
//
// Invoke once with no args:
//   npx convex run --no-push 'migrations/2026_05_09_backfill_guide_ladder_positions:backfill' '{}'
//
// Resumable: skips guides that already have at least one position. Idempotent
// in the sense that re-running on a partially-populated catalog only fills
// the gaps. Run AFTER `2026_05_09_seed_ladders:seedLadders`.
//
// Cost: ~140 Gemini Flash calls @ ~7KB I/O each = ~$0.05 total. The action
// self-reschedules in batches of 10 to stay well under any per-action wall
// time and to keep individual mutations small.

import { v } from "convex/values";
import { generateText, Output } from "ai";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { chatModel } from "../../lib/ai/providers";
import {
  LADDER_CLASSIFY_MODEL_ID,
  LadderAssignmentSchema,
  buildLadderAssignmentPrompt,
} from "../../lib/ai/prompts/career-ladders";
import type { LadderForPrompt } from "../../lib/ai/prompts/career-ladders";

const BATCH_SIZE = 10;

// ── Helper queries ────────────────────────────────────────────────────────

export const _listGuidesNeedingClassification = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("career_guides")
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE * 4 });

    // Filter out guides that already have at least one position. Cheaper to
    // pull a wider page and filter in JS than to do per-guide existence
    // checks one at a time downstream.
    const filtered: { guide: Doc<"career_guides">; needsClassification: boolean }[] = [];
    for (const guide of page.page) {
      const existingPos = await ctx.db
        .query("career_guide_ladder_positions")
        .withIndex("by_guide", (q) => q.eq("guideId", guide._id))
        .first();
      filtered.push({ guide, needsClassification: existingPos === null });
    }

    return {
      page: filtered.filter((x) => x.needsClassification).map((x) => x.guide),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const _loadLaddersForPrompt = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      slug: v.string(),
      name: v.string(),
      family: v.string(),
      description: v.string(),
      occupiedRungs: v.array(
        v.object({
          rung: v.number(),
          tier: v.string(),
          guides: v.array(
            v.object({ title: v.string(), slug: v.string() }),
          ),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const ladders = await ctx.db.query("career_ladders").take(200);
    const out: LadderForPrompt[] = [];
    for (const ladder of ladders) {
      const positions = await ctx.db
        .query("career_guide_ladder_positions")
        .withIndex("by_ladder_rung", (q) => q.eq("ladderId", ladder._id))
        .order("asc")
        .take(50);

      // Group positions by rung so each rung lists every guide attached to it.
      const byRung = new Map<
        number,
        { tier: string; guides: { title: string; slug: string }[] }
      >();
      for (const pos of positions) {
        const guide = await ctx.db.get(pos.guideId);
        if (!guide) continue;
        const entry = byRung.get(pos.rung);
        if (entry) {
          entry.guides.push({ title: guide.title, slug: guide.slug });
        } else {
          byRung.set(pos.rung, {
            tier: pos.tier,
            guides: [{ title: guide.title, slug: guide.slug }],
          });
        }
      }

      const occupiedRungs: LadderForPrompt["occupiedRungs"] = [];
      for (const [rung, { tier, guides }] of byRung.entries()) {
        occupiedRungs.push({ rung, tier, guides });
      }

      out.push({
        slug: ladder.slug,
        name: ladder.name,
        family: ladder.family,
        description: ladder.description,
        occupiedRungs,
      });
    }
    return out;
  },
});

// ── Helper mutation ───────────────────────────────────────────────────────

export const _writeAssignment = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    primary: v.object({
      slug: v.string(),
      rung: v.number(),
      tier: v.union(
        v.literal("ic-entry"),
        v.literal("ic-mid"),
        v.literal("ic-senior"),
        v.literal("manager"),
        v.literal("head"),
        v.literal("director"),
        v.literal("vp"),
        v.literal("c-suite"),
      ),
      confidence: v.union(
        v.literal("high"),
        v.literal("medium"),
        v.literal("low"),
      ),
    }),
    secondary: v.union(
      v.null(),
      v.object({
        slug: v.string(),
        rung: v.number(),
        tier: v.union(
          v.literal("ic-entry"),
          v.literal("ic-mid"),
          v.literal("ic-senior"),
          v.literal("manager"),
          v.literal("head"),
          v.literal("director"),
          v.literal("vp"),
          v.literal("c-suite"),
        ),
        confidence: v.union(
          v.literal("high"),
          v.literal("medium"),
          v.literal("low"),
        ),
      }),
    ),
    reasoning: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const writeOne = async (
      placement: typeof args.primary,
    ): Promise<"position" | "review" | "skip"> => {
      const ladder = await ctx.db
        .query("career_ladders")
        .withIndex("by_slug", (q) => q.eq("slug", placement.slug))
        .unique();
      if (!ladder) {
        // The classifier hallucinated a ladder slug; queue for review with
        // confidence "low" so a human can fix it.
        await ctx.db.insert("career_guide_ladder_review", {
          guideId: args.guideId,
          proposedLadderSlug: placement.slug,
          proposedRung: placement.rung,
          proposedTier: placement.tier,
          confidence: "low",
          reasoning: `Hallucinated ladder slug: ${args.reasoning}`,
          queuedAt: now,
        });
        return "review";
      }

      if (placement.confidence === "low") {
        await ctx.db.insert("career_guide_ladder_review", {
          guideId: args.guideId,
          proposedLadderSlug: placement.slug,
          proposedRung: placement.rung,
          proposedTier: placement.tier,
          confidence: "low",
          reasoning: args.reasoning,
          queuedAt: now,
        });
        return "review";
      }

      await ctx.db.insert("career_guide_ladder_positions", {
        ladderId: ladder._id,
        guideId: args.guideId,
        rung: placement.rung,
        tier: placement.tier,
        assignedAt: now,
        assignedBy: "backfill-llm",
      });
      return "position";
    };

    const primaryResult = await writeOne(args.primary);
    let secondaryResult: "position" | "review" | "skip" = "skip";
    if (args.secondary) {
      secondaryResult = await writeOne(args.secondary);
    }

    return { primaryResult, secondaryResult };
  },
});

// ── Action orchestrator ───────────────────────────────────────────────────

export const backfill = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    classified: v.number(),
    queuedForReview: v.number(),
    failed: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{
    classified: number;
    queuedForReview: number;
    failed: number;
    isDone: boolean;
  }> => {
    const ladders: LadderForPrompt[] = await ctx.runQuery(
      internal.migrations[
        "2026_05_09_backfill_guide_ladder_positions"
      ]._loadLaddersForPrompt,
      {},
    );

    if (ladders.length === 0) {
      throw new Error(
        "No ladders defined. Run 2026_05_09_seed_ladders:seedLadders first.",
      );
    }

    const result: {
      page: Doc<"career_guides">[];
      isDone: boolean;
      continueCursor: string | null;
    } = await ctx.runQuery(
      internal.migrations[
        "2026_05_09_backfill_guide_ladder_positions"
      ]._listGuidesNeedingClassification,
      { cursor: args.cursor },
    );

    let classified = 0;
    let queuedForReview = 0;
    let failed = 0;

    // Sequential per guide, keeps per-batch wall time predictable, avoids
    // bursting OpenRouter rate limits, and the backfill is one-shot anyway.
    for (const guide of result.page.slice(0, BATCH_SIZE)) {
      const overview = guide.content?.overview ?? "";
      const stage = guide.content?.typicalCareerStage;

      try {
        const { output } = await generateText({
          model: chatModel(LADDER_CLASSIFY_MODEL_ID, { zdr: true }),
          output: Output.object({ schema: LadderAssignmentSchema }),
          prompt: buildLadderAssignmentPrompt({
            guideTitle: guide.title,
            guideOverview: overview,
            guideTypicalCareerStage: stage,
            ladders,
          }),
        });

        await ctx.runMutation(
          internal.migrations[
            "2026_05_09_backfill_guide_ladder_positions"
          ]._writeAssignment,
          {
            guideId: guide._id,
            primary: output.primaryLadder,
            secondary: output.secondaryLadder,
            reasoning: output.reasoning,
          },
        );

        if (output.primaryLadder.confidence === "low") {
          queuedForReview++;
        } else {
          classified++;
        }
      } catch (err) {
        failed++;
        console.error("backfill: classify failed", {
          guideId: guide._id,
          title: guide.title,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!result.isDone || result.page.length > BATCH_SIZE) {
      // More guides to process, reschedule. Use the page's continueCursor if
      // the page itself is exhausted; otherwise the same cursor lets us keep
      // chewing through the larger filtered page in BATCH_SIZE chunks.
      const nextCursor =
        result.page.length > BATCH_SIZE
          ? args.cursor ?? null
          : result.continueCursor;

      await ctx.scheduler.runAfter(
        0,
        internal.migrations[
          "2026_05_09_backfill_guide_ladder_positions"
        ].backfill,
        { cursor: nextCursor },
      );
    }

    return {
      classified,
      queuedForReview,
      failed,
      isDone: result.isDone && result.page.length <= BATCH_SIZE,
    };
  },
});
