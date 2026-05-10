import { generateText, Output } from "ai";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { chatModel } from "../lib/ai/providers";
import { CONTENT_MODEL_ID } from "../lib/ai/prompts/career-guides";
import { exaAnswer, type Citation } from "../lib/server/exa";
import {
  buildCompanyResearchPrompt,
  buildCompanyRolePrompt,
  COMPANY_RESEARCH_SYSTEM_PROMPT,
  CompanyResearchSchema,
  CompanyRoleResearchSchema,
  type GroundedResearch,
} from "../lib/ai/prompts/companyResearch";

// 90-day refresh window. Long because the underlying signal (culture,
// financials, interview format) doesn't change weekly. Bounds OpenRouter
// + Exa spend per company.
const REFRESH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

const RUN_TIMEOUT_MS = 120_000;

const MAX_ATTEMPTS = 3;
const RETRY_COOLDOWN_MS = 30 * 60 * 1000;

// Concurrency cap for Exa fan-out. We only ever do 2 parallel calls per
// action so this is mostly a documented intent.
// const CONCURRENCY = 2; // implicit via Promise.all

// ── Public mutation: ensure research is queued ────────────────────────────
//
// Idempotent. Called from the public detail page on render. Spins both
// _researchCompany and _researchCompanyRole when their respective rows are
// missing or stale. The page renders best-available content and updates
// reactively as research lands.

export const ensureResearchQueued = mutation({
  args: {
    companyId: v.id("companies"),
    roleArchetypeSlug: v.union(v.string(), v.null()),
  },
  returns: v.object({
    companyResearchQueued: v.boolean(),
    companyRoleResearchQueued: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let companyResearchQueued = false;
    let companyRoleResearchQueued = false;

    // ── Company-level research ────────────────────────────────────────────
    const existingCompany = await ctx.db
      .query("company_research")
      .withIndex("by_companyId", (q) => q.eq("companyId", args.companyId))
      .first();
    const companyIsStale =
      !existingCompany ||
      existingCompany.status === "failed" ||
      (existingCompany.status === "complete" &&
        (existingCompany.lastResearchedAt ?? 0) < now - REFRESH_WINDOW_MS);
    const companyCanRetry =
      !existingCompany ||
      existingCompany.status !== "generating" ||
      // Bail-out: if a "generating" row is older than the run timeout, treat
      // it as crashed and let the cron-or-page retry it.
      (existingCompany.lastFailureAt ?? 0) < now - RUN_TIMEOUT_MS;
    if (companyIsStale && companyCanRetry) {
      let companyResearchId: Id<"company_research">;
      if (existingCompany) {
        await ctx.db.patch(existingCompany._id, { status: "generating" });
        companyResearchId = existingCompany._id;
      } else {
        companyResearchId = await ctx.db.insert("company_research", {
          companyId: args.companyId,
          status: "generating",
        });
      }
      await ctx.scheduler.runAfter(
        0,
        internal.companyResearch._researchCompany,
        { companyResearchId },
      );
      companyResearchQueued = true;
    }

    // ── Role-overlay research ─────────────────────────────────────────────
    if (args.roleArchetypeSlug) {
      const existingRole = await ctx.db
        .query("company_role_research")
        .withIndex("by_companyId_archetype", (q) =>
          q
            .eq("companyId", args.companyId)
            .eq("roleArchetypeSlug", args.roleArchetypeSlug as string),
        )
        .first();
      const roleIsStale =
        !existingRole ||
        existingRole.status === "failed" ||
        (existingRole.status === "complete" &&
          (existingRole.lastResearchedAt ?? 0) < now - REFRESH_WINDOW_MS);
      const roleCanRetry =
        !existingRole ||
        existingRole.status !== "generating" ||
        (existingRole.lastFailureAt ?? 0) < now - RUN_TIMEOUT_MS;
      if (roleIsStale && roleCanRetry) {
        let roleResearchId: Id<"company_role_research">;
        if (existingRole) {
          await ctx.db.patch(existingRole._id, { status: "generating" });
          roleResearchId = existingRole._id;
        } else {
          roleResearchId = await ctx.db.insert("company_role_research", {
            companyId: args.companyId,
            roleArchetypeSlug: args.roleArchetypeSlug,
            status: "generating",
          });
        }
        await ctx.scheduler.runAfter(
          0,
          internal.companyResearch._researchCompanyRole,
          { roleResearchId },
        );
        companyRoleResearchQueued = true;
      }
    }

    return { companyResearchQueued, companyRoleResearchQueued };
  },
});

// ── Status mutations ──────────────────────────────────────────────────────

export const _markCompanyResearchComplete = internalMutation({
  args: {
    companyResearchId: v.id("company_research"),
    culture: v.union(v.string(), v.null()),
    financials: v.union(v.string(), v.null()),
    citations: v.record(
      v.string(),
      v.array(
        v.object({
          url: v.string(),
          title: v.string(),
          publisher: v.optional(v.string()),
          fetchedAt: v.number(),
        }),
      ),
    ),
    costCents: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.companyResearchId, {
      status: "complete",
      culture: args.culture ?? undefined,
      financials: args.financials ?? undefined,
      citations: args.citations,
      costCents: args.costCents,
      lastResearchedAt: Date.now(),
      lastError: undefined,
      lastFailureAt: undefined,
    });
  },
});

export const _markCompanyResearchFailed = internalMutation({
  args: {
    companyResearchId: v.id("company_research"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.companyResearchId);
    await ctx.db.patch(args.companyResearchId, {
      status: "failed",
      attempts: (row?.attempts ?? 0) + 1,
      lastError: args.error.slice(0, 1000),
      lastFailureAt: Date.now(),
    });
  },
});

export const _markCompanyRoleResearchComplete = internalMutation({
  args: {
    roleResearchId: v.id("company_role_research"),
    interview: v.union(v.string(), v.null()),
    compensation: v.union(v.string(), v.null()),
    citations: v.record(
      v.string(),
      v.array(
        v.object({
          url: v.string(),
          title: v.string(),
          publisher: v.optional(v.string()),
          fetchedAt: v.number(),
        }),
      ),
    ),
    costCents: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.roleResearchId, {
      status: "complete",
      interview: args.interview ?? undefined,
      compensation: args.compensation ?? undefined,
      citations: args.citations,
      costCents: args.costCents,
      lastResearchedAt: Date.now(),
      lastError: undefined,
      lastFailureAt: undefined,
    });
  },
});

export const _markCompanyRoleResearchFailed = internalMutation({
  args: {
    roleResearchId: v.id("company_role_research"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.roleResearchId);
    await ctx.db.patch(args.roleResearchId, {
      status: "failed",
      attempts: (row?.attempts ?? 0) + 1,
      lastError: args.error.slice(0, 1000),
      lastFailureAt: Date.now(),
    });
  },
});

// ── Internal context loaders ──────────────────────────────────────────────

export const _loadCompanyResearchContext = internalQuery({
  args: { companyResearchId: v.id("company_research") },
  handler: async (ctx, args) => {
    const research = await ctx.db.get(args.companyResearchId);
    if (!research) return null;
    const company = await ctx.db.get(research.companyId);
    if (!company) return null;
    return {
      companyName: company.nameRaw,
      attempts: research.attempts ?? 0,
    };
  },
});

export const _loadCompanyRoleResearchContext = internalQuery({
  args: { roleResearchId: v.id("company_role_research") },
  handler: async (ctx, args) => {
    const research = await ctx.db.get(args.roleResearchId);
    if (!research) return null;
    const company = await ctx.db.get(research.companyId);
    if (!company) return null;
    return {
      companyName: company.nameRaw,
      roleArchetypeSlug: research.roleArchetypeSlug,
      attempts: research.attempts ?? 0,
    };
  },
});

// ── The actions ───────────────────────────────────────────────────────────

export const _researchCompany = internalAction({
  args: { companyResearchId: v.id("company_research") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ctxRow = await ctx.runQuery(
      internal.companyResearch._loadCompanyResearchContext,
      { companyResearchId: args.companyResearchId },
    );
    if (!ctxRow) return null;
    if (ctxRow.attempts >= MAX_ATTEMPTS) {
      console.warn("companyResearch._researchCompany:attempts-exhausted", {
        companyResearchId: args.companyResearchId,
      });
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    try {
      // Parallel Exa fan-out, culture + financials.
      const fields = ["culture", "financials"] as const;
      const queries = {
        culture: `What is the work culture and employee experience like at ${ctxRow.companyName}? Include what people who've worked there say.`,
        financials: `Summarise recent financial signals for ${ctxRow.companyName}: latest funding round, revenue, employee headcount, profitability, growth trajectory. Be specific where possible.`,
      };

      const exaByField = new Map<string, GroundedResearch>();
      let totalCostCents = 0;
      const exaResults = await Promise.all(
        fields.map(async (field) => {
          try {
            const res = await exaAnswer(queries[field], {
              signal: controller.signal,
            });
            return {
              field,
              ok: true as const,
              answer: res.answer,
              sources: res.citations,
              costCents: res.costCents,
            };
          } catch (err) {
            console.error("companyResearch._researchCompany:exa-failed", {
              companyResearchId: args.companyResearchId,
              field,
              err: err instanceof Error ? err.message : String(err),
            });
            return { field, ok: false as const };
          }
        }),
      );
      for (const r of exaResults) {
        if (r.ok) {
          exaByField.set(r.field, { answer: r.answer, sources: r.sources });
          totalCostCents += r.costCents;
        }
      }

      if (exaByField.size === 0) {
        throw new Error("All Exa research calls failed");
      }

      const { experimental_output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        experimental_output: Output.object({ schema: CompanyResearchSchema }),
        system: COMPANY_RESEARCH_SYSTEM_PROMPT,
        prompt: buildCompanyResearchPrompt({
          companyName: ctxRow.companyName,
          researchByField: {
            culture: exaByField.get("culture"),
            financials: exaByField.get("financials"),
          },
        }),
        abortSignal: controller.signal,
      });

      const citations = materializeCitations(exaByField, [
        ["culture", experimental_output.usedSources.culture],
        ["financials", experimental_output.usedSources.financials],
      ]);

      await ctx.runMutation(
        internal.companyResearch._markCompanyResearchComplete,
        {
          companyResearchId: args.companyResearchId,
          culture: experimental_output.culture,
          financials: experimental_output.financials,
          citations,
          costCents: totalCostCents,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("companyResearch._researchCompany:failed", {
        companyResearchId: args.companyResearchId,
        err: message,
      });
      await ctx.runMutation(
        internal.companyResearch._markCompanyResearchFailed,
        { companyResearchId: args.companyResearchId, error: message },
      );
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

export const _researchCompanyRole = internalAction({
  args: { roleResearchId: v.id("company_role_research") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ctxRow = await ctx.runQuery(
      internal.companyResearch._loadCompanyRoleResearchContext,
      { roleResearchId: args.roleResearchId },
    );
    if (!ctxRow) return null;
    if (ctxRow.attempts >= MAX_ATTEMPTS) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    // Convert slug back to prose for Exa queries.
    const roleTitle = ctxRow.roleArchetypeSlug.replace(/-+/g, " ");

    try {
      const fields = ["interview", "compensation"] as const;
      const queries = {
        interview: `Describe the interview process for ${roleTitle} roles at ${ctxRow.companyName}: format, number of rounds, what to expect. Use what candidates have shared publicly.`,
        compensation: `Summarise compensation for ${roleTitle} roles at ${ctxRow.companyName}: salary bands, equity, bonus, total compensation. Use levels.fyi, glassdoor, and similar sources.`,
      };

      const exaByField = new Map<string, GroundedResearch>();
      let totalCostCents = 0;
      const exaResults = await Promise.all(
        fields.map(async (field) => {
          try {
            const res = await exaAnswer(queries[field], {
              signal: controller.signal,
            });
            return {
              field,
              ok: true as const,
              answer: res.answer,
              sources: res.citations,
              costCents: res.costCents,
            };
          } catch (err) {
            console.error(
              "companyResearch._researchCompanyRole:exa-failed",
              {
                roleResearchId: args.roleResearchId,
                field,
                err: err instanceof Error ? err.message : String(err),
              },
            );
            return { field, ok: false as const };
          }
        }),
      );
      for (const r of exaResults) {
        if (r.ok) {
          exaByField.set(r.field, { answer: r.answer, sources: r.sources });
          totalCostCents += r.costCents;
        }
      }

      if (exaByField.size === 0) {
        throw new Error("All Exa research calls failed");
      }

      const { experimental_output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        experimental_output: Output.object({
          schema: CompanyRoleResearchSchema,
        }),
        system: COMPANY_RESEARCH_SYSTEM_PROMPT,
        prompt: buildCompanyRolePrompt({
          companyName: ctxRow.companyName,
          roleTitle,
          researchByField: {
            interview: exaByField.get("interview"),
            compensation: exaByField.get("compensation"),
          },
        }),
        abortSignal: controller.signal,
      });

      const citations = materializeCitations(exaByField, [
        ["interview", experimental_output.usedSources.interview],
        ["compensation", experimental_output.usedSources.compensation],
      ]);

      await ctx.runMutation(
        internal.companyResearch._markCompanyRoleResearchComplete,
        {
          roleResearchId: args.roleResearchId,
          interview: experimental_output.interview,
          compensation: experimental_output.compensation,
          citations,
          costCents: totalCostCents,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("companyResearch._researchCompanyRole:failed", {
        roleResearchId: args.roleResearchId,
        err: message,
      });
      await ctx.runMutation(
        internal.companyResearch._markCompanyRoleResearchFailed,
        { roleResearchId: args.roleResearchId, error: message },
      );
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────

// Map model-returned source-index lists back to Citation[] using the original
// Exa results. Skips invalid indexes so a hallucinated index never lands in
// the DB.
function materializeCitations(
  exaByField: Map<string, GroundedResearch>,
  pairs: ReadonlyArray<readonly [string, ReadonlyArray<number>]>,
): Record<string, Citation[]> {
  const out: Record<string, Citation[]> = {};
  for (const [fieldKey, indexes] of pairs) {
    const research = exaByField.get(fieldKey);
    if (!research || indexes.length === 0) continue;
    const cits: Citation[] = [];
    for (const i of indexes) {
      if (Number.isInteger(i) && i >= 0 && i < research.sources.length) {
        cits.push(research.sources[i]);
      }
    }
    if (cits.length > 0) out[fieldKey] = cits;
  }
  return out;
}
