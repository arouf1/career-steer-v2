import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

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

export default crons;
