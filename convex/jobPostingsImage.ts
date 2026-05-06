import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildImageMessages } from "./lib/imageReference";
import { buildJobImagePrompt } from "./lib/jobImagePrompts";

// Same Gemini Flash Image model as career-guide illustrations. Keeps both
// pipelines on a single model so visual feel stays coherent and we don't
// pay the cold-route penalty of mixing providers.
const IMAGE_MODEL_ID = "google/gemini-3.1-flash-image-preview";

const RUN_TIMEOUT_MS = 90_000;

// ── Public mutation: ensure hero gen is queued ──────────────────────────────
//
// Called from the public detail page (Server Component) on render. Idempotent:
// if illustrationStatus is already set in any state, no-op. Sets status to
// "generating" and schedules the action exactly once. The page renders the
// gradient placeholder; the user gets the real image on the next view.

export const ensureHeroQueued = mutation({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.object({
    queued: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) return { queued: false, reason: "missing" };
    if (posting.illustrationStatus !== undefined) {
      return { queued: false, reason: posting.illustrationStatus };
    }
    if (!posting.isActive) {
      // Don't burn image-gen on archived listings.
      return { queued: false, reason: "archived" };
    }
    await ctx.db.patch(args.jobPostingId, {
      illustrationStatus: "generating",
    });
    await ctx.scheduler.runAfter(
      0,
      internal.jobPostingsImage._generateHero,
      { jobPostingId: args.jobPostingId },
    );
    return { queued: true };
  },
});

// ── Live hero state for the listing page ──────────────────────────────────
//
// The detail page is server-rendered and reads the posting once via fetchQuery.
// That gives a clean first paint but means the gradient placeholder stays put
// until the user reloads — even if the image landed seconds later. This query
// is consumed by a small client component (HeroImageLive) that subscribes via
// useQuery, so the hero re-renders the moment _markHeroComplete fires. URL is
// a signed Convex storage URL, refreshed on each subscription tick (no client-
// side caching needed; the storage id changes only on a fresh generation).

type HeroStatus = "idle" | "generating" | "complete" | "failed";

export const heroState = query({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.object({
    status: v.union(
      v.literal("idle"),
      v.literal("generating"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    url: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: HeroStatus; url: string | null }> => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) {
      return { status: "idle", url: null };
    }
    const status: HeroStatus = posting.illustrationStatus ?? "idle";
    const url =
      posting.illustrationStatus === "complete" && posting.illustrationStorageId
        ? await ctx.storage.getUrl(posting.illustrationStorageId)
        : null;
    return { status, url };
  },
});

// ── Status mutations ──────────────────────────────────────────────────────

export const _markHeroComplete = internalMutation({
  args: {
    jobPostingId: v.id("job_postings"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobPostingId, {
      illustrationStorageId: args.storageId,
      illustrationStatus: "complete",
      illustrationLastError: undefined,
    });
  },
});

export const _markHeroFailed = internalMutation({
  args: {
    jobPostingId: v.id("job_postings"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobPostingId, {
      illustrationStatus: "failed",
      illustrationLastError: args.error.slice(0, 1000),
    });
  },
});

// ── The action ────────────────────────────────────────────────────────────

export const _generateHero = internalAction({
  args: { jobPostingId: v.id("job_postings") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    try {
      const ctxRow = await ctx.runQuery(
        internal.jobPostingsImage._loadHeroContext,
        { jobPostingId: args.jobPostingId },
      );
      if (!ctxRow) return null;

      const prompt = buildJobImagePrompt({
        title: ctxRow.title,
        companyName: ctxRow.companyName,
        city: ctxRow.city,
        brandColor: ctxRow.brandColor,
        archetypeSlug: ctxRow.archetypeSlug,
      });

      const storageId = await generateAndStoreImage(ctx, prompt);

      await ctx.runMutation(internal.jobPostingsImage._markHeroComplete, {
        jobPostingId: args.jobPostingId,
        storageId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("jobPostingsImage._generateHero:failed", {
        jobPostingId: args.jobPostingId,
        err: message,
      });
      await ctx.runMutation(internal.jobPostingsImage._markHeroFailed, {
        jobPostingId: args.jobPostingId,
        error: message,
      });
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

// ── Internal helpers ──────────────────────────────────────────────────────

export const _loadHeroContext = internalQuery({
  args: { jobPostingId: v.id("job_postings") },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.jobPostingId);
    if (!posting) return null;
    const company = await ctx.db.get(posting.companyId);
    if (!company) return null;
    return {
      title: posting.title,
      companyName: company.nameRaw,
      city: posting.city,
      brandColor: company.brandColor ?? null,
      archetypeSlug: posting.roleArchetypeSlug ?? null,
    };
  },
});

// Mirrors convex/careerGuides.ts:generateAndStoreImage (which is private to
// that module). Same shape, same OpenRouter endpoint, same Gemini Flash
// Image model. Lifted here so the jobs pipeline doesn't depend on careerGuides
// internals — they can evolve independently.
async function generateAndStoreImage(
  ctx: { storage: { store: (blob: Blob) => Promise<Id<"_storage">> } },
  prompt: string,
): Promise<Id<"_storage">> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter image ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: { images?: Array<{ image_url: { url: string } }> };
    }>;
  };
  const dataUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl) throw new Error("No image in OpenRouter response");

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Unexpected image URL format");

  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: match[1] });
  return ctx.storage.store(blob);
}
