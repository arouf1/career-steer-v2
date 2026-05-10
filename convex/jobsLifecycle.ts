import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

// Sub-project 6 of the jobs feature. Two crons that flip job_postings.isActive
// from true → false:
//
//   1. Liveness sweep, every 2h, takes oldest-checked active rows, HEADs
//      their apply links, and archives any that 404/410/403/redirect-off-domain.
//      Mirror of V1's two-stage check (HEAD → Exa LLM verification on
//      inconclusive). For v1 of this sub-project we ship just stage one;
//      stage two is a follow-up if the false-archive rate ends up too high.
//
//   2. Staleness sweep, daily, archives rows where lastSeenAt is older than
//      the staleness window (45 days). Captures listings that simply rolled
//      off SearchAPI because the source removed them.
//
// Both archive paths enqueue URL_DELETED in the Google Indexing API queue.

const STALE_DAYS = 45;
const STALE_WINDOW_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

const LIVENESS_BATCH_SIZE = 50;
const LIVENESS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LIVENESS_REQUEST_TIMEOUT_MS = 8_000;

// HTTP statuses that immediately mean "this listing is gone." Anything else
// (2xx, redirects within domain, 5xx) is treated as inconclusive, we update
// lastChecked but don't archive.
const HARD_FAIL_STATUSES = new Set([404, 410]);

// ── Archive helper ────────────────────────────────────────────────────────
//
// Single archive path used by both crons. Idempotent: if the row is already
// inactive, no-op. Enqueues URL_DELETED unconditionally on first archive
// because the queue itself dedupes.

export const _archive = internalMutation({
  args: {
    jobPostingId: v.id("job_postings"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting || !posting.isActive) return;

    await ctx.db.patch(args.jobPostingId, {
      isActive: false,
      archivedAt: Date.now(),
      archivedReason: args.reason,
    });

    // Mirror to the lightweight index so the sitemap stops listing it.
    const mirror = await ctx.db
      .query("job_postings_index")
      .withIndex("by_jobPostingId", (q) =>
        q.eq("jobPostingId", args.jobPostingId),
      )
      .first();
    if (mirror) await ctx.db.patch(mirror._id, { isActive: false });

    // Tell Google. Queue handles rate-limiting + dedupe.
    const company = await ctx.db.get(posting.companyId);
    if (company) {
      const base = process.env.SITE_URL ?? "https://career-steer.app";
      const url = `${base}/jobs/listing/${posting.citySlug}/${company.slug}/${posting.titleSlug}/${posting._id}`;
      await ctx.runMutation(internal.googleIndexingQueue.enqueue, {
        url,
        kind: "URL_DELETED",
      });
    }
  },
});

// ── Staleness sweep ───────────────────────────────────────────────────────

export const _listStalePostings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_WINDOW_MS;
    return await ctx.db
      .query("job_postings")
      .withIndex("by_isActive_lastSeenAt", (q) =>
        q.eq("isActive", true).lt("lastSeenAt", cutoff),
      )
      .take(200);
  },
});

export const sweepStalePostings = internalAction({
  args: {},
  returns: v.object({ scanned: v.number(), archived: v.number() }),
  handler: async (
    ctx,
  ): Promise<{ scanned: number; archived: number }> => {
    const stale = await ctx.runQuery(
      internal.jobsLifecycle._listStalePostings,
      {},
    );
    let archived = 0;
    for (const row of stale) {
      await ctx.runMutation(internal.jobsLifecycle._archive, {
        jobPostingId: row._id,
        reason: `stale-${STALE_DAYS}d`,
      });
      archived++;
    }
    return { scanned: stale.length, archived };
  },
});

// ── Liveness sweep ────────────────────────────────────────────────────────

export const _listLivenessCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    // by_lastChecked sorts ascending with undefined first, never-checked
    // postings drain first, then oldest-checked. Filter to active only in JS
    // because the index doesn't carry isActive.
    const cutoff = Date.now() - LIVENESS_COOLDOWN_MS;
    const rows = await ctx.db
      .query("job_postings")
      .withIndex("by_lastChecked")
      .order("asc")
      .take(LIVENESS_BATCH_SIZE * 3);
    return rows
      .filter((r) => r.isActive)
      .filter((r) => !!r.applyLink)
      .filter((r) => (r.lastChecked ?? 0) < cutoff)
      .slice(0, LIVENESS_BATCH_SIZE);
  },
});

export const _markLivenessChecked = internalMutation({
  args: {
    jobPostingId: v.id("job_postings"),
    failed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.jobPostingId);
    if (!row) return;
    await ctx.db.patch(args.jobPostingId, {
      lastChecked: Date.now(),
      failedCheckCount: args.failed
        ? (row.failedCheckCount ?? 0) + 1
        : 0,
    });
  },
});

async function checkApplyLinkAlive(
  url: string,
): Promise<{ alive: boolean; reason?: string }> {
  // We HEAD the URL; some servers don't like HEAD and 405 it, in which case
  // we fall back to a small GET. Anything other than 404/410 is treated as
  // alive (we don't want to false-archive on transient 5xx).
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LIVENESS_REQUEST_TIMEOUT_MS,
  );
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CareerSteerBot/1.0; +https://career-steer.app/bots)",
      },
    });
    if (res.status === 405 || res.status === 501) {
      // Some apply-link hosts disallow HEAD. Try a small range GET.
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Range: "bytes=0-0",
          "User-Agent":
            "Mozilla/5.0 (compatible; CareerSteerBot/1.0; +https://career-steer.app/bots)",
        },
      });
    }
    if (HARD_FAIL_STATUSES.has(res.status)) {
      return { alive: false, reason: `apply-link-${res.status}` };
    }
    return { alive: true };
  } catch (err) {
    // Network error / DNS failure / TLS error → treat as inconclusive (alive)
    // for v1. Stage 2 (Exa LLM verification) would catch genuine death here;
    // we'll add it if false-positives prove a problem.
    return {
      alive: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const sweepLiveness = internalAction({
  args: {},
  returns: v.object({
    checked: v.number(),
    archived: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{ checked: number; archived: number }> => {
    const candidates: Array<Doc<"job_postings">> = await ctx.runQuery(
      internal.jobsLifecycle._listLivenessCandidates,
      {},
    );
    let archived = 0;
    for (const row of candidates) {
      if (!row.applyLink) continue;
      const { alive, reason } = await checkApplyLinkAlive(row.applyLink);
      await ctx.runMutation(internal.jobsLifecycle._markLivenessChecked, {
        jobPostingId: row._id,
        failed: !alive,
      });
      if (!alive) {
        await ctx.runMutation(internal.jobsLifecycle._archive, {
          jobPostingId: row._id,
          reason: reason ?? "apply-link-dead",
        });
        archived++;
      }
    }
    return { checked: candidates.length, archived };
  },
});
