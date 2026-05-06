import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Resolve the current Clerk identity to our internal users row. Throws on
// missing identity / missing user row so callers can rely on a non-null
// return — these are the same auth gates used across the app.
async function requireUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) throw new ConvexError("No user row for current identity");
  return user._id;
}

// Save a posting. Idempotent — a second save returns the existing row instead
// of creating a duplicate. Note is optional (V1's saved-jobs flow never used
// it; we expose it now so a future "Why I saved this" affordance has somewhere
// to write without another migration).
export const save = mutation({
  args: {
    jobPostingId: v.id("job_postings"),
    note: v.optional(v.string()),
  },
  returns: v.object({ id: v.id("saved_jobs"), alreadySaved: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const existing = await ctx.db
      .query("saved_jobs")
      .withIndex("by_userId_jobPostingId", (q) =>
        q.eq("userId", userId).eq("jobPostingId", args.jobPostingId),
      )
      .unique();
    if (existing) return { id: existing._id, alreadySaved: true };

    // Hard guard: don't accept saves for postings that don't exist. Stale
    // jobPostingId values can show up if the client carries old results
    // through a deploy that pruned the cache.
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) throw new ConvexError("Job posting not found");

    const id = await ctx.db.insert("saved_jobs", {
      userId,
      jobPostingId: args.jobPostingId,
      savedAt: Date.now(),
      note: args.note,
    });
    return { id, alreadySaved: false };
  },
});

export const unsave = mutation({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const existing = await ctx.db
      .query("saved_jobs")
      .withIndex("by_userId_jobPostingId", (q) =>
        q.eq("userId", userId).eq("jobPostingId", args.jobPostingId),
      )
      .unique();
    if (!existing) return { removed: false };
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});

// Returns the set of jobPostingIds the current user has saved. Used by the
// search results renderer to colour the bookmark icon. Reactive — the page
// re-renders the moment the user saves or unsaves anything.
export const mySavedSet = query({
  args: {},
  returns: v.array(v.id("job_postings")),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return [];

    const rows = await ctx.db
      .query("saved_jobs")
      .withIndex("by_userId_savedAt", (q) => q.eq("userId", user._id))
      .collect();
    return rows.map((r) => r.jobPostingId);
  },
});

// Listing for a future /workspace/saved-jobs page. Joins the posting +
// company so the row can render without a second round-trip per item. We
// cap at 200 — if a user ever saves more than that we'll switch to cursor
// pagination, but 200 is generous for a v1 personal saved-jobs list.
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      savedJobId: v.id("saved_jobs"),
      jobPostingId: v.id("job_postings"),
      savedAt: v.number(),
      note: v.union(v.string(), v.null()),
      title: v.string(),
      titleSlug: v.string(),
      city: v.string(),
      citySlug: v.string(),
      location: v.string(),
      isActive: v.boolean(),
      companyName: v.string(),
      companySlug: v.string(),
      companyDomain: v.union(v.string(), v.null()),
      companyLogoUrl: v.union(v.string(), v.null()),
      salary: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return [];

    const rows = await ctx.db
      .query("saved_jobs")
      .withIndex("by_userId_savedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);

    const enriched: Array<{
      savedJobId: Id<"saved_jobs">;
      jobPostingId: Id<"job_postings">;
      savedAt: number;
      note: string | null;
      title: string;
      titleSlug: string;
      city: string;
      citySlug: string;
      location: string;
      isActive: boolean;
      companyName: string;
      companySlug: string;
      companyDomain: string | null;
      companyLogoUrl: string | null;
      salary: string | null;
    }> = [];

    for (const row of rows) {
      const posting = await ctx.db.get(row.jobPostingId);
      if (!posting) continue;
      const company = await ctx.db.get(posting.companyId);
      if (!company) continue;
      enriched.push({
        savedJobId: row._id,
        jobPostingId: row.jobPostingId,
        savedAt: row.savedAt,
        note: row.note ?? null,
        title: posting.title,
        titleSlug: posting.titleSlug,
        city: posting.city,
        citySlug: posting.citySlug,
        location: posting.location,
        isActive: posting.isActive,
        companyName: company.nameRaw,
        companySlug: company.slug,
        companyDomain: company.domain ?? null,
        companyLogoUrl: company.logoUrl ?? null,
        salary: posting.detectedExtensions?.salary ?? null,
      });
    }

    return enriched;
  },
});
