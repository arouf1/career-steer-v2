import { mutation, query, internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
  },
});

export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const email = identity.email ?? "";
    const name = identity.name;
    const imageUrl = identity.pictureUrl;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (existing) {
      const patch: { email?: string; name?: string; imageUrl?: string } = {};
      if (existing.email !== email) patch.email = email;
      if (name !== undefined && existing.name !== name) patch.name = name;
      if (imageUrl !== undefined && existing.imageUrl !== imageUrl)
        patch.imageUrl = imageUrl;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email,
      name,
      imageUrl,
    });
  },
});

const cascadeDeleteUser = async (
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> => {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  if (profile) {
    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (enrichment) await ctx.db.delete(enrichment._id);

    const embedding = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (embedding) await ctx.db.delete(embedding._id);

    const paths = await ctx.db
      .query("career_paths")
      .withIndex("by_profileId_and_kind", (q) =>
        q.eq("profileId", profile._id),
      )
      .collect();
    for (const row of paths) await ctx.db.delete(row._id);

    await ctx.db.delete(profile._id);
  }

  const personalizations = await ctx.db
    .query("career_guide_personalizations")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  for (const row of personalizations) await ctx.db.delete(row._id);

  await ctx.db.delete(userId);
};

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return;

    await cascadeDeleteUser(ctx, user._id);
  },
});

export const deleteByTokenIdentifierInternal = internalMutation({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    if (!user) return;

    await cascadeDeleteUser(ctx, user._id);
  },
});
