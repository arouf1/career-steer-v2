import { v } from "convex/values";
import { generateText, Output } from "ai";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { chatModel } from "../lib/ai/providers";
import {
  CONTENT_MODEL_ID,
  DeepenAnswerSchema,
  DeepenAnswerGroundedSchema,
  buildDeepenPrompt,
  buildDeepenPromptGrounded,
  buildBranchExaQuery,
  isFactHeavySection,
} from "../lib/ai/prompts/career-guides";
import { exaAnswer, type Citation } from "../lib/server/exa";

const RUN_TIMEOUT_MS = 60_000;

const citationValidator = v.object({
  url: v.string(),
  title: v.string(),
  publisher: v.optional(v.string()),
  fetchedAt: v.number(),
});

const normalizeQuestion = (q: string): string =>
  q.toLowerCase().replace(/\s+/g, " ").trim();

// Re-derive the parent section's prose so the model has the same context the
// reader did when they clicked the chip. Mirrors the rendering split in
// CareerGuideArticle.tsx.
const sectionProseFor = (
  guide: Doc<"career_guides">,
  sectionId: string,
): string => {
  const c = guide.content;
  if (!c) return "";
  switch (sectionId) {
    case "overview":
      return c.overview;
    case "day-to-day":
      return c.dayToDay;
    case "outlook-us":
      return c.regional.us.careerOutlook;
    case "outlook-uk":
      return c.regional.uk.careerOutlook;
    case "learning-path-us":
      return c.regional.us.learningPath
        .map((step, i) => `${i + 1}. ${step}`)
        .join("\n");
    case "learning-path-uk":
      return c.regional.uk.learningPath
        .map((step, i) => `${i + 1}. ${step}`)
        .join("\n");
    case "considerations":
      return c.riskFactors.map((r, i) => `${i + 1}. ${r}`).join("\n");
    default:
      return "";
  }
};

// Map a UI sectionId to the citations key used in `career_guides.citations`.
// (The citations map keys come from the enrichment pipeline, which uses
// "regional.us.careerOutlook" etc. — we translate.)
const citationsKeyFor = (sectionId: string): string | null => {
  switch (sectionId) {
    case "outlook-us":
      return "regional.us.careerOutlook";
    case "outlook-uk":
      return "regional.uk.careerOutlook";
    case "learning-path-us":
      return "regional.us.learningPath";
    case "learning-path-uk":
      return "regional.uk.learningPath";
    case "considerations":
      return "riskFactors";
    default:
      return null;
  }
};

const parentCitationsFor = (
  guide: Doc<"career_guides">,
  sectionId: string,
): Citation[] => {
  const key = citationsKeyFor(sectionId);
  if (!key) return [];
  const raw = guide.citations?.[key];
  return raw ?? [];
};

// ── Public query ────────────────────────────────────────────────────────────

export const listForGuide = query({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args): Promise<Doc<"career_guide_branches">[]> => {
    const rows = await ctx.db
      .query("career_guide_branches")
      .withIndex("by_guide_section", (q) => q.eq("guideId", args.guideId))
      .collect();
    return rows.filter((r) => r.flagged !== true);
  },
});

// ── Internal queries ────────────────────────────────────────────────────────

export const _getBranch = internalQuery({
  args: { branchId: v.id("career_guide_branches") },
  handler: (ctx, args) => ctx.db.get(args.branchId),
});

export const _getGuide = internalQuery({
  args: { guideId: v.id("career_guides") },
  handler: (ctx, args) => ctx.db.get(args.guideId),
});

// ── Internal mutations ──────────────────────────────────────────────────────

// Transactional dedup. If a row already exists for this normalized question,
// return its id; otherwise insert. Race-safe because mutations are atomic.
export const _createOrGetBranch = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    sectionId: v.string(),
    question: v.string(),
  },
  returns: v.object({
    branchId: v.id("career_guide_branches"),
    isNew: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ branchId: Id<"career_guide_branches">; isNew: boolean }> => {
    const questionNormalized = normalizeQuestion(args.question);

    const existing = await ctx.db
      .query("career_guide_branches")
      .withIndex("by_guide_question", (q) =>
        q
          .eq("guideId", args.guideId)
          .eq("questionNormalized", questionNormalized),
      )
      .first();
    if (existing) {
      // If a previous attempt failed, reset it so the action runs again.
      if (existing.status === "failed") {
        await ctx.db.patch(existing._id, {
          status: "generating",
          error: undefined,
        });
        return { branchId: existing._id, isNew: true };
      }
      return { branchId: existing._id, isNew: false };
    }

    const groundingMode = isFactHeavySection(args.sectionId)
      ? ("exa" as const)
      : ("inherited" as const);

    const branchId = await ctx.db.insert("career_guide_branches", {
      guideId: args.guideId,
      sectionId: args.sectionId,
      question: args.question,
      questionNormalized,
      status: "generating",
      groundingMode,
      createdAt: Date.now(),
    });

    return { branchId, isNew: true };
  },
});

export const _markBranchResearching = internalMutation({
  args: { branchId: v.id("career_guide_branches") },
  handler: async (ctx, args) => {
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.status === "complete") return;
    await ctx.db.patch(args.branchId, { status: "researching" });
  },
});

export const _completeBranch = internalMutation({
  args: {
    branchId: v.id("career_guide_branches"),
    answer: v.object({ title: v.string(), body: v.string() }),
    citations: v.optional(v.array(citationValidator)),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.branchId, {
      status: "complete",
      answer: args.answer,
      ...(args.citations && args.citations.length > 0
        ? { citations: args.citations }
        : {}),
      error: undefined,
    });
  },
});

export const _failBranch = internalMutation({
  args: { branchId: v.id("career_guide_branches"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.branchId, {
      status: "failed",
      error: args.error.slice(0, 500),
    });
  },
});

// ── Public action ───────────────────────────────────────────────────────────

export const deepenSection = action({
  args: {
    guideId: v.id("career_guides"),
    sectionId: v.string(),
    question: v.string(),
  },
  returns: v.object({
    branchId: v.id("career_guide_branches"),
    cached: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    branchId: Id<"career_guide_branches">;
    cached: boolean;
  }> => {
    const trimmed = args.question.trim();
    if (trimmed.length < 4 || trimmed.length > 240) {
      throw new Error("Question must be 4 to 240 characters");
    }

    const { branchId, isNew }: {
      branchId: Id<"career_guide_branches">;
      isNew: boolean;
    } = await ctx.runMutation(internal.guideBranches._createOrGetBranch, {
      guideId: args.guideId,
      sectionId: args.sectionId,
      question: trimmed,
    });

    if (isNew) {
      await ctx.scheduler.runAfter(
        0,
        internal.guideBranches._runBranchGeneration,
        { branchId },
      );
    }

    return { branchId, cached: !isNew };
  },
});

// ── Generation action ──────────────────────────────────────────────────────

export const _runBranchGeneration = internalAction({
  args: { branchId: v.id("career_guide_branches") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    try {
      const branch = await ctx.runQuery(internal.guideBranches._getBranch, {
        branchId: args.branchId,
      });
      if (!branch) return null;
      const guide = await ctx.runQuery(internal.guideBranches._getGuide, {
        guideId: branch.guideId,
      });
      if (!guide || !guide.content) {
        await ctx.runMutation(internal.guideBranches._failBranch, {
          branchId: args.branchId,
          error: "Parent guide has no content",
        });
        return null;
      }

      const sectionProse = sectionProseFor(guide, branch.sectionId);
      const parentCitations = parentCitationsFor(guide, branch.sectionId);

      if (branch.groundingMode === "inherited") {
        const { output } = await generateText({
          model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
          output: Output.object({ schema: DeepenAnswerSchema }),
          prompt: buildDeepenPrompt({
            guideTitle: guide.title,
            sectionId: branch.sectionId,
            sectionProse,
            parentCitations,
            question: branch.question,
          }),
          abortSignal: controller.signal,
        });
        await ctx.runMutation(internal.guideBranches._completeBranch, {
          branchId: args.branchId,
          answer: { title: output.title, body: output.body },
        });
        return null;
      }

      // exa-grounded path
      await ctx.runMutation(internal.guideBranches._markBranchResearching, {
        branchId: args.branchId,
      });

      let exaAnswerText = "";
      let exaSources: Citation[] = [];
      try {
        const { query: exaQuery, systemPrompt } = buildBranchExaQuery({
          guideTitle: guide.title,
          sectionId: branch.sectionId,
          question: branch.question,
        });
        const res = await exaAnswer(exaQuery, {
          systemPrompt,
          signal: controller.signal,
        });
        exaAnswerText = res.answer;
        exaSources = res.citations;
      } catch (err) {
        // Soft-fail: fall through to inherited-style generation. The Exa
        // outage shouldn't block the branch; we just won't have new sources.
        console.error("guideBranches:exa-failed", {
          branchId: args.branchId,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      const { output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: DeepenAnswerGroundedSchema }),
        prompt: buildDeepenPromptGrounded({
          guideTitle: guide.title,
          sectionId: branch.sectionId,
          sectionProse,
          parentCitations,
          exaAnswer: exaAnswerText,
          exaSources,
          question: branch.question,
        }),
        abortSignal: controller.signal,
      });

      const usedCitations: Citation[] = (output.citationIndexes ?? [])
        .filter((i): i is number => Number.isInteger(i) && i >= 0 && i < exaSources.length)
        .map((i) => exaSources[i])
        // Dedup by url in case the model returns the same index twice.
        .filter(
          (c, i, arr) => arr.findIndex((other) => other.url === c.url) === i,
        );

      await ctx.runMutation(internal.guideBranches._completeBranch, {
        branchId: args.branchId,
        answer: { title: output.title, body: output.body },
        citations: usedCitations,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("guideBranches:generation-failed", {
        branchId: args.branchId,
        err: message,
      });
      await ctx.runMutation(internal.guideBranches._failBranch, {
        branchId: args.branchId,
        error: message,
      });
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});
