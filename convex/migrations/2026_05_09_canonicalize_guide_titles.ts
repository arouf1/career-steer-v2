// One-shot: rename specific guides from acronym/short-form titles to their
// FULL canonical titles. Created to fix a small set of guides that were
// inserted with the user's raw query (e.g. "CPO", "VP Marketing") before
// the on-demand path canonicalised titles via the Tier-2 ladder lookup.
//
// Both `slug` and `titleNormalized` are updated together with `title` so
// the by_slug and by_title_normalized indexes resolve correctly. Any
// inbound link to the old slug will 404; acceptable here because these
// guides have no real traffic yet (created in dev only).
//
// Invoke once with no args:
//   npx convex run --no-push 'migrations/2026_05_09_canonicalize_guide_titles:canonicalize' '{}'
//
// Idempotent: skips a guide whose title already matches the canonical.

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { normalizeTitle, slugify } from "../lib/normalize";

type Rename = {
  oldSlug: string;
  canonicalTitle: string;
};

// Manually-curated list. Add new entries below if more acronym titles
// surface during catalog growth.
const RENAMES: Rename[] = [
  { oldSlug: "cpo", canonicalTitle: "Chief Product Officer" },
  { oldSlug: "vp-marketing", canonicalTitle: "Vice President of Marketing" },
];

export const canonicalize = internalMutation({
  args: {},
  returns: v.object({
    renamed: v.number(),
    skipped: v.number(),
    notFound: v.number(),
  }),
  handler: async (ctx) => {
    let renamed = 0;
    let skipped = 0;
    let notFound = 0;

    for (const r of RENAMES) {
      const guide = await ctx.db
        .query("career_guides")
        .withIndex("by_slug", (q) => q.eq("slug", r.oldSlug))
        .unique();
      if (!guide) {
        notFound++;
        continue;
      }
      if (guide.title === r.canonicalTitle) {
        skipped++;
        continue;
      }
      await ctx.db.patch(guide._id, {
        title: r.canonicalTitle,
        slug: slugify(r.canonicalTitle),
        titleNormalized: normalizeTitle(r.canonicalTitle),
        updatedAt: Date.now(),
      });
      renamed++;
    }

    return { renamed, skipped, notFound };
  },
});
