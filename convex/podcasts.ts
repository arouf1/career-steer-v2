import { ConvexError, v } from "convex/values";
import { generateText, Output } from "ai";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { chatModel } from "../lib/ai/providers";
import {
  EpisodeTitleSchema,
  PodcastScriptSchema,
  buildEpisodeTitleBackfillPrompt,
  buildPodcastScriptPrompt,
} from "../lib/ai/prompts/podcast";
import {
  PersonaTraitsSchema,
  buildPersonaTraitsPrompt,
  type PersonaTraits,
} from "../lib/ai/prompts/podcastPersona";
import { HOST, pickGuestVoice } from "../lib/podcast/voices";

// Gemini 3.1 Pro Preview was returning 200 OK with zero usage and an empty
// body for some podcast prompts (OpenRouter routing dropped the upstream
// call before reaching Google). Use the GA Gemini 2.5 Pro for podcast
// scripts — it's fully released and stable for our prompt sizes.
const SCRIPT_MODEL_ID = "google/gemini-2.5-pro";
const SCRIPT_TIMEOUT_MS = 180_000;
// Stage A (persona traits) is a small structured call (~800 in / ~300 out
// tokens) — usually 1-2s. Cap at 60s so a single hung request can't gate
// the more expensive script call below.
const PERSONA_TIMEOUT_MS = 60_000;
const SCRIPT_RETRIES = 2; // total tries = SCRIPT_RETRIES + 1
// Caps script-regen cycles per guide. The cron sweeper (_retryFailedPodcasts)
// uses the same constant to decide eligibility, so each failed guide gets up
// to MAX_ATTEMPTS - 1 cron-driven retry cycles beyond the original trigger.
// Synthesize-only retries (when transcript is already saved) don't bump
// attempts and so don't count against this cap.
const MAX_ATTEMPTS = 5;
// Stuck-job cutoff: a podcast in `scripting` or `synthesizing` longer than
// this is treated as crashed mid-action. Comfortably above SCRIPT_TIMEOUT_MS
// (3 min) + TTS_TIMEOUT_MS (6 min).
const PODCAST_RETRY_STUCK_CUTOFF_MS = 15 * 60 * 1000;
// Stagger between retries the cron schedules in one tick — avoids hammering
// Gemini TTS / OpenRouter when many guides need recovery at once.
const PODCAST_RETRY_STAGGER_MS = 5_000;

const transcriptValidator = v.array(
  v.object({
    speaker: v.union(v.literal("host"), v.literal("guest")),
    text: v.string(),
  }),
);

// Mirror of career_guides.podcast.personaTraits in convex/schema.ts. Reused
// by _savePodcastScript args and any future mutations that touch the field.
const personaTraitsValidator = v.object({
  archetypeLabel: v.string(),
  functionalAreaInferred: v.string(),
  traitPrior: v.object({
    extraversion: v.number(),
    conscientiousness: v.number(),
    openness: v.number(),
    warmth: v.number(),
    formality: v.number(),
  }),
  speakingStyle: v.object({
    energy: v.union(
      v.literal("measured"),
      v.literal("animated"),
      v.literal("reserved"),
      v.literal("expressive"),
    ),
    vocabulary: v.union(
      v.literal("precise-technical"),
      v.literal("accessible-plain"),
      v.literal("industry-jargon"),
      v.literal("casual-conversational"),
    ),
    sentenceLength: v.union(
      v.literal("short"),
      v.literal("medium"),
      v.literal("flowing"),
    ),
    humorFrequency: v.union(
      v.literal("rare"),
      v.literal("occasional"),
      v.literal("frequent"),
    ),
    anecdoteStyle: v.union(
      v.literal("data-grounded"),
      v.literal("human-stories"),
      v.literal("process-oriented"),
      v.literal("metaphor-heavy"),
    ),
  }),
  toneDirection: v.string(),
});

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
        episodeTitle: prev?.episodeTitle,
        hasJingle: prev?.hasJingle,
        guestVoice: prev?.guestVoice,
        guestName: prev?.guestName,
        guestRole: prev?.guestRole,
        guestGender: prev?.guestGender,
        transcript: prev?.transcript,
        personaTraits: prev?.personaTraits,
      },
      updatedAt: Date.now(),
    });
    return { ok: true as const, attempts };
  },
});

export const _savePodcastScript = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    episodeTitle: v.string(),
    guestName: v.string(),
    guestRole: v.string(),
    guestGender: v.union(v.literal("female"), v.literal("male")),
    guestVoice: v.string(),
    transcript: transcriptValidator,
    personaTraits: v.optional(personaTraitsValidator),
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
        episodeTitle: args.episodeTitle,
        transcript: args.transcript,
        // If Stage A succeeded this attempt, args.personaTraits is set and
        // overwrites whatever (if anything) was carried from a prior run.
        // If Stage A failed, fall through to whatever the prior run saved
        // so we still have *some* persona signal at TTS time.
        personaTraits: args.personaTraits ?? prev?.personaTraits,
        attempts: prev?.attempts ?? 1,
        audioStorageId: prev?.audioStorageId,
        durationSeconds: prev?.durationSeconds,
        hasJingle: prev?.hasJingle,
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
        episodeTitle: prev?.episodeTitle,
        hasJingle: prev?.hasJingle,
        guestVoice: prev?.guestVoice,
        guestName: prev?.guestName,
        guestRole: prev?.guestRole,
        guestGender: prev?.guestGender,
        transcript: prev?.transcript,
        personaTraits: prev?.personaTraits,
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
        episodeTitle: undefined,
        hasJingle: undefined,
        guestVoice: undefined,
        guestName: undefined,
        guestRole: undefined,
        guestGender: undefined,
        transcript: undefined,
        personaTraits: undefined,
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

    // Stage A — career-aware persona prior. Runs once before the retry loop
    // so script retries are anchored to the same persona instead of
    // rerolling it. Soft-fails: on error, traits stay undefined and both
    // prompts fall through to their generic legacy paths. Isolated
    // AbortController so a Stage A timeout cannot poison the script loop.
    let personaTraits: PersonaTraits | undefined;
    {
      const personaController = new AbortController();
      const personaTimeout = setTimeout(
        () => personaController.abort(),
        PERSONA_TIMEOUT_MS,
      );
      try {
        const { output } = await generateText({
          model: chatModel(SCRIPT_MODEL_ID, { zdr: true }),
          output: Output.object({ schema: PersonaTraitsSchema }),
          prompt: buildPersonaTraitsPrompt({
            title: guide.title,
            content: guide.content,
          }),
          abortSignal: personaController.signal,
        });
        personaTraits = output;
      } catch (err) {
        console.warn("generatePersonaTraits:failed", {
          guideId: args.guideId,
          msg: err instanceof Error ? err.message : String(err),
        });
      } finally {
        clearTimeout(personaTimeout);
      }
    }

    let lastErr: unknown;
    let success = false;
    for (let attempt = 0; attempt <= SCRIPT_RETRIES; attempt++) {
      try {
        const prompt = buildPodcastScriptPrompt({
          title: guide.title,
          content: guide.content,
          forbiddenGuestNames: [...forbidden],
          personaTraits,
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

        const guestVoice = pickGuestVoice(output.guestGender, personaTraits);

        await ctx.runMutation(internal.podcasts._savePodcastScript, {
          guideId: args.guideId,
          episodeTitle: output.episodeTitle,
          guestName: output.guestName,
          guestRole: output.guestRole,
          guestGender: output.guestGender,
          guestVoice,
          transcript: output.dialogue,
          personaTraits,
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

// ── Backfill: invent an episodeTitle for podcasts recorded before the field
//    existed. LLM-only, no TTS regen. Skips guides that already have a title
//    unless `force` is true.

// Marks a guide's podcast as jingled. Called by both synthesize (always true
// post-jingle-rollout) and the prependJingleToExisting backfill, so the
// hasJingle flag is the single source of truth for "is the jingle in this
// audio file already".
export const _markJingled = internalMutation({
  args: { guideId: v.id("career_guides") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide?.podcast) return null;
    await ctx.db.patch(args.guideId, {
      podcast: { ...guide.podcast, hasJingle: true },
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const _listGuidesNeedingJingleBackfill = internalQuery({
  args: { force: v.boolean() },
  returns: v.array(v.object({ id: v.id("career_guides"), slug: v.string() })),
  handler: async (ctx, args) => {
    const all = await ctx.db.query("career_guides").collect();
    return all
      .filter(
        (g) =>
          g.podcast?.status === "complete" &&
          g.podcast?.audioStorageId &&
          (args.force || !g.podcast?.hasJingle),
      )
      .map((g) => ({ id: g._id, slug: g.slug }));
  },
});

// One-shot ops helper: prepends the jingle to every complete-podcast guide
// that hasn't been jingled yet. Fans out in parallel; per-guide failures are
// surfaced in the result list rather than aborting the batch.
export const backfillAllJingles = internalAction({
  args: { force: v.optional(v.boolean()) },
  returns: v.array(
    v.object({
      slug: v.string(),
      ok: v.boolean(),
      result: v.string(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ slug: string; ok: boolean; result: string }>> => {
    const targets: Array<{ id: string; slug: string }> = await ctx.runQuery(
      internal.podcasts._listGuidesNeedingJingleBackfill,
      { force: args.force ?? false },
    );
    const results = await Promise.all(
      targets.map(async (t): Promise<{ slug: string; ok: boolean; result: string }> => {
        try {
          const r: { previousDurationSeconds: number; newDurationSeconds: number } =
            await ctx.runAction(internal.podcastsTts.prependJingleToExisting, {
              guideId: t.id as never,
            });
          return {
            slug: t.slug,
            ok: true,
            result: `${r.previousDurationSeconds.toFixed(1)}s → ${r.newDurationSeconds.toFixed(1)}s`,
          };
        } catch (err) {
          return {
            slug: t.slug,
            ok: false,
            result: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    return results;
  },
});

export const _patchEpisodeTitle = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    episodeTitle: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide?.podcast) return null;
    await ctx.db.patch(args.guideId, {
      podcast: { ...guide.podcast, episodeTitle: args.episodeTitle },
      updatedAt: Date.now(),
    });
    return null;
  },
});

// One-shot ops helper: finds every complete-podcast guide still missing an
// episodeTitle and fans the per-guide backfill out in parallel. Returns a
// per-guide outcome list. Force=true regenerates titles even when present.
export const backfillAllEpisodeTitles = internalAction({
  args: { force: v.optional(v.boolean()) },
  returns: v.array(
    v.object({
      slug: v.string(),
      ok: v.boolean(),
      result: v.string(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ slug: string; ok: boolean; result: string }>> => {
    const targets: Array<{ id: string; slug: string }> = await ctx.runQuery(
      internal.podcasts._listGuidesNeedingTitleBackfill,
      { force: args.force ?? false },
    );
    const results = await Promise.all(
      targets.map(async (t): Promise<{ slug: string; ok: boolean; result: string }> => {
        try {
          const r: { ok: boolean; episodeTitle?: string; reason?: string } =
            await ctx.runAction(internal.podcasts.backfillEpisodeTitle, {
              guideId: t.id as never,
              force: args.force,
            });
          return r.ok
            ? { slug: t.slug, ok: true, result: r.episodeTitle ?? "" }
            : { slug: t.slug, ok: false, result: r.reason ?? "unknown" };
        } catch (err) {
          return {
            slug: t.slug,
            ok: false,
            result: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    return results;
  },
});

export const _listGuidesNeedingTitleBackfill = internalQuery({
  args: { force: v.boolean() },
  returns: v.array(v.object({ id: v.id("career_guides"), slug: v.string() })),
  handler: async (ctx, args) => {
    const all = await ctx.db.query("career_guides").collect();
    return all
      .filter(
        (g) =>
          g.podcast?.status === "complete" &&
          (args.force || !g.podcast?.episodeTitle),
      )
      .map((g) => ({ id: g._id, slug: g.slug }));
  },
});

export const backfillEpisodeTitle = internalAction({
  args: {
    guideId: v.id("career_guides"),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), episodeTitle: v.string() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; episodeTitle: string }
    | { ok: false; reason: string }
  > => {
    const guide: {
      title: string;
      podcast?: {
        episodeTitle?: string;
        guestName?: string;
        guestRole?: string;
        transcript?: { speaker: "host" | "guest"; text: string }[];
      };
    } | null = await ctx.runQuery(internal.careerGuides._getById, {
      guideId: args.guideId,
    });
    if (!guide?.podcast?.transcript || !guide.podcast.guestName || !guide.podcast.guestRole) {
      return { ok: false as const, reason: "podcast_not_ready" };
    }
    if (guide.podcast.episodeTitle && !args.force) {
      return { ok: false as const, reason: "already_has_title" };
    }

    const prompt = buildEpisodeTitleBackfillPrompt({
      title: guide.title,
      guestName: guide.podcast.guestName,
      guestRole: guide.podcast.guestRole,
      transcript: guide.podcast.transcript,
    });
    const { output } = await generateText({
      model: chatModel(SCRIPT_MODEL_ID, { zdr: true }),
      output: Output.object({ schema: EpisodeTitleSchema }),
      prompt,
    });
    const episodeTitle = output.episodeTitle.trim().replace(/^"|"$/g, "");
    if (!episodeTitle) {
      return { ok: false as const, reason: "empty_title" };
    }
    await ctx.runMutation(internal.podcasts._patchEpisodeTitle, {
      guideId: args.guideId,
      episodeTitle,
    });
    return { ok: true as const, episodeTitle };
  },
});

// ── Cron sweeper: recover failed and stuck podcasts ────────────────────────
//
// Mirrors `careerGuides._retryFailedGuides` and `discover.sweepFailedSnapshots`.
// Picks up `career_guides.podcast` rows that are either `failed` or stuck mid-
// pipeline (`scripting`/`synthesizing` and not updated for >15 min, indicating
// a crashed action where `_failPodcast` never ran), and reschedules them as
// long as `attempts < MAX_ATTEMPTS`. Routed via `convex/crons.ts`.

export const _listFailedAndStuckPodcasts = internalQuery({
  args: { stuckCutoffMs: v.number() },
  returns: v.array(
    v.object({
      guideId: v.id("career_guides"),
      slug: v.string(),
      title: v.string(),
      status: v.union(
        v.literal("failed"),
        v.literal("scripting"),
        v.literal("synthesizing"),
      ),
      attempts: v.number(),
      hasFullScript: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.stuckCutoffMs;
    // Full-table scan: career_guides is a curated catalog (~18 rows today)
    // and `podcast.status` is a nested field with no Convex index option.
    // Promote `podcast.status` to a top-level field + add `by_podcast_status`
    // if the catalog ever exceeds ~5k rows.
    const all = await ctx.db.query("career_guides").collect();
    const out: Array<{
      guideId: Id<"career_guides">;
      slug: string;
      title: string;
      status: "failed" | "scripting" | "synthesizing";
      attempts: number;
      hasFullScript: boolean;
    }> = [];
    for (const g of all) {
      const p = g.podcast;
      if (!p) continue;
      if (p.attempts >= MAX_ATTEMPTS) continue;
      const isFailed = p.status === "failed";
      const isStuck =
        (p.status === "scripting" || p.status === "synthesizing") &&
        g.updatedAt < cutoff;
      if (!isFailed && !isStuck) continue;
      const hasFullScript = !!(
        p.transcript?.length &&
        p.guestVoice &&
        p.guestName &&
        p.guestRole &&
        p.guestGender &&
        p.episodeTitle
      );
      out.push({
        guideId: g._id,
        slug: g.slug,
        title: g.title,
        status: p.status as "failed" | "scripting" | "synthesizing",
        attempts: p.attempts,
        hasFullScript,
      });
    }
    return out;
  },
});

export const _retryFailedPodcasts = internalAction({
  args: {},
  returns: v.object({
    scanned: v.number(),
    scheduledScript: v.number(),
    scheduledSynthesize: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    scanned: number;
    scheduledScript: number;
    scheduledSynthesize: number;
  }> => {
    const candidates = await ctx.runQuery(
      internal.podcasts._listFailedAndStuckPodcasts,
      { stuckCutoffMs: PODCAST_RETRY_STUCK_CUTOFF_MS },
    );
    let scheduledScript = 0;
    let scheduledSynthesize = 0;
    for (const c of candidates) {
      const delay =
        (scheduledScript + scheduledSynthesize) * PODCAST_RETRY_STAGGER_MS;
      // Smart entry-point routing. When the script + guest cast are already
      // saved (the common case for transient TTS failures, e.g. "fetch failed"
      // from the Gemini upload), re-run synthesize directly. This skips a
      // wasted script regeneration and does not bump `attempts`, so transient
      // TTS blips don't burn through the retry cap.
      if (c.hasFullScript) {
        await ctx.scheduler.runAfter(delay, internal.podcastsTts.synthesize, {
          guideId: c.guideId,
        });
        scheduledSynthesize++;
      } else {
        await ctx.scheduler.runAfter(delay, internal.podcasts.generateScript, {
          guideId: c.guideId,
        });
        scheduledScript++;
      }
      console.log("podcast-retry:scheduled", {
        slug: c.slug,
        status: c.status,
        attempts: c.attempts,
        entry: c.hasFullScript ? "synthesize" : "generateScript",
      });
    }
    return {
      scanned: candidates.length,
      scheduledScript,
      scheduledSynthesize,
    };
  },
});
