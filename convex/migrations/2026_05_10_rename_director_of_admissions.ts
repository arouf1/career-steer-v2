// One-shot rename: the catalog-expansion judge described correcting
// "Director of Admissions" to "Admissions Director" in its reasoning but
// shipped the original candidate in canonicalTitle (the bug fixed in this
// same change). The published guide ended up at /director-of-admissions.
// This migration renames it in place so the slug + title match the
// canonical industry term going forward. _id stays stable, so embeddings,
// snapshot junctions, and other FK'd rows survive unchanged.
//
// The next.config.ts redirect pairs with this rename, anyone landing on
// the old slug (email links, indexed URLs) gets a 301 to the new slug.
//
// Invoke with no args:
//   npx convex run --no-push 'migrations/2026_05_10_rename_director_of_admissions:rename' '{}'

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { normalizeTitle } from "../lib/normalize";

const OLD_SLUG = "director-of-admissions";
const NEW_TITLE = "Admissions Director";
const NEW_SLUG = "admissions-director";

export const rename = internalMutation({
  args: {},
  returns: v.union(
    v.object({
      status: v.literal("renamed"),
      guideId: v.id("career_guides"),
      reembedScheduled: v.boolean(),
    }),
    v.object({
      status: v.literal("not_found"),
    }),
    v.object({
      status: v.literal("collision"),
      collidingGuideId: v.id("career_guides"),
      collidingSlug: v.string(),
      collidingTitle: v.string(),
    }),
    v.object({
      status: v.literal("already_renamed"),
      guideId: v.id("career_guides"),
    }),
  ),
  handler: async (ctx) => {
    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", OLD_SLUG))
      .unique();

    if (!guide) {
      const already = await ctx.db
        .query("career_guides")
        .withIndex("by_slug", (q) => q.eq("slug", NEW_SLUG))
        .unique();
      if (already) {
        return { status: "already_renamed" as const, guideId: already._id };
      }
      return { status: "not_found" as const };
    }

    const newTitleNormalized = normalizeTitle(NEW_TITLE);
    const collidingBySlug = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", NEW_SLUG))
      .unique();
    if (collidingBySlug) {
      return {
        status: "collision" as const,
        collidingGuideId: collidingBySlug._id,
        collidingSlug: collidingBySlug.slug,
        collidingTitle: collidingBySlug.title,
      };
    }
    const collidingByTitle = await ctx.db
      .query("career_guides")
      .withIndex("by_title_normalized", (q) =>
        q.eq("titleNormalized", newTitleNormalized),
      )
      .unique();
    if (collidingByTitle && collidingByTitle._id !== guide._id) {
      return {
        status: "collision" as const,
        collidingGuideId: collidingByTitle._id,
        collidingSlug: collidingByTitle.slug,
        collidingTitle: collidingByTitle.title,
      };
    }

    await ctx.db.patch(guide._id, {
      title: NEW_TITLE,
      slug: NEW_SLUG,
      titleNormalized: newTitleNormalized,
      updatedAt: Date.now(),
    });

    // Title is part of the embedding input (see lib/ai/prompts/guide-
    // embedding-text.ts), so a title change requires a re-embed. The
    // upsert hook in guideEmbeddings.upsert fans out to discover_canvas
    // refresh automatically.
    let reembedScheduled = false;
    if (guide.contentStatus === "complete" && guide.content) {
      await ctx.scheduler.runAfter(0, internal.guideEmbeddings.generate, {
        guideId: guide._id,
      });
      reembedScheduled = true;
    }

    return {
      status: "renamed" as const,
      guideId: guide._id,
      reembedScheduled,
    };
  },
});
