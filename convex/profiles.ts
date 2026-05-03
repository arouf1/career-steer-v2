import {
  query,
  internalQuery,
  internalMutation,
  action,
  mutation,
  type ActionCtx,
} from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { ProfileSchema } from "../lib/profiles/schema";
import {
  isPrivateLinkedInProfile,
  linkedinUrlSchema,
} from "../lib/profiles/linkedin";
import { exaGetContents } from "../lib/server/exa";
import type { Id } from "./_generated/dataModel";

export const getById = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.profileId);
  },
});

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
    sourceFormat: v.union(
      v.literal("pdf"),
      v.literal("docx"),
      v.literal("linkedin"),
    ),
    rawText: v.string(),
    linkedinUrl: v.optional(v.string()),
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

// LinkedIn scrape budget. V1 ran ten attempts; V2 caps at 5 because the
// Convex action's wall-clock budget also has to cover the LLM extraction.
// At the 8s exponential cap, five attempts is ~25s worst case.
const LINKEDIN_MAX_ATTEMPTS = 5;
const LINKEDIN_BACKOFF_CAP_MS = 8_000;

type ExtractInput = {
  rawText: string;
  sourceFormat: "pdf" | "docx" | "linkedin";
  linkedinUrl?: string;
  inputKind: "resume" | "linkedin";
};

type ExtractResult =
  | { ok: true }
  | { ok: false; error: "TEXT_TOO_LONG" | "RATE_LIMIT" | "PARSE_FAILED" };

// Shared LLM-extraction + upsert path. parseUpload (CV/DOCX) and
// parseLinkedIn both delegate here so the OpenRouter config, rate-limit
// counter, schema mapping, and post-upsert enrichment kickoff live in
// exactly one place. The rate-limit counter is intentionally shared across
// sources — the cost driver is the LLM call, not the input format.
async function extractAndUpsertProfile(
  ctx: ActionCtx,
  args: ExtractInput,
): Promise<ExtractResult> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");

  if (args.rawText.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: "TEXT_TOO_LONG" };
  }

  const userId = await ctx.runMutation(api.users.store, {});

  // Rate limit — window state lives on the profile row.
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

  const sourceLabel =
    args.inputKind === "linkedin" ? "LinkedIn profile" : "résumé";
  const systemPrompt = `You are a ${sourceLabel} parser. Extract structured data from the provided ${sourceLabel} text. Use null for missing fields. Do not invent details. Return only fields in the schema.`;

  let parsed: Awaited<ReturnType<typeof ProfileSchema.parseAsync>>;
  try {
    const { output } = await generateText({
      model: openrouter.chat(MODEL_ID, {
        provider: { zdr: true },
      }),
      output: Output.object({ schema: ProfileSchema }),
      system: systemPrompt,
      prompt: args.rawText,
    });
    parsed = output;
  } catch {
    console.error("extractAndUpsertProfile:openrouter_failed", {
      textLength: args.rawText.length,
      inputKind: args.inputKind,
    });
    return { ok: false, error: "PARSE_FAILED" };
  }

  // ProfileSchema uses z.string().nullable() for optional string fields.
  // Convex upsert uses v.optional(v.string()), which expects undefined — not null.
  // Strip nulls here so the mutation validator accepts the data.
  const profileId: Id<"profiles"> = await ctx.runMutation(
    internal.profiles.upsert,
    {
      userId,
      sourceFormat: args.sourceFormat,
      linkedinUrl: args.linkedinUrl,
      rawText: args.rawText,
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
    },
  );

  await ctx.scheduler.runAfter(0, internal.enrichments.run, {
    profileId,
    userId,
  });

  return { ok: true };
}

export const parseUpload = action({
  args: {
    text: v.string(),
    sourceFormat: v.union(v.literal("pdf"), v.literal("docx")),
  },
  handler: async (ctx, args): Promise<ExtractResult> =>
    extractAndUpsertProfile(ctx, {
      rawText: args.text,
      sourceFormat: args.sourceFormat,
      inputKind: "resume",
    }),
});

type LinkedInParseResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "INVALID_LINKEDIN_URL"
        | "PRIVATE_PROFILE"
        | "EXA_FAILED"
        | "TEXT_TOO_LONG"
        | "RATE_LIMIT"
        | "PARSE_FAILED";
    };

export const parseLinkedIn = action({
  args: { url: v.string() },
  handler: async (ctx, args): Promise<LinkedInParseResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const validation = linkedinUrlSchema.safeParse(args.url);
    if (!validation.success) {
      return { ok: false, error: "INVALID_LINKEDIN_URL" };
    }
    const validUrl = validation.data;

    // Retry-on-private loop. Public profiles return on attempt 1 in the
    // happy path; gated profiles often unblock within 2-3 retries because
    // Exa rotates IPs / cache hits. After LINKEDIN_MAX_ATTEMPTS we give up
    // and ask the user to make the profile public or upload a CV instead.
    let scrapedText: string | null = null;
    for (let attempt = 1; attempt <= LINKEDIN_MAX_ATTEMPTS; attempt++) {
      let scraped;
      try {
        scraped = await exaGetContents(validUrl);
      } catch (err) {
        console.error("parseLinkedIn:exa_failed", {
          url: validUrl,
          attempt,
          message: err instanceof Error ? err.message : String(err),
        });
        return { ok: false, error: "EXA_FAILED" };
      }
      if (!isPrivateLinkedInProfile(scraped.text)) {
        scrapedText = scraped.text;
        break;
      }
      if (attempt < LINKEDIN_MAX_ATTEMPTS) {
        const delayMs = Math.min(
          1000 * Math.pow(2, attempt - 1),
          LINKEDIN_BACKOFF_CAP_MS,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    if (scrapedText === null) {
      return { ok: false, error: "PRIVATE_PROFILE" };
    }

    return extractAndUpsertProfile(ctx, {
      rawText: scrapedText,
      sourceFormat: "linkedin",
      linkedinUrl: validUrl,
      inputKind: "linkedin",
    });
  },
});

const userOwnedProfile = async (ctx: any) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q: any) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) throw new Error("User record missing");
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
    .unique();
  if (!profile) throw new Error("No profile yet");
  return profile;
};

const ProfilePatch = v.object({
  name: v.optional(v.union(v.string(), v.null())),
  headline: v.optional(v.union(v.string(), v.null())),
  summary: v.optional(v.union(v.string(), v.null())),
  location: v.optional(v.union(v.string(), v.null())),
  experience: v.optional(v.array(v.object({
    title: v.string(),
    company: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    description: v.optional(v.string()),
  }))),
  education: v.optional(v.array(v.object({
    school: v.string(),
    degree: v.optional(v.string()),
    field: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  }))),
  skills: v.optional(v.array(v.string())),
});

const RE_ENRICH_DEBOUNCE_MS = 5_000;

export const update = mutation({
  args: { patch: ProfilePatch },
  handler: async (ctx, args) => {
    const profile = await userOwnedProfile(ctx);
    await ctx.db.patch(profile._id, args.patch);

    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (enrichment) {
      await ctx.db.patch(enrichment._id, { status: "stale" });
    }

    await ctx.scheduler.runAfter(
      RE_ENRICH_DEBOUNCE_MS,
      internal.enrichments.run,
      {
        profileId: profile._id,
        userId: profile.userId,
      },
    );
  },
});

export const markReviewed = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await userOwnedProfile(ctx);
    await ctx.db.patch(profile._id, { reviewed: true });

    await ctx.scheduler.runAfter(
      0,
      internal.discover.scheduleSnapshotRegeneration,
      {
        userId: profile.userId,
        dedupKey: "init",
        forceFreshReasons: false,
      },
    );

    // Seed public career guides for the canonical job titles in this
    // profile's work history. Idempotent — re-running markReviewed on an
    // unchanged experience array is a no-op via the checksum gate in
    // seedGuidesFromProfile. Runs in parallel with the discover snapshot
    // regen above; both are independent fan-outs.
    await ctx.scheduler.runAfter(
      0,
      internal.profileGuideSeeding.seedGuidesFromProfile,
      { userId: profile.userId },
    );
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await userOwnedProfile(ctx);

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
    for (const row of paths) {
      await ctx.db.delete(row._id);
    }

    const personalizations = await ctx.db
      .query("career_guide_personalizations")
      .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
      .collect();
    for (const row of personalizations) await ctx.db.delete(row._id);

    await ctx.db.delete(profile._id);
  },
});
