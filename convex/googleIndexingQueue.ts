import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  IndexingApiNotConfiguredError,
  notifyGoogle,
} from "../lib/server/googleIndexingApi";
import { isProdDeployment } from "./lib/env";

// Google's Indexing API caps at 200 publish requests per project per day.
// We drain at 8 items per hourly cron tick (192/day) which leaves 8/day
// headroom for ad-hoc operations done outside the queue. Items above the
// daily quota stay queued and drain the next morning.
const DRAIN_BATCH_SIZE = 8;

// Max retries per item before we give up. Most failures are auth (service
// account misconfigured) — those won't recover on retry, so a low cap
// prevents the queue from filling with zombie rows.
const MAX_ATTEMPTS = 3;

// Cooldown after a failure before the cron picks the row up again.
const RETRY_COOLDOWN_MS = 60 * 60 * 1000;

// ── Enqueue ────────────────────────────────────────────────────────────────
//
// Called from convex/jobPostingsContent.ts (URL_UPDATED on first publish) and
// from the liveness/staleness crons (URL_DELETED on archive). Idempotent —
// drops duplicate pending entries for the same (url, kind) so a row that
// flips active→inactive→active doesn't pile up.

export const enqueue = internalMutation({
  args: {
    url: v.string(),
    kind: v.union(v.literal("URL_UPDATED"), v.literal("URL_DELETED")),
  },
  handler: async (ctx, args) => {
    // Prod-only. Dev deployments would point Google at staging URLs that
    // don't render in our public frontend, polluting both the index and the
    // 200/day quota we share across deployments.
    if (!isProdDeployment()) return;
    const existing = await ctx.db
      .query("google_indexing_queue")
      .withIndex("by_url_kind_status", (q) =>
        q.eq("url", args.url).eq("kind", args.kind).eq("status", "pending"),
      )
      .first();
    if (existing) return; // already queued
    await ctx.db.insert("google_indexing_queue", {
      url: args.url,
      kind: args.kind,
      status: "pending",
      queuedAt: Date.now(),
    });
  },
});

// ── Drain (cron) ───────────────────────────────────────────────────────────

export const _drainBatch = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Pending first.
    const pending = await ctx.db
      .query("google_indexing_queue")
      .withIndex("by_status_queuedAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(DRAIN_BATCH_SIZE);
    if (pending.length >= DRAIN_BATCH_SIZE) return pending;
    // Top up with retry-eligible failed items.
    const remaining = DRAIN_BATCH_SIZE - pending.length;
    const failed = await ctx.db
      .query("google_indexing_queue")
      .withIndex("by_status_queuedAt", (q) => q.eq("status", "failed"))
      .order("asc")
      .take(remaining * 3); // overscan; filter cooldown + attempts in JS
    const retryable = failed
      .filter((r) => (r.attempts ?? 0) < MAX_ATTEMPTS)
      .filter((r) => (r.queuedAt ?? 0) < now - RETRY_COOLDOWN_MS)
      .slice(0, remaining);
    return [...pending, ...retryable];
  },
});

export const _markSent = internalMutation({
  args: { id: v.id("google_indexing_queue") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "sent",
      sentAt: Date.now(),
      lastError: undefined,
    });
  },
});

export const _markFailed = internalMutation({
  args: { id: v.id("google_indexing_queue"), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    await ctx.db.patch(args.id, {
      status: "failed",
      attempts: (row.attempts ?? 0) + 1,
      lastError: args.error.slice(0, 500),
    });
  },
});

export const drain = internalAction({
  args: {},
  returns: v.object({
    attempted: v.number(),
    sent: v.number(),
    failed: v.number(),
    skippedUnconfigured: v.boolean(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    attempted: number;
    sent: number;
    failed: number;
    skippedUnconfigured: boolean;
  }> => {
    const batch = await ctx.runQuery(
      internal.googleIndexingQueue._drainBatch,
      {},
    );
    if (batch.length === 0) {
      return { attempted: 0, sent: 0, failed: 0, skippedUnconfigured: false };
    }

    let sent = 0;
    let failed = 0;
    let skippedUnconfigured = false;

    for (const row of batch) {
      try {
        await notifyGoogle(row.url, row.kind);
        await ctx.runMutation(internal.googleIndexingQueue._markSent, {
          id: row._id,
        });
        sent++;
      } catch (err) {
        if (err instanceof IndexingApiNotConfiguredError) {
          // Don't burn attempts on every item just because the env isn't
          // wired yet — fail this row and bail the batch. Once the env is
          // set, the cron picks them up after RETRY_COOLDOWN_MS.
          await ctx.runMutation(internal.googleIndexingQueue._markFailed, {
            id: row._id,
            error: err.message,
          });
          skippedUnconfigured = true;
          failed++;
          break;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error("googleIndexingQueue.drain:item-failed", {
          id: row._id,
          url: row.url,
          kind: row.kind,
          err: message,
        });
        await ctx.runMutation(internal.googleIndexingQueue._markFailed, {
          id: row._id,
          error: message,
        });
        failed++;
      }
    }

    return { attempted: batch.length, sent, failed, skippedUnconfigured };
  },
});
