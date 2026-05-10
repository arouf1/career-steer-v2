// Reusable migration: removes specific (guideSlug, ladderSlug) ladder
// placements where the LLM backfill classifier misjudged the fit. Each
// orphaned guide stays in the catalogue and falls into the "Other paths"
// section on the listing page until either a more specific ladder is
// added or a corrected placement is written.
//
// Add a new entry to ORPHANS below to reclassify another guide. Idempotent
// — re-running skips guides whose position has already been removed.
//
// Invoke with no args:
//   npx convex run --no-push 'migrations/2026_05_10_orphan_misclassified_guides:orphan' '{}'

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

type Orphan = {
  guideSlug: string;
  ladderSlug: string;
  reason: string;
};

const ORPHANS: Orphan[] = [
  {
    guideSlug: "grant-writer",
    ladderSlug: "creative",
    reason:
      "Grant writing is nonprofit fundraising / development work, not creative-services. The day-to-day is research, budget construction, compliance reporting, and proposal project management, not the copywriting / art direction lane the Creative ladder is built around.",
  },
];

export const orphan = internalMutation({
  args: {},
  returns: v.object({
    removed: v.number(),
    skipped: v.number(),
    notFound: v.number(),
    details: v.array(
      v.object({
        guideSlug: v.string(),
        ladderSlug: v.string(),
        outcome: v.union(
          v.literal("removed"),
          v.literal("skipped"),
          v.literal("guide-not-found"),
          v.literal("ladder-not-found"),
          v.literal("position-not-found"),
        ),
      }),
    ),
  }),
  handler: async (ctx) => {
    let removed = 0;
    let skipped = 0;
    let notFound = 0;
    const details: {
      guideSlug: string;
      ladderSlug: string;
      outcome:
        | "removed"
        | "skipped"
        | "guide-not-found"
        | "ladder-not-found"
        | "position-not-found";
    }[] = [];

    for (const o of ORPHANS) {
      const guide = await ctx.db
        .query("career_guides")
        .withIndex("by_slug", (q) => q.eq("slug", o.guideSlug))
        .unique();
      if (!guide) {
        notFound++;
        details.push({
          guideSlug: o.guideSlug,
          ladderSlug: o.ladderSlug,
          outcome: "guide-not-found",
        });
        continue;
      }

      const ladder = await ctx.db
        .query("career_ladders")
        .withIndex("by_slug", (q) => q.eq("slug", o.ladderSlug))
        .unique();
      if (!ladder) {
        notFound++;
        details.push({
          guideSlug: o.guideSlug,
          ladderSlug: o.ladderSlug,
          outcome: "ladder-not-found",
        });
        continue;
      }

      const positions = await ctx.db
        .query("career_guide_ladder_positions")
        .withIndex("by_guide", (q) => q.eq("guideId", guide._id))
        .collect();
      const targetPosition = positions.find(
        (p) => p.ladderId === ladder._id,
      );
      if (!targetPosition) {
        skipped++;
        details.push({
          guideSlug: o.guideSlug,
          ladderSlug: o.ladderSlug,
          outcome: "position-not-found",
        });
        continue;
      }

      await ctx.db.delete(targetPosition._id);
      removed++;
      details.push({
        guideSlug: o.guideSlug,
        ladderSlug: o.ladderSlug,
        outcome: "removed",
      });
    }

    return { removed, skipped, notFound, details };
  },
});
