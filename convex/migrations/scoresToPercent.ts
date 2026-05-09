// One-shot backfill: convert mock-interview scores from 1-5 to 0-100.
//
// Multiply oldScore by 20, capped at 100. Defensive: any value already > 5
// is left alone so the mutation is idempotent and safe to run multiple
// times. Touches voice_calls rows where surface === "interview_job" and
// aiSummary.overallScore is a number.

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

function toPercent(n: number): number {
  if (n > 5) return Math.round(n); // already on the new scale
  return Math.min(100, Math.round(n * 20));
}

export const scoresToPercent = internalMutation({
  args: {},
  returns: v.object({
    scanned: v.number(),
    converted: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    let scanned = 0;
    let converted = 0;
    let skipped = 0;

    // No index by surface; scan voice_calls and filter in code. Volume is
    // bounded (MVP, handfuls of rows). If this surface ever scales to
    // hundreds of thousands, add a by_surface index.
    for await (const row of ctx.db.query("voice_calls")) {
      if (row.surface !== "interview_job") continue;
      scanned += 1;

      const summary = row.aiSummary as
        | {
            overallScore?: number;
            dimensions?: Array<{ score?: number | null; [k: string]: unknown }>;
            [k: string]: unknown;
          }
        | undefined;
      if (!summary || typeof summary.overallScore !== "number") {
        skipped += 1;
        continue;
      }

      const newOverall = toPercent(summary.overallScore);
      const newDimensions = Array.isArray(summary.dimensions)
        ? summary.dimensions.map((d) => ({
            ...d,
            score:
              typeof d.score === "number" ? toPercent(d.score) : d.score ?? null,
          }))
        : summary.dimensions;

      // No-op if already converted (overall and every dim score unchanged)
      const dimsUnchanged =
        !Array.isArray(summary.dimensions) ||
        summary.dimensions.every(
          (d, i) =>
            d.score ===
            (Array.isArray(newDimensions) ? newDimensions[i].score : d.score),
        );
      if (newOverall === summary.overallScore && dimsUnchanged) {
        skipped += 1;
        continue;
      }

      await ctx.db.patch(row._id, {
        aiSummary: {
          ...summary,
          overallScore: newOverall,
          dimensions: newDimensions,
        },
        updatedAt: Date.now(),
      });
      converted += 1;
    }

    console.log(
      `[scoresToPercent] scanned=${scanned} converted=${converted} skipped=${skipped}`,
    );
    return { scanned, converted, skipped };
  },
});
