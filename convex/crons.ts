import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { isCronAllowedDeployment } from "./lib/env";

const crons = cronJobs();

// Allow-list guard — see .claude/rules/deployment-previews.md.
// On any deployment whose CONVEX_CLOUD_URL is not the known prod or dev
// backend (i.e. preview backends, ad-hoc deployments), no crons get
// registered at all — _scheduled_functions stays empty, no spend possible.
if (isCronAllowedDeployment()) {
  crons.interval(
    "retry failed career guides",
    { minutes: 30 },
    internal.careerGuides._retryFailedGuides,
  );

  // Phase 4.3 — discover snapshot retry sweep. Picks up `discover_canvases`
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

  // Autonomous catalog growth. Hourly cadence yields ~720 guides/month. The
  // orchestrator brainstorms candidate titles for the current industry bucket
  // (round-robin, 12-hour cycle), Exa-verifies legitimacy, and triggers the
  // existing generation pipeline through _requestGenerationForCron. One new
  // guide per tick at most; ticks with no surviving candidate are no-ops.
  crons.interval(
    "expand career guide catalog",
    { hours: 1 },
    internal.catalogExpansion.runExpansion,
  );
}

export default crons;
