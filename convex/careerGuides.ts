import { v } from "convex/values";
import { generateText, Output } from "ai";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { chatModel } from "../lib/ai/providers";
import {
  CONTENT_MODEL_ID,
  ContentResponseSchema,
  DedupResponseSchema,
  ENRICHMENT_TASKS,
  JUDGE_MODEL_ID,
  SalaryJudgeSchema,
  ValidationResponseSchema,
  buildContentPrompt,
  buildDedupPrompt,
  buildEnrichmentQuery,
  buildSalaryJudgePrompt,
  buildValidationPrompt,
} from "../lib/ai/prompts/career-guides";
import type { EnrichmentTask } from "../lib/ai/prompts/career-guides";
import { tryConsumeRateLimit } from "./lib/rateLimit";
import {
  findGuideByExactTitle,
  searchGuideCandidates,
} from "./lib/dedup";
import { normalizeTitle, slugify } from "./lib/normalize";
import { constructImagePrompt } from "./lib/imagePrompts";
import { buildImageMessages } from "./lib/imageReference";
import { exaAnswer, type Citation } from "../lib/server/exa";

const RUN_TIMEOUT_MS = 180_000;
const ENRICHMENT_TIMEOUT_MS = 90_000;
const ENRICHMENT_CONCURRENCY = 6;
const ENRICHMENT_MAX_ATTEMPTS = 2;
const ENRICHMENT_RETRY_DELAY_MS = 60_000;
const ENRICHMENT_TOTAL = ENRICHMENT_TASKS.length;
const VALIDATE_RATE = { max: 15, windowMs: 60_000 };
const GENERATE_RATE = { max: 3, windowMs: 300_000 };
const IMAGE_MODEL_ID = "google/gemini-3.1-flash-image-preview";

const salaryValidator = v.object({
  entry: v.string(),
  mid: v.string(),
  senior: v.string(),
  note: v.optional(v.string()),
});

const regionalBlockValidator = v.object({
  salary: salaryValidator,
  careerOutlook: v.string(),
  learningPath: v.array(v.string()),
  relatedRoles: v.array(v.string()),
});

const citationValidator = v.object({
  url: v.string(),
  title: v.string(),
  publisher: v.optional(v.string()),
  fetchedAt: v.number(),
});

export type GuideWithUrl = Doc<"career_guides"> & {
  illustrationUrl: string | null;
  podcastAudioUrl: string | null;
};

const resolveIllustration = async (
  storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> },
  doc: Doc<"career_guides">,
): Promise<GuideWithUrl> => ({
  ...doc,
  illustrationUrl: doc.illustrationStorageId
    ? await storage.getUrl(doc.illustrationStorageId)
    : null,
  podcastAudioUrl: doc.podcast?.audioStorageId
    ? await storage.getUrl(doc.podcast.audioStorageId)
    : null,
});

// ── Public queries ──────────────────────────────────────────────────────────

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<GuideWithUrl[]> => {
    const limit = Math.min(args.limit ?? 9, 50);
    const docs = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .order("desc")
      .take(limit);
    return Promise.all(docs.map((d) => resolveIllustration(ctx.storage, d)));
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx): Promise<GuideWithUrl[]> => {
    const docs = await ctx.db
      .query("career_guides")
      .withIndex("by_content_status", (q) => q.eq("contentStatus", "complete"))
      .order("desc")
      .take(200);
    return Promise.all(docs.map((d) => resolveIllustration(ctx.storage, d)));
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<GuideWithUrl | null> => {
    const doc = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    return doc ? resolveIllustration(ctx.storage, doc) : null;
  },
});

export const getValidation = query({
  args: { careerNormalized: v.string() },
  handler: async (ctx, args): Promise<Doc<"career_validations"> | null> => {
    const normalized = normalizeTitle(args.careerNormalized);
    if (!normalized) return null;
    const row = await ctx.db
      .query("career_validations")
      .withIndex("by_career_normalized", (q) =>
        q.eq("careerNormalized", normalized),
      )
      .first();
    if (!row?.slug) return row;
    // Self-heal: strip stale slugs whose guide has been deleted (or was
    // never created — earlier validateCareer set slug optimistically before
    // a guide existed). Without this, the search hero would short-circuit
    // straight to a 404.
    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", row.slug as string))
      .first();
    if (guide && guide.contentStatus !== "failed") return row;
    return { ...row, slug: undefined };
  },
});

// ── Internal queries (for actions) ──────────────────────────────────────────

export const _findByExactTitle = internalQuery({
  args: { rawQuery: v.string() },
  handler: (ctx, args) => findGuideByExactTitle(ctx, args.rawQuery),
});

export const _searchCandidates = internalQuery({
  args: { rawQuery: v.string(), limit: v.number() },
  handler: (ctx, args) =>
    searchGuideCandidates(ctx, args.rawQuery, args.limit),
});

export const _getById = internalQuery({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => ctx.db.get(args.guideId),
});

// ── Internal mutations (state transitions) ──────────────────────────────────

export const _requestValidation = internalMutation({
  args: { career: v.string(), clientIp: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    careerNormalized: string;
    status: "pending" | "valid" | "invalid" | "rate-limited";
  }> => {
    const careerNormalized = normalizeTitle(args.career);
    if (!careerNormalized || careerNormalized.length < 2) {
      return { careerNormalized, status: "invalid" };
    }

    const existing = await ctx.db
      .query("career_validations")
      .withIndex("by_career_normalized", (q) =>
        q.eq("careerNormalized", careerNormalized),
      )
      .first();
    if (existing) {
      return { careerNormalized, status: existing.status };
    }

    const limit = await tryConsumeRateLimit(ctx, {
      key: `validate:${args.clientIp}`,
      ...VALIDATE_RATE,
    });
    if (!limit.ok) {
      return { careerNormalized, status: "rate-limited" };
    }

    const validationId = await ctx.db.insert("career_validations", {
      careerNormalized,
      status: "pending",
      clientIp: args.clientIp,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.careerGuides.validateCareer, {
      validationId,
      career: args.career,
    });

    return { careerNormalized, status: "pending" };
  },
});

export const _updateValidation = internalMutation({
  args: {
    validationId: v.id("career_validations"),
    status: v.union(v.literal("valid"), v.literal("invalid")),
    normalizedTitle: v.optional(v.string()),
    slug: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.validationId, {
      status: args.status,
      normalizedTitle: args.normalizedTitle,
      slug: args.slug,
      reason: args.reason,
    });
  },
});

export const _requestGeneration = internalMutation({
  args: { title: v.string(), clientIp: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ slug: string } | { error: string }> => {
    const limit = await tryConsumeRateLimit(ctx, {
      key: `generate:${args.clientIp}`,
      ...GENERATE_RATE,
    });
    if (!limit.ok) {
      return {
        error: "Too many generations from this address. Please wait a few minutes.",
      };
    }

    const slug = slugify(args.title);
    const titleNormalized = normalizeTitle(args.title);
    if (!slug || !titleNormalized) {
      return { error: "Invalid title." };
    }

    const existingBySlug = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    const existingByTitle =
      existingBySlug ??
      (await ctx.db
        .query("career_guides")
        .withIndex("by_title_normalized", (q) =>
          q.eq("titleNormalized", titleNormalized),
        )
        .first());

    const now = Date.now();

    // Reuse existing row unless it failed — failed rows get reset and rerun.
    if (existingByTitle && existingByTitle.contentStatus !== "failed") {
      return { slug: existingByTitle.slug };
    }

    let guideId;
    if (existingByTitle) {
      guideId = existingByTitle._id;
      await ctx.db.patch(guideId, {
        contentStatus: "generating",
        illustrationStatus: "generating",
        illustrationStorageId: undefined,
        content: undefined,
        updatedAt: now,
      });
    } else {
      guideId = await ctx.db.insert("career_guides", {
        slug,
        title: args.title,
        titleNormalized,
        contentStatus: "generating",
        illustrationStatus: "generating",
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.careerGuides.generateContent, {
      guideId,
      title: args.title,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.careerGuides.generateIllustration,
      { guideId, title: args.title },
    );

    return { slug: existingByTitle?.slug ?? slug };
  },
});

export const _updateContent = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    content: v.object({
      overview: v.string(),
      typicalSkills: v.array(v.string()),
      dayToDay: v.string(),
      riskFactors: v.array(v.string()),
      whyConsider: v.string(),
      regional: v.object({
        us: regionalBlockValidator,
        uk: regionalBlockValidator,
      }),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.guideId, {
      content: args.content,
      contentStatus: "complete",
      enrichment: {
        status: "pending",
        progress: { total: ENRICHMENT_TOTAL, done: 0 },
        attempts: 0,
        costCents: 0,
      },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.careerGuides.enrichGuide, {
      guideId: args.guideId,
    });
    await ctx.scheduler.runAfter(0, internal.podcasts.generateScript, {
      guideId: args.guideId,
    });
  },
});

export const _markContentFailed = internalMutation({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.guideId, {
      contentStatus: "failed",
      updatedAt: Date.now(),
    });
  },
});

export const _updateIllustration = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.guideId, {
      illustrationStorageId: args.storageId,
      illustrationStatus: "complete",
      updatedAt: Date.now(),
    });
  },
});

export const _markIllustrationFailed = internalMutation({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.guideId, {
      illustrationStatus: "failed",
      updatedAt: Date.now(),
    });
  },
});

export const _purgeValidation = internalMutation({
  args: { careerNormalized: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("career_validations")
      .withIndex("by_career_normalized", (q) =>
        q.eq("careerNormalized", args.careerNormalized),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

// Ops trigger: enrich (or re-enrich) any existing guide by slug.
// Safe to call repeatedly — `_beginEnrichment` short-circuits on
// running/complete states.
export const triggerEnrichmentBySlug = mutation({
  args: { slug: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), guideId: v.id("career_guides") }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!guide) {
      return { ok: false as const, reason: "not_found" };
    }
    if (guide.contentStatus !== "complete") {
      return { ok: false as const, reason: "content_not_ready" };
    }
    // Reset enrichment to pending so _beginEnrichment will pick it up.
    await ctx.db.patch(guide._id, {
      enrichment: {
        status: "pending",
        progress: { total: ENRICHMENT_TOTAL, done: 0 },
        attempts: guide.enrichment?.attempts ?? 0,
        costCents: guide.enrichment?.costCents ?? 0,
        lastEnrichedAt: guide.enrichment?.lastEnrichedAt,
      },
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.careerGuides.enrichGuide, {
      guideId: guide._id,
    });
    return { ok: true as const, guideId: guide._id };
  },
});

export const _purgeAllGuides = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("career_guides").collect();
    for (const r of rows) {
      if (r.illustrationStorageId) {
        try {
          await ctx.storage.delete(r.illustrationStorageId);
        } catch {
          // storage may already be gone
        }
      }
      await ctx.db.delete(r._id);
    }
    return { deleted: rows.length };
  },
});

// ── Enrichment state mutations ─────────────────────────────────────────────

export const _beginEnrichment = internalMutation({
  args: { guideId: v.id("career_guides") },
  returns: v.union(
    v.object({ ok: v.literal(true), title: v.string(), attempts: v.number() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return { ok: false as const, reason: "not_found" };
    const prev = guide.enrichment;
    if (prev?.status === "running") {
      return { ok: false as const, reason: "already_running" };
    }
    if (prev?.status === "complete") {
      return { ok: false as const, reason: "already_complete" };
    }
    const attempts = (prev?.attempts ?? 0) + 1;
    await ctx.db.patch(args.guideId, {
      enrichment: {
        status: "running",
        progress: { total: ENRICHMENT_TOTAL, done: 0 },
        attempts,
        costCents: 0,
        lastEnrichedAt: prev?.lastEnrichedAt,
      },
      updatedAt: Date.now(),
    });
    return { ok: true as const, title: guide.title, attempts };
  },
});

export const _recordFieldEnrichment = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    fieldPath: v.string(),
    citations: v.array(citationValidator),
    costCents: v.number(),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return;
    const citations = { ...(guide.citations ?? {}) };
    citations[args.fieldPath] = args.citations;
    const enrichment = guide.enrichment ?? {
      status: "running" as const,
      progress: { total: ENRICHMENT_TOTAL, done: 0 },
      attempts: 1,
      costCents: 0,
    };
    await ctx.db.patch(args.guideId, {
      citations,
      enrichment: {
        ...enrichment,
        progress: {
          total: enrichment.progress.total,
          done: Math.min(
            enrichment.progress.total,
            enrichment.progress.done + 1,
          ),
        },
        costCents:
          Math.round((enrichment.costCents + args.costCents) * 100) / 100,
      },
      updatedAt: Date.now(),
    });
  },
});

export const _patchSalary = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    region: v.union(v.literal("us"), v.literal("uk")),
    salary: salaryValidator,
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide?.content) return;
    const next = {
      ...guide.content,
      regional: {
        ...guide.content.regional,
        [args.region]: {
          ...guide.content.regional[args.region],
          salary: args.salary,
        },
      },
    };
    await ctx.db.patch(args.guideId, {
      content: next,
      updatedAt: Date.now(),
    });
  },
});

export const _completeEnrichment = internalMutation({
  args: { guideId: v.id("career_guides"), addedCostCents: v.number() },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return;
    const enrichment = guide.enrichment;
    if (!enrichment) return;
    const now = Date.now();
    await ctx.db.patch(args.guideId, {
      enrichment: {
        status: "complete",
        progress: {
          total: enrichment.progress.total,
          done: enrichment.progress.total,
        },
        attempts: enrichment.attempts,
        costCents:
          Math.round((enrichment.costCents + args.addedCostCents) * 100) / 100,
        lastEnrichedAt: now,
      },
      updatedAt: now,
    });
  },
});

export const _failEnrichment = internalMutation({
  args: { guideId: v.id("career_guides"), error: v.string() },
  returns: v.object({ attempts: v.number() }),
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return { attempts: ENRICHMENT_MAX_ATTEMPTS };
    const enrichment = guide.enrichment ?? {
      status: "failed" as const,
      progress: { total: ENRICHMENT_TOTAL, done: 0 },
      attempts: 1,
      costCents: 0,
    };
    await ctx.db.patch(args.guideId, {
      enrichment: {
        status: "failed",
        progress: enrichment.progress,
        attempts: enrichment.attempts,
        costCents: enrichment.costCents,
        lastEnrichedAt: enrichment.lastEnrichedAt,
        error: args.error.slice(0, 500),
      },
      updatedAt: Date.now(),
    });
    return { attempts: enrichment.attempts };
  },
});

// ── Internal actions (LLM + image) ──────────────────────────────────────────

export const validateCareer = internalAction({
  args: {
    validationId: v.id("career_validations"),
    career: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const { output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: ValidationResponseSchema }),
        prompt: buildValidationPrompt(args.career),
      });

      // Only return a slug if a real guide already exists for the normalized
      // title. Otherwise the frontend would navigate to a non-existent page
      // before /generate has a chance to create the guide.
      let slug: string | undefined;
      if (output.valid && output.normalizedTitle) {
        const existing = await ctx.runQuery(
          internal.careerGuides._findByExactTitle,
          { rawQuery: output.normalizedTitle },
        );
        if (existing) slug = existing.slug;
      }

      await ctx.runMutation(internal.careerGuides._updateValidation, {
        validationId: args.validationId,
        status: output.valid ? "valid" : "invalid",
        normalizedTitle: output.normalizedTitle ?? undefined,
        slug,
        reason: output.reason,
      });
    } catch (err) {
      console.error("validateCareer:failed", { err });
      await ctx.runMutation(internal.careerGuides._updateValidation, {
        validationId: args.validationId,
        status: "invalid",
        reason: "Validation service temporarily unavailable.",
      });
    }
    return null;
  },
});

export const requestGuideFromSearch = internalAction({
  args: { title: v.string(), clientIp: v.string() },
  returns: v.union(
    v.object({ slug: v.string() }),
    v.object({ error: v.string() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{ slug: string } | { error: string }> => {
    // Tier-1 lexical: exact title match (cheap, free, common case).
    const lex = await ctx.runQuery(internal.careerGuides._findByExactTitle, {
      rawQuery: args.title,
    });
    if (lex) return { slug: lex.slug };

    // Tier-4 LLM dedup against top search candidates.
    const candidates: { slug: string; title: string }[] = await ctx.runQuery(
      internal.careerGuides._searchCandidates,
      { rawQuery: args.title, limit: 10 },
    );
    if (candidates.length > 0) {
      try {
        const { output } = await generateText({
          model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
          output: Output.object({ schema: DedupResponseSchema }),
          prompt: buildDedupPrompt(args.title, candidates),
        });
        if (output.isDuplicate && output.matchedSlug) {
          return { slug: output.matchedSlug };
        }
      } catch (err) {
        // Dedup is best-effort; fall through and create a new guide.
        console.error("dedup:failed", { err });
      }
    }

    return await ctx.runMutation(internal.careerGuides._requestGeneration, {
      title: args.title,
      clientIp: args.clientIp,
    });
  },
});

export const generateContent = internalAction({
  args: {
    guideId: v.id("career_guides"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    try {
      const { output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: ContentResponseSchema }),
        prompt: buildContentPrompt(args.title),
        abortSignal: controller.signal,
      });

      const stripSalaryNullNote = (s: { entry: string; mid: string; senior: string; note: string | null }) => ({
        entry: s.entry,
        mid: s.mid,
        senior: s.senior,
        ...(s.note ? { note: s.note } : {}),
      });

      await ctx.runMutation(internal.careerGuides._updateContent, {
        guideId: args.guideId,
        content: {
          ...output,
          regional: {
            us: { ...output.regional.us, salary: stripSalaryNullNote(output.regional.us.salary) },
            uk: { ...output.regional.uk, salary: stripSalaryNullNote(output.regional.uk.salary) },
          },
        },
      });
    } catch (err) {
      console.error("generateContent:failed", {
        guideId: args.guideId,
        err,
      });
      await ctx.runMutation(internal.careerGuides._markContentFailed, {
        guideId: args.guideId,
      });
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

export const generateIllustration = internalAction({
  args: {
    guideId: v.id("career_guides"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is not set");
      }

      const prompt = constructImagePrompt({
        title: args.title,
        description: `A career guide page for ${args.title}.`,
      });

      const res = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: IMAGE_MODEL_ID,
            modalities: ["image", "text"],
            messages: buildImageMessages(prompt),
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenRouter image ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            images?: Array<{ image_url: { url: string } }>;
          };
        }>;
      };
      const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!url) throw new Error("No image in OpenRouter response");

      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error("Unexpected image URL format");

      const mimeType = match[1];
      const base64 = match[2];
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mimeType });
      const storageId = await ctx.storage.store(blob);

      await ctx.runMutation(internal.careerGuides._updateIllustration, {
        guideId: args.guideId,
        storageId,
      });
    } catch (err) {
      console.error("generateIllustration:failed", {
        guideId: args.guideId,
        err,
      });
      await ctx.runMutation(internal.careerGuides._markIllustrationFailed, {
        guideId: args.guideId,
      });
    }
    return null;
  },
});

// ── Enrichment ─────────────────────────────────────────────────────────────

const runWithConcurrency = async <T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> => {
  const results = new Array<T>(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
};

type EnrichmentOutcome =
  | {
      task: EnrichmentTask;
      ok: true;
      answer: string;
      citations: Citation[];
      costCents: number;
    }
  | { task: EnrichmentTask; ok: false; error: string };

export const enrichGuide = internalAction({
  args: { guideId: v.id("career_guides") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const begin = await ctx.runMutation(
      internal.careerGuides._beginEnrichment,
      { guideId: args.guideId },
    );
    if (!begin.ok) return null;

    if (!process.env.EXA_API_KEY) {
      await ctx.runMutation(internal.careerGuides._failEnrichment, {
        guideId: args.guideId,
        error: "EXA_API_KEY is not set",
      });
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      ENRICHMENT_TIMEOUT_MS,
    );

    try {
      const tasks = ENRICHMENT_TASKS.map(
        (task) => async (): Promise<EnrichmentOutcome> => {
          try {
            const { query, systemPrompt } = buildEnrichmentQuery(
              task,
              begin.title,
            );
            const res = await exaAnswer(query, {
              systemPrompt,
              signal: controller.signal,
            });
            await ctx.runMutation(
              internal.careerGuides._recordFieldEnrichment,
              {
                guideId: args.guideId,
                fieldPath: task.fieldPath,
                citations: res.citations,
                costCents: res.costCents,
              },
            );
            return {
              task,
              ok: true,
              answer: res.answer,
              citations: res.citations,
              costCents: res.costCents,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("enrichGuide:field-failed", {
              guideId: args.guideId,
              fieldPath: task.fieldPath,
              err: message,
            });
            return { task, ok: false, error: message };
          }
        },
      );

      const outcomes = await runWithConcurrency(
        tasks,
        ENRICHMENT_CONCURRENCY,
      );

      // Hard-fail if every Exa call errored — likely a key/auth/credits issue,
      // not a one-off. Schedule a retry.
      const okCount = outcomes.filter((o) => o.ok).length;
      if (okCount === 0) {
        throw new Error("All Exa calls failed");
      }

      // Salary judge — runs only when both regional salary calls succeeded.
      const salaryUs = outcomes.find(
        (o): o is Extract<EnrichmentOutcome, { ok: true }> =>
          o.ok && o.task.fieldPath === "regional.us.salary",
      );
      const salaryUk = outcomes.find(
        (o): o is Extract<EnrichmentOutcome, { ok: true }> =>
          o.ok && o.task.fieldPath === "regional.uk.salary",
      );

      let judgeCostCents = 0;
      if (salaryUs && salaryUk) {
        const guide = await ctx.runQuery(internal.careerGuides._getById, {
          guideId: args.guideId,
        });
        if (guide?.content) {
          try {
            const { output } = await generateText({
              model: chatModel(JUDGE_MODEL_ID, { zdr: true }),
              output: Output.object({ schema: SalaryJudgeSchema }),
              prompt: buildSalaryJudgePrompt({
                title: begin.title,
                us: {
                  stored: guide.content.regional.us.salary,
                  exaAnswer: salaryUs.answer,
                  sources: salaryUs.citations.map((c) => c.url),
                },
                uk: {
                  stored: guide.content.regional.uk.salary,
                  exaAnswer: salaryUk.answer,
                  sources: salaryUk.citations.map((c) => c.url),
                },
              }),
              abortSignal: controller.signal,
            });
            judgeCostCents = 0.2;

            for (const region of ["us", "uk"] as const) {
              const verdict = output[region];
              if (verdict.verdict === "material" && verdict.proposed) {
                const proposed = verdict.proposed;
                await ctx.runMutation(internal.careerGuides._patchSalary, {
                  guideId: args.guideId,
                  region,
                  salary: {
                    entry: proposed.entry,
                    mid: proposed.mid,
                    senior: proposed.senior,
                    ...(proposed.note ? { note: proposed.note } : {}),
                  },
                });
              }
            }
          } catch (err) {
            // Judge failures don't fail the whole enrichment — citations
            // are already attached. Just log and continue.
            console.error("enrichGuide:judge-failed", {
              guideId: args.guideId,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      await ctx.runMutation(internal.careerGuides._completeEnrichment, {
        guideId: args.guideId,
        addedCostCents: judgeCostCents,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("enrichGuide:orchestrator-failed", {
        guideId: args.guideId,
        err: message,
      });
      const result = await ctx.runMutation(
        internal.careerGuides._failEnrichment,
        { guideId: args.guideId, error: message },
      );
      if (result.attempts < ENRICHMENT_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          ENRICHMENT_RETRY_DELAY_MS,
          internal.careerGuides.enrichGuide,
          { guideId: args.guideId },
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    return null;
  },
});
