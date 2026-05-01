import { ConvexError, v } from "convex/values";
import { generateText, Output } from "ai";
import { internalAction, internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { chatModel } from "../lib/ai/providers";
import {
  PodcastScriptSchema,
  buildPodcastScriptPrompt,
} from "../lib/ai/prompts/podcast";
import { HOST, pickGuestVoice } from "../lib/podcast/voices";

// Gemini 3.1 Pro Preview was returning 200 OK with zero usage and an empty
// body for some podcast prompts (OpenRouter routing dropped the upstream
// call before reaching Google). Use the GA Gemini 2.5 Pro for podcast
// scripts — it's fully released and stable for our prompt sizes.
const SCRIPT_MODEL_ID = "google/gemini-2.5-pro";
const SCRIPT_TIMEOUT_MS = 180_000;
const SCRIPT_RETRIES = 2; // total tries = SCRIPT_RETRIES + 1
const MAX_ATTEMPTS = 2;

const transcriptValidator = v.array(
  v.object({
    speaker: v.union(v.literal("host"), v.literal("guest")),
    text: v.string(),
  }),
);

// ── Mutations ───────────────────────────────────────────────────────────────

export const _beginPodcast = internalMutation({
  args: { guideId: v.id("career_guides") },
  returns: v.union(
    v.object({ ok: v.literal(true), attempts: v.number() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return { ok: false as const, reason: "not_found" };
    if (!guide.content) {
      return { ok: false as const, reason: "content_not_ready" };
    }
    const prev = guide.podcast;
    if (prev?.status === "complete") {
      return { ok: false as const, reason: "already_complete" };
    }
    const attempts = (prev?.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) {
      return { ok: false as const, reason: "max_attempts" };
    }
    await ctx.db.patch(args.guideId, {
      podcast: {
        status: "scripting",
        hostVoice: HOST.voice,
        attempts,
        // Carry forward existing transcript/audio if a previous run produced
        // them — useful when the synthesize step retries on its own.
        audioStorageId: prev?.audioStorageId,
        durationSeconds: prev?.durationSeconds,
        guestVoice: prev?.guestVoice,
        guestName: prev?.guestName,
        guestRole: prev?.guestRole,
        guestGender: prev?.guestGender,
        transcript: prev?.transcript,
      },
      updatedAt: Date.now(),
    });
    return { ok: true as const, attempts };
  },
});

export const _savePodcastScript = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    guestName: v.string(),
    guestRole: v.string(),
    guestGender: v.union(v.literal("female"), v.literal("male")),
    guestVoice: v.string(),
    transcript: transcriptValidator,
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return;

    // Race-condition guard: if another guide concurrently picked the same
    // guest name between this action's pre-fetch and now, reject so the
    // action can retry with the new name added to its forbidden set.
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const taken = norm(args.guestName);
    if (taken) {
      const all = await ctx.db.query("career_guides").collect();
      const collision = all.find(
        (g) =>
          g._id !== args.guideId &&
          norm(g.podcast?.guestName ?? "") === taken,
      );
      if (collision) {
        throw new ConvexError(`guestName_collision_race:${args.guestName}`);
      }
    }

    const prev = guide.podcast;
    await ctx.db.patch(args.guideId, {
      podcast: {
        status: "synthesizing",
        hostVoice: HOST.voice,
        guestVoice: args.guestVoice,
        guestName: args.guestName,
        guestRole: args.guestRole,
        guestGender: args.guestGender,
        transcript: args.transcript,
        attempts: prev?.attempts ?? 1,
        audioStorageId: prev?.audioStorageId,
        durationSeconds: prev?.durationSeconds,
      },
      updatedAt: Date.now(),
    });
  },
});

export const _completePodcast = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    audioStorageId: v.id("_storage"),
    durationSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide?.podcast) return;
    const now = Date.now();
    await ctx.db.patch(args.guideId, {
      podcast: {
        ...guide.podcast,
        status: "complete",
        audioStorageId: args.audioStorageId,
        durationSeconds: args.durationSeconds,
        generatedAt: now,
        error: undefined,
      },
      updatedAt: now,
    });
  },
});

export const _failPodcast = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return;
    const prev = guide.podcast;
    await ctx.db.patch(args.guideId, {
      podcast: {
        status: "failed",
        hostVoice: prev?.hostVoice ?? HOST.voice,
        attempts: prev?.attempts ?? 1,
        audioStorageId: prev?.audioStorageId,
        durationSeconds: prev?.durationSeconds,
        guestVoice: prev?.guestVoice,
        guestName: prev?.guestName,
        guestRole: prev?.guestRole,
        guestGender: prev?.guestGender,
        transcript: prev?.transcript,
        error: args.error.slice(0, 500),
      },
      updatedAt: Date.now(),
    });
  },
});

// Ops trigger: generate (or regenerate) the podcast for an existing guide by
// slug. Resets `attempts` so it isn't blocked by past failures. Safe to call
// repeatedly — `_beginPodcast` short-circuits on `complete` state.
export const triggerPodcastBySlug = mutation({
  args: {
    slug: v.string(),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), guideId: v.id("career_guides") }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!guide) return { ok: false as const, reason: "not_found" };
    if (guide.contentStatus !== "complete" || !guide.content) {
      return { ok: false as const, reason: "content_not_ready" };
    }
    // If already complete and not forced, leave it alone.
    if (guide.podcast?.status === "complete" && !args.force) {
      return { ok: false as const, reason: "already_complete" };
    }
    // Reset attempts + clear any prior failure so the pipeline runs cleanly.
    await ctx.db.patch(guide._id, {
      podcast: {
        status: "pending",
        hostVoice: HOST.voice,
        attempts: 0,
        // Drop stale audio/transcript so the UI shows the pending state.
        audioStorageId: undefined,
        durationSeconds: undefined,
        guestVoice: undefined,
        guestName: undefined,
        guestRole: undefined,
        guestGender: undefined,
        transcript: undefined,
        error: undefined,
      },
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.podcasts.generateScript, {
      guideId: guide._id,
    });
    return { ok: true as const, guideId: guide._id };
  },
});

// ── Action: generate dialogue + cast guest ──────────────────────────────────

export const generateScript = internalAction({
  args: { guideId: v.id("career_guides") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const begin = await ctx.runMutation(internal.podcasts._beginPodcast, {
      guideId: args.guideId,
    });
    if (!begin.ok) return null;

    const guide = await ctx.runQuery(internal.careerGuides._getById, {
      guideId: args.guideId,
    });
    if (!guide?.content) {
      await ctx.runMutation(internal.podcasts._failPodcast, {
        guideId: args.guideId,
        error: "content_missing",
      });
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCRIPT_TIMEOUT_MS);

    // Pull every prior guest name once. Re-fetching per attempt would catch
    // concurrent saves, but the save-time race guard in _savePodcastScript
    // covers that case more reliably than a query refresh.
    const forbidden = new Set<string>(
      await ctx.runQuery(internal.careerGuides._getUsedGuestNames, {
        excludeGuideId: args.guideId,
      }),
    );
    const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const forbiddenNorm = new Set([...forbidden].map(normName));

    let lastErr: unknown;
    let success = false;
    for (let attempt = 0; attempt <= SCRIPT_RETRIES; attempt++) {
      try {
        const prompt = buildPodcastScriptPrompt({
          title: guide.title,
          content: guide.content,
          forbiddenGuestNames: [...forbidden],
        });
        const { output } = await generateText({
          model: chatModel(SCRIPT_MODEL_ID, { zdr: true }),
          output: Output.object({ schema: PodcastScriptSchema }),
          prompt,
          abortSignal: controller.signal,
        });

        if (output.dialogue.length < 4) {
          throw new Error("dialogue_too_short");
        }
        if (forbiddenNorm.has(normName(output.guestName))) {
          // LLM ignored the do-not-reuse list. Add the offender so the next
          // attempt's prompt names it explicitly, and retry.
          forbidden.add(output.guestName);
          forbiddenNorm.add(normName(output.guestName));
          throw new Error(`guestName_collision:${output.guestName}`);
        }

        const guestVoice = pickGuestVoice(output.guestGender);

        await ctx.runMutation(internal.podcasts._savePodcastScript, {
          guideId: args.guideId,
          guestName: output.guestName,
          guestRole: output.guestRole,
          guestGender: output.guestGender,
          guestVoice,
          transcript: output.dialogue,
        });

        await ctx.scheduler.runAfter(0, internal.podcastsTts.synthesize, {
          guideId: args.guideId,
        });
        success = true;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        // Don't retry on abort (timeout) — caller can re-trigger.
        if (controller.signal.aborted) break;
        // Save-time race guard threw — treat the same as an in-process
        // collision: add the colliding name and retry.
        if (msg.startsWith("guestName_collision_race:")) {
          const taken = msg.slice("guestName_collision_race:".length);
          if (taken) {
            forbidden.add(taken);
            forbiddenNorm.add(normName(taken));
          }
        }
        console.warn("generateScript:retry", {
          guideId: args.guideId,
          attempt,
          msg,
        });
      }
    }

    clearTimeout(timeout);

    if (!success) {
      console.error("generateScript:failed", {
        guideId: args.guideId,
        err: lastErr,
      });
      await ctx.runMutation(internal.podcasts._failPodcast, {
        guideId: args.guideId,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
    }
    return null;
  },
});
