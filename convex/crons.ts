import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { isCronAllowedDeployment, isProdDeployment } from "./lib/env";

const crons = cronJobs();

// Allow-list guard, see .claude/rules/deployment-previews.md.
// On any deployment whose CONVEX_CLOUD_URL is not the known prod or dev
// backend (i.e. preview backends, ad-hoc deployments), no crons get
// registered at all, _scheduled_functions stays empty, no spend possible.
if (isCronAllowedDeployment()) {
  crons.interval(
    "retry failed career guides",
    { minutes: 30 },
    internal.careerGuides._retryFailedGuides,
  );

  // Phase 4.3, discover snapshot retry sweep. Picks up `discover_canvases`
  // rows still in `status: "failed"` after 24h (and below the 3-attempt cap)
  // and schedules a regen via `scheduleSnapshotRegeneration`. 03:00 UTC sits
  // outside US/EU peak hours so retries are cheap; daily cadence keeps total
  // retry cost bounded by SNAPSHOT_MAX_ATTEMPTS per snapshot.
  crons.daily(
    "discover-failed-sweep",
    { hourUTC: 3, minuteUTC: 0 },
    internal.discover.sweepFailedSnapshots,
  );

  // Recovers career-guide podcasts that finished in `status: "failed"` or are
  // stuck mid-pipeline (`scripting`/`synthesizing` for >15 min). Hourly cadence
  // catches transient TTS / OpenRouter blips quickly; the action's smart
  // routing skips the script regen when a transcript is already saved, so most
  // recoveries cost only a TTS retry. Bounded by MAX_ATTEMPTS in podcasts.ts.
  crons.interval(
    "retry failed podcasts",
    { hours: 1 },
    internal.podcasts._retryFailedPodcasts,
  );

  // Autonomous catalog growth. Six-hourly cadence yields ~120 guides/month.
  // The orchestrator brainstorms candidate titles for the current industry
  // bucket (round-robin, 12-hour cycle), Exa-verifies legitimacy, and triggers
  // the existing generation pipeline through _requestGenerationForCron. One
  // new guide per tick at most; ticks with no surviving candidate are no-ops.
  crons.interval(
    "expand career guide catalog",
    { hours: 6 },
    internal.catalogExpansion.runExpansion,
  );

  // Sub-project 2 of the jobs feature. Drains job_postings rows stuck in
  // contentStatus: "pending" (missed a runAfter schedule) or "failed" (under
  // the 3-attempt cap and past cooldown). Same cadence as the career-guide
  // retry, 30 minutes balances "don't burn retry budget" against "transient
  // OpenRouter blips clear within an hour or two."
  crons.interval(
    "retry failed job-posting rewrites",
    { minutes: 30 },
    internal.jobPostingsContent._retryFailedContent,
  );

  // Sub-project 6 of the jobs feature.
  //
  // Google Indexing API drain. PROD-ONLY, we don't want dev URLs in
  // Google's index, and the 200/day quota is shared across deployments.
  // The queue caps each tick at 8 items (192/day, leaving 8/day headroom
  // under Google's 200/day publish quota). Hourly cadence keeps the queue
  // from sitting on URLs for too long while staying well inside the cap.
  // The enqueue mutation also no-ops on dev so the queue table stays empty.
  if (isProdDeployment()) {
    crons.interval(
      "drain google indexing queue",
      { hours: 1 },
      internal.googleIndexingQueue.drain,
    );
  }

  // Apply-link liveness sweep. Two-hourly cadence with a per-row 24h cooldown
  // means each posting gets one HEAD per day on average. Mirrors V1's
  // behaviour. Stage-2 Exa LLM verification is deferred to a follow-up.
  crons.interval(
    "sweep job-posting liveness",
    { hours: 2 },
    internal.jobsLifecycle.sweepLiveness,
  );

  // Staleness sweep. Once a day archives postings with lastSeenAt > 45d.
  // Captures listings that simply rolled off SearchAPI without us ever
  // seeing a hard 404. Off-peak hour for batch friendliness.
  crons.daily(
    "sweep stale job postings",
    { hourUTC: 4, minuteUTC: 30 },
    internal.jobsLifecycle.sweepStalePostings,
  );
}

export default crons;
