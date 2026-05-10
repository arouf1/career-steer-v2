import { generateText, Output } from "ai";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { chatModel } from "../lib/ai/providers";
import {
  buildRewritePrompt,
  JOB_REWRITE_MODEL_ID,
  JobPostingContentSchema,
  REWRITE_SYSTEM_PROMPT,
  type RewriteInput,
} from "../lib/ai/prompts/jobPostings";

// Sub-project 2 of the jobs feature. Drains job_postings rows from
// `contentStatus: "pending"` by rewriting the raw description into sectioned
// prose via Gemini 3.1 Pro. Triggered by jobPostings.upsertFromSearch via
// scheduler.runAfter, and by the _retryFailedContent cron for failed rows
// inside their attempt cap.

// Hard wall-clock cap on a single rewrite. Generous because Gemini 3.1 Pro
// can take up to 60s on long inputs and we want headroom for retries inside
// the SDK before the abort fires.
const RUN_TIMEOUT_MS = 120_000;

// Same retry shape as career-guides, three tries, then we stop and surface
// the failure on the row.
const CONTENT_MAX_ATTEMPTS = 3;
// Cooldown after a failure before the cron picks the row back up. Lets
// transient OpenRouter blips clear before we burn another attempt.
const CONTENT_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
const CONTENT_RETRY_BATCH_SIZE = 5;
// Stagger between retries inside one cron tick so we don't fan out 5
// simultaneous Pro-tier calls and ramp into rate-limit territory.
const CONTENT_RETRY_STAGGER_MS = 10_000;

// ── Status flips (mutations) ──────────────────────────────────────────────
//
// Mutations are split out so the action can stay focused on the LLM call.
// All three are internal: only this module's action and the retry cron call
// them. They also dual-write to job_postings_index so the lightweight mirror
// stays in sync as contentStatus moves through its lifecycle.

export const _beginContentGeneration = internalMutation({
  args: {
    jobPostingId: v.id("job_postings"),
    bypassAttemptCap: v.boolean(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; input: RewriteInput }
    | { ok: false; reason: "missing" | "complete" | "attempts-exhausted" }
  > => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) return { ok: false, reason: "missing" };
    if (posting.contentStatus === "complete") {
      return { ok: false, reason: "complete" };
    }
    if (
      !args.bypassAttemptCap &&
      (posting.contentAttempts ?? 0) >= CONTENT_MAX_ATTEMPTS
    ) {
      return { ok: false, reason: "attempts-exhausted" };
    }
    const company = await ctx.db.get(posting.companyId);
    if (!company) return { ok: false, reason: "missing" };

    await ctx.db.patch(args.jobPostingId, {
      contentStatus: "generating",
      contentAttempts: (posting.contentAttempts ?? 0) + 1,
    });
    await mirrorStatus(ctx, args.jobPostingId);

    return {
      ok: true,
      input: {
        title: posting.title,
        companyName: company.nameRaw,
        location: posting.location,
        city: posting.city,
        rawDescription: posting.rawDescription,
        salary: posting.detectedExtensions?.salary ?? null,
        schedule: posting.detectedExtensions?.schedule ?? null,
        postedAt: posting.detectedExtensions?.postedAt ?? null,
        workFromHome: posting.detectedExtensions?.workFromHome ?? null,
      },
    };
  },
});

export const _markContentComplete = internalMutation({
  args: {
    jobPostingId: v.id("job_postings"),
    content: v.object({
      overview: v.string(),
      theRole: v.string(),
      whatStandsOut: v.array(v.string()),
      idealCandidate: v.string(),
      compSummary: v.union(v.string(), v.null()),
      metaTitle: v.string(),
      metaDescription: v.string(),
      socialAlt: v.string(),
    }),
    costCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobPostingId, {
      content: args.content,
      contentStatus: "complete",
      contentLastError: undefined,
      contentLastFailureAt: undefined,
      ...(args.costCents !== undefined
        ? { contentCostCents: args.costCents }
        : {}),
    });
    await mirrorStatus(ctx, args.jobPostingId);

    // First time the row is meaningfully indexable, ping Google so the
    // crawler discovers the new URL. The queue handles rate-limiting under
    // Google's 200/day cap. This runs only once per posting because
    // contentStatus → "complete" is one-way (subsequent edits don't reset).
    const posting = await ctx.db.get(args.jobPostingId);
    if (posting && posting.isActive) {
      const company = await ctx.db.get(posting.companyId);
      if (company) {
        const url = canonicalJobUrl({
          citySlug: posting.citySlug,
          companySlug: company.slug,
          titleSlug: posting.titleSlug,
          jobPostingId: posting._id,
        });
        await ctx.runMutation(internal.googleIndexingQueue.enqueue, {
          url,
          kind: "URL_UPDATED",
        });
      }
    }

    // Embed the posting now that the rewritten content is available. We embed
    // POST-rewrite (not on raw description) so the four facet vectors carry
    // the same quality signal a profile/guide vector does. Best-effort -
    // failure here doesn't roll back the content commit; the backfill
    // action picks up rows missing embeddings.
    await ctx.scheduler.runAfter(
      0,
      internal.jobPostingEmbeddings.generate,
      { jobPostingId: args.jobPostingId },
    );
  },
});

export const _markContentFailed = internalMutation({
  args: {
    jobPostingId: v.id("job_postings"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobPostingId, {
      contentStatus: "failed",
      contentLastError: args.error.slice(0, 1000),
      contentLastFailureAt: Date.now(),
    });
    await mirrorStatus(ctx, args.jobPostingId);
  },
});

// ── The action ────────────────────────────────────────────────────────────

export const _rewriteContent = internalAction({
  args: {
    jobPostingId: v.id("job_postings"),
    bypassAttemptCap: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const begin = await ctx.runMutation(
      internal.jobPostingsContent._beginContentGeneration,
      {
        jobPostingId: args.jobPostingId,
        bypassAttemptCap: args.bypassAttemptCap ?? false,
      },
    );
    if (!begin.ok) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    try {
      const { experimental_output } = await generateText({
        model: chatModel(JOB_REWRITE_MODEL_ID, { zdr: true }),
        experimental_output: Output.object({ schema: JobPostingContentSchema }),
        system: REWRITE_SYSTEM_PROMPT,
        prompt: buildRewritePrompt(begin.input),
        abortSignal: controller.signal,
      });

      await ctx.runMutation(internal.jobPostingsContent._markContentComplete, {
        jobPostingId: args.jobPostingId,
        content: experimental_output,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("jobPostingsContent._rewriteContent:failed", {
        jobPostingId: args.jobPostingId,
        err: message,
      });
      await ctx.runMutation(internal.jobPostingsContent._markContentFailed, {
        jobPostingId: args.jobPostingId,
        error: message,
      });
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

// ── Retry cron internals ──────────────────────────────────────────────────

export const _listFailedPostingsForRetry = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - CONTENT_RETRY_COOLDOWN_MS;
    const rows = await ctx.db
      .query("job_postings")
      .withIndex("by_contentStatus_firstSeenAt", (q) =>
        q.eq("contentStatus", "failed"),
      )
      .take(50);
    return rows
      .filter((r) => (r.contentAttempts ?? 0) < CONTENT_MAX_ATTEMPTS)
      .filter((r) => (r.contentLastFailureAt ?? 0) < cutoff)
      .slice(0, CONTENT_RETRY_BATCH_SIZE);
  },
});

// Also picks up rows that were inserted but never started, schedules them
// to drain. Useful when an upsertFromSearch ran while convex/jobPostings was
// being deployed and the runAfter call landed on a stale function ref.
export const _listStuckPendingPostings = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Pending rows older than 5 minutes, the runAfter(0) should have drained
    // them by now. Anything stuck this long is a missed schedule, not work
    // in flight.
    const cutoff = Date.now() - 5 * 60 * 1000;
    const rows = await ctx.db
      .query("job_postings")
      .withIndex("by_contentStatus_firstSeenAt", (q) =>
        q.eq("contentStatus", "pending").lt("firstSeenAt", cutoff),
      )
      .take(CONTENT_RETRY_BATCH_SIZE);
    return rows;
  },
});

export const _retryFailedContent = internalAction({
  args: {},
  returns: v.object({
    failedScanned: v.number(),
    pendingScanned: v.number(),
    scheduled: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    failedScanned: number;
    pendingScanned: number;
    scheduled: number;
  }> => {
    const failed = await ctx.runQuery(
      internal.jobPostingsContent._listFailedPostingsForRetry,
      {},
    );
    const stuck = await ctx.runQuery(
      internal.jobPostingsContent._listStuckPendingPostings,
      {},
    );
    let scheduled = 0;
    const all = [...failed, ...stuck];
    for (const row of all) {
      const delay = scheduled * CONTENT_RETRY_STAGGER_MS;
      await ctx.scheduler.runAfter(
        delay,
        internal.jobPostingsContent._rewriteContent,
        { jobPostingId: row._id, bypassAttemptCap: false },
      );
      scheduled++;
    }
    return {
      failedScanned: failed.length,
      pendingScanned: stuck.length,
      scheduled,
    };
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────

// Build the canonical /jobs/listing/... URL for a posting. SITE_URL is read
// from the Convex env; defaults to production for safety. The path shape
// must stay in lockstep with app/jobs/listing/[city]/[company]/[title]/[id].
function canonicalJobUrl(parts: {
  citySlug: string;
  companySlug: string;
  titleSlug: string;
  jobPostingId: Id<"job_postings">;
}): string {
  const base = process.env.SITE_URL ?? "https://career-steer.app";
  return `${base}/jobs/listing/${parts.citySlug}/${parts.companySlug}/${parts.titleSlug}/${parts.jobPostingId}`;
}

async function mirrorStatus(
  ctx: { db: any },
  jobPostingId: Id<"job_postings">,
): Promise<void> {
  const posting = await ctx.db.get(jobPostingId);
  if (!posting) return;
  const mirror = await ctx.db
    .query("job_postings_index")
    .withIndex("by_jobPostingId", (q: any) =>
      q.eq("jobPostingId", jobPostingId),
    )
    .first();
  if (!mirror) return;
  if (mirror.contentStatus !== posting.contentStatus) {
    await ctx.db.patch(mirror._id, { contentStatus: posting.contentStatus });
  }
}
