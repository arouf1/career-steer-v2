import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "retry failed career guides",
  { minutes: 30 },
  internal.careerGuides._retryFailedGuides,
);

export default crons;
