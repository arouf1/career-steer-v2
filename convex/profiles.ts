import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;

    return await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
  },
});

export const upsert = internalMutation({
  args: {
    userId: v.id("users"),
    sourceFormat: v.union(v.literal("pdf"), v.literal("docx")),
    rawText: v.string(),
    parsedAt: v.number(),
    rateLimit: v.object({
      countInWindow: v.number(),
      windowStartedAt: v.number(),
    }),
    name: v.optional(v.string()),
    headline: v.optional(v.string()),
    summary: v.optional(v.string()),
    location: v.optional(v.string()),
    experience: v.array(v.object({
      title: v.string(),
      company: v.string(),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      description: v.optional(v.string()),
    })),
    education: v.array(v.object({
      school: v.string(),
      degree: v.optional(v.string()),
      field: v.optional(v.string()),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
    })),
    skills: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      await ctx.db.replace(existing._id, { ...args, reviewed: false });
      return existing._id;
    }
    return await ctx.db.insert("profiles", { ...args, reviewed: false });
  },
});
