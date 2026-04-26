import { query, internalMutation, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { ProfileSchema } from "../lib/profiles/schema";

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

const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PARSES_PER_WINDOW = 5;
const MAX_TEXT_LENGTH = 200_000;
// Model chosen: only Haiku-family entry in live OpenRouter catalog as of task execution.
// Haiku is fast and cheap — the correct choice for structured extraction per project rules.
const MODEL_ID = "anthropic/claude-haiku-4.5";

const SYSTEM_PROMPT = `You are a résumé parser. Extract structured data from the provided résumé text. Use null for missing fields. Do not invent details. Return only fields in the schema.`;

export const parseUpload = action({
  args: {
    text: v.string(),
    sourceFormat: v.union(v.literal("pdf"), v.literal("docx")),
  },
  handler: async (ctx, args): Promise<
    | { ok: true }
    | { ok: false; error: "TEXT_TOO_LONG" | "RATE_LIMIT" | "PARSE_FAILED" }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    if (args.text.length > MAX_TEXT_LENGTH) {
      return { ok: false, error: "TEXT_TOO_LONG" };
    }

    // Ensure user record exists
    const userId = await ctx.runMutation(api.users.store, {});

    // Rate limit — window state lives on the profile row
    const existing = await ctx.runQuery(api.profiles.current, {});
    const now = Date.now();
    let rateLimit: { countInWindow: number; windowStartedAt: number };
    if (existing?.rateLimit) {
      if (now - existing.rateLimit.windowStartedAt > RATE_WINDOW_MS) {
        rateLimit = { countInWindow: 1, windowStartedAt: now };
      } else if (existing.rateLimit.countInWindow >= MAX_PARSES_PER_WINDOW) {
        return { ok: false, error: "RATE_LIMIT" };
      } else {
        rateLimit = {
          countInWindow: existing.rateLimit.countInWindow + 1,
          windowStartedAt: existing.rateLimit.windowStartedAt,
        };
      }
    } else {
      rateLimit = { countInWindow: 1, windowStartedAt: now };
    }

    // OpenRouter call.
    // ZDR: provider: { zdr: true } in OpenRouterChatSettings routes only to
    // zero-data-retention endpoints. Verified against @openrouter/ai-sdk-provider
    // type definitions (OpenRouterChatSettings.provider.zdr?: boolean).
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY!,
    });

    let parsed: Awaited<ReturnType<typeof ProfileSchema.parseAsync>>;
    try {
      const { output } = await generateText({
        model: openrouter.chat(MODEL_ID, {
          provider: { zdr: true },
        }),
        output: Output.object({ schema: ProfileSchema }),
        system: SYSTEM_PROMPT,
        prompt: args.text,
      });
      parsed = output;
    } catch (e) {
      console.error("parseUpload:openrouter_failed", { textLength: args.text.length });
      return { ok: false, error: "PARSE_FAILED" };
    }

    // ProfileSchema uses z.string().nullable() for optional string fields.
    // Convex upsert uses v.optional(v.string()), which expects undefined — not null.
    // Strip nulls here so the mutation validator accepts the data.
    await ctx.runMutation(internal.profiles.upsert, {
      userId,
      sourceFormat: args.sourceFormat,
      rawText: args.text,
      parsedAt: now,
      rateLimit,
      name: parsed.name ?? undefined,
      headline: parsed.headline ?? undefined,
      summary: parsed.summary ?? undefined,
      location: parsed.location ?? undefined,
      experience: parsed.experience.map((e) => ({
        title: e.title,
        company: e.company,
        startDate: e.startDate ?? undefined,
        endDate: e.endDate ?? undefined,
        description: e.description ?? undefined,
      })),
      education: parsed.education.map((e) => ({
        school: e.school,
        degree: e.degree ?? undefined,
        field: e.field ?? undefined,
        startDate: e.startDate ?? undefined,
        endDate: e.endDate ?? undefined,
      })),
      skills: parsed.skills,
    });

    return { ok: true };
  },
});
