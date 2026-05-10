// One-shot cleanup of two backfill / generation problems:
//
// 1. Structural Engineer was placed on the Software Engineering ladder by
//    the backfill LLM classifier, the word "engineer" overlapped. It's
//    a chartered civil engineering profession, not software. Removes the
//    bad ladder position; the guide stays in the catalogue but lands in
//    the "Other paths" orphan section until a Civil Engineering ladder
//    is added (out of scope for this fix).
//
// 2. Executive Director was generated as a fully-orphaned generic guide
//    via the on-demand pipeline before the validation prompt was
//    tightened to reject bare leadership titles. The content describes
//    a non-profit director but the title is too generic to be useful.
//    Hard-deletes the guide and every dependent row.
//
// Invoke with no args:
//   npx convex run --no-push 'migrations/2026_05_10_cleanup_misclassified_guides:cleanup' '{}'

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

export const cleanup = internalMutation({
  args: {},
  returns: v.object({
    structuralEngineerPositionRemoved: v.boolean(),
    executiveDirectorDeleted: v.boolean(),
    executiveDirectorRelatedDeleted: v.object({
      positions: v.number(),
      embeddings: v.number(),
      branches: v.number(),
      personalizations: v.number(),
      review: v.number(),
      matchReasons: v.number(),
      snapshotJunctions: v.number(),
      reactions: v.number(),
    }),
  }),
  handler: async (ctx) => {
    let structuralEngineerPositionRemoved = false;
    const ed = {
      positions: 0,
      embeddings: 0,
      branches: 0,
      personalizations: 0,
      review: 0,
      matchReasons: 0,
      snapshotJunctions: 0,
      reactions: 0,
    };

    // ── 1. Orphan Structural Engineer from Software Engineering ──────────
    const seGuide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", "structural-engineer"))
      .unique();
    const swLadder = await ctx.db
      .query("career_ladders")
      .withIndex("by_slug", (q) => q.eq("slug", "software-engineering"))
      .unique();
    if (seGuide && swLadder) {
      const positions = await ctx.db
        .query("career_guide_ladder_positions")
        .withIndex("by_guide", (q) => q.eq("guideId", seGuide._id))
        .collect();
      for (const pos of positions) {
        if (pos.ladderId === swLadder._id) {
          await ctx.db.delete(pos._id);
          structuralEngineerPositionRemoved = true;
        }
      }
    }

    // ── 2. Hard-delete Executive Director + all dependent rows ───────────
    const edGuide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", "executive-director"))
      .unique();

    if (edGuide) {
      // ladder positions
      const edPositions = await ctx.db
        .query("career_guide_ladder_positions")
        .withIndex("by_guide", (q) => q.eq("guideId", edGuide._id))
        .collect();
      for (const p of edPositions) await ctx.db.delete(p._id);
      ed.positions = edPositions.length;

      // ladder review queue
      const edReview = await ctx.db
        .query("career_guide_ladder_review")
        .withIndex("by_guide", (q) => q.eq("guideId", edGuide._id))
        .collect();
      for (const r of edReview) await ctx.db.delete(r._id);
      ed.review = edReview.length;

      // embeddings
      const edEmbeddings = await ctx.db
        .query("career_guide_embeddings")
        .withIndex("by_guideId", (q) => q.eq("guideId", edGuide._id))
        .collect();
      for (const e of edEmbeddings) await ctx.db.delete(e._id);
      ed.embeddings = edEmbeddings.length;

      // Go Deeper branches, by_guide_status_created is the only
      // guide-keyed index and works as a guide-only prefix scan.
      const edBranches = await ctx.db
        .query("career_guide_branches")
        .withIndex("by_guide_status_created", (q) =>
          q.eq("guideId", edGuide._id),
        )
        .collect();
      for (const b of edBranches) await ctx.db.delete(b._id);
      ed.branches = edBranches.length;

      // personalizations, no by_guide index; scan + filter. The dev
      // catalogue is small enough that a one-shot full scan is fine.
      const allPersonalizations = await ctx.db
        .query("career_guide_personalizations")
        .collect();
      for (const p of allPersonalizations) {
        if (p.guideId === edGuide._id) {
          await ctx.db.delete(p._id);
          ed.personalizations++;
        }
      }

      // discover match reasons (per-user "why this fit" cache)
      const edReasons = await ctx.db
        .query("discover_match_reasons")
        .withIndex("by_user_and_guide")
        .collect();
      for (const r of edReasons) {
        if (r.guideId === edGuide._id) {
          await ctx.db.delete(r._id);
          ed.matchReasons++;
        }
      }

      // discover_snapshot_guides junction rows (snapshot → guide refs)
      const edSnapshotRefs = await ctx.db
        .query("discover_snapshot_guides")
        .withIndex("by_guideId", (q) => q.eq("guideId", edGuide._id))
        .collect();
      for (const ref of edSnapshotRefs) await ctx.db.delete(ref._id);
      ed.snapshotJunctions = edSnapshotRefs.length;

      // discover_reactions (saved/dismissed by users)
      const edReactions = await ctx.db
        .query("discover_reactions")
        .withIndex("by_user_and_guide")
        .collect();
      for (const r of edReactions) {
        if (r.guideId === edGuide._id) {
          await ctx.db.delete(r._id);
          ed.reactions++;
        }
      }

      await ctx.db.delete(edGuide._id);
    }

    return {
      structuralEngineerPositionRemoved,
      executiveDirectorDeleted: edGuide !== null,
      executiveDirectorRelatedDeleted: ed,
    };
  },
});
