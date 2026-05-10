import {
  query,
  mutation,
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal, components } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { streamText } from "ai";
import {
  createThread,
  syncStreams,
  DeltaStreamer,
  compressUIMessageChunks,
  vStreamArgs,
} from "@convex-dev/agent";
import { chatModel } from "../lib/ai/providers";
import {
  OUTREACH_MODEL_ID,
  buildOutreachSystemPrompt,
  buildOutreachUserPrompt,
  type OutreachSender,
  type OutreachRecipient,
  type OutreachType,
} from "../lib/ai/prompts/outreach";
import { tryConsumeRateLimit } from "./lib/rateLimit";

// ── Tunables ────────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const STREAM_THROTTLE_MS = 100;
const STREAM_TIMEOUT_MS = 90_000;
const TEMPERATURE = 0.7;

const OUTREACH_TYPE_VALIDATOR = v.union(
  v.literal("discovery"),
  v.literal("career-advice"),
  v.literal("role-inquiry"),
  v.literal("mentorship"),
  v.literal("informational-interview"),
  v.literal("custom"),
);

// ── Auth helper (mirror of careerGuidePersonalizations.ts) ────────────────

const resolveAuthedUser = async (
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
};

// ── Public mutation: start outreach ────────────────────────────────────────

export const startOutreach = mutation({
  args: {
    personId: v.id("key_people"),
    outreachType: OUTREACH_TYPE_VALIDATOR,
    customIntent: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; threadId: string }
    | { ok: false; reason: "anonymous" | "not-found" | "rate-limited"; retryAfterMs?: number }
  > => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { ok: false, reason: "anonymous" };

    const person = await ctx.db.get(args.personId);
    if (!person || person.userId !== user._id) {
      return { ok: false, reason: "not-found" };
    }

    const limit = await tryConsumeRateLimit(ctx, {
      key: `outreach_${user._id}`,
      max: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!limit.ok) {
      return {
        ok: false,
        reason: "rate-limited",
        retryAfterMs: limit.retryAfterMs,
      };
    }

    const threadId = await createThread(ctx, components.agent, {
      title: `Outreach: ${person.name}`,
    });

    await ctx.db.insert("outreach_streams", {
      threadId,
      userId: user._id,
      personId: args.personId,
      outreachType: args.outreachType,
      customIntent: args.customIntent,
      status: "streaming",
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.peopleOutreach._streamOutreach, {
      threadId,
      userId: user._id,
      personId: args.personId,
      outreachType: args.outreachType,
      customIntent: args.customIntent,
    });

    return { ok: true, threadId };
  },
});

// ── Public query: status row for a thread ─────────────────────────────────

export const getOutreach = query({
  args: { threadId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "streaming" | "done" | "error";
    error?: string;
    finalMessage?: string;
    _creationTime: number;
  } | null> => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return null;
    const row = await ctx.db
      .query("outreach_streams")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!row || row.userId !== user._id) return null;
    return {
      status: row.status,
      error: row.error,
      finalMessage: row.finalMessage,
      _creationTime: row._creationTime,
    };
  },
});

// ── Public query: subscribe to streamed UI message chunks ─────────────────

export const listStreams = query({
  args: {
    threadId: v.string(),
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { streams: undefined };
    // Ownership: confirm the thread row belongs to this user before exposing
    // the stream chunks. The Convex Agent component itself doesn't store
    // ownership info, so we gate at the application layer.
    const row = await ctx.db
      .query("outreach_streams")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!row || row.userId !== user._id) return { streams: undefined };

    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
      includeStatuses: ["streaming", "finished"],
    });
    return { streams };
  },
});

// ── Public query: most recent finished draft for a person/type ────────────

export const getMostRecentDraftForPerson = query({
  args: {
    personId: v.id("key_people"),
    outreachType: v.optional(OUTREACH_TYPE_VALIDATOR),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { threadId: string; outreachType: string; finalMessage: string; createdAt: number }
    | null
  > => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return null;
    const rows = await ctx.db
      .query("outreach_streams")
      .withIndex("by_person_user_created", (q) =>
        q.eq("personId", args.personId).eq("userId", user._id),
      )
      .order("desc")
      .collect();
    const matching = rows.find(
      (r) =>
        r.status === "done" &&
        !!r.finalMessage &&
        (args.outreachType === undefined ||
          r.outreachType === args.outreachType),
    );
    if (!matching || !matching.finalMessage) return null;
    return {
      threadId: matching.threadId,
      outreachType: matching.outreachType,
      finalMessage: matching.finalMessage,
      createdAt: matching.createdAt,
    };
  },
});

// ── Internal: read inputs for the action ──────────────────────────────────

export const _readDraftInputs = internalQuery({
  args: { userId: v.id("users"), personId: v.id("key_people") },
  handler: async (ctx, args) => {
    const person = await ctx.db.get(args.personId);
    if (!person || person.userId !== args.userId) return null;

    const guide = await ctx.db.get(person.guideId);
    if (!guide) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const user = await ctx.db.get(args.userId);

    const firstName = user?.name ? user.name.split(/\s+/)[0] : null;
    const currentExperience =
      profile?.experience.find(
        (e) =>
          typeof e.endDate === "string" &&
          e.endDate.toLowerCase() === "present",
      ) ?? profile?.experience[0];

    // Top skills: prefer enrichment's enrichedSkills (canonical + signal),
    // fall back to raw profile skills.
    const enrichedSkills = enrichment?.enrichedSkills
      ?.slice(0, 8)
      .map((s) => s.canonical);
    const topSkills =
      enrichedSkills && enrichedSkills.length > 0
        ? enrichedSkills
        : profile?.skills?.slice(0, 8);

    const sender: OutreachSender = {
      firstName,
      professionalSummary:
        enrichment?.narrativeSummary ?? profile?.summary ?? null,
      currentTitle: profile?.headline ?? currentExperience?.title ?? null,
      currentRole: currentExperience?.title ?? null,
      currentCompany: currentExperience?.company ?? null,
      topSkills,
      cvExcerpt: profile?.rawText ? profile.rawText.slice(0, 800) : null,
    };

    const recipient: OutreachRecipient = {
      name: person.name,
      headline: person.headline,
      currentRole: person.currentRole,
      currentCompany: person.currentCompany,
      profileSummary: person.profileSummary,
      relevanceReason: person.relevanceReason,
    };

    const guideOverview = guide.content?.whyConsider
      ? `The guide describes the role like this: "${guide.content.whyConsider}"`
      : "";
    const sourceContext = `The sender found this person while reading the career guide for ${guide.title}. ${guideOverview}`.trim();

    return { sender, recipient, sourceContext };
  },
});

// ── Internal: persist final state ─────────────────────────────────────────

export const _setFinal = internalMutation({
  args: {
    threadId: v.string(),
    outcome: v.union(
      v.object({ kind: v.literal("done"), finalMessage: v.string() }),
      v.object({ kind: v.literal("error"), error: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("outreach_streams")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!row) return;
    if (args.outcome.kind === "done") {
      await ctx.db.patch(row._id, {
        status: "done",
        finalMessage: args.outcome.finalMessage,
        error: undefined,
      });
    } else {
      await ctx.db.patch(row._id, {
        status: "error",
        error: args.outcome.error.slice(0, 500),
      });
    }
  },
});

// ── Internal action: stream the draft ─────────────────────────────────────

export const _streamOutreach = internalAction({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
    personId: v.id("key_people"),
    outreachType: OUTREACH_TYPE_VALIDATOR,
    customIntent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const inputs = await ctx.runQuery(
      internal.peopleOutreach._readDraftInputs,
      { userId: args.userId, personId: args.personId },
    );
    if (!inputs) {
      await ctx.runMutation(internal.peopleOutreach._setFinal, {
        threadId: args.threadId,
        outcome: { kind: "error", error: "Person or profile data missing" },
      });
      return;
    }

    const streamer = new DeltaStreamer(
      components.agent,
      ctx,
      {
        throttleMs: STREAM_THROTTLE_MS,
        onAsyncAbort: async (reason) => {
          console.error(
            `peopleOutreach._streamOutreach:async_abort: ${reason}`,
          );
        },
        abortSignal: undefined,
        compress: compressUIMessageChunks,
      },
      {
        threadId: args.threadId,
        format: "UIMessageChunk",
        order: 0,
        stepOrder: 0,
        userId: undefined,
      },
    );

    const timeoutController = new AbortController();
    const onTimeout = setTimeout(
      () => timeoutController.abort(),
      STREAM_TIMEOUT_MS,
    );
    const onStreamerAbort = () => timeoutController.abort();
    streamer.abortController.signal.addEventListener(
      "abort",
      onStreamerAbort,
    );

    const buffered: string[] = [];
    let textCollectError: Error | null = null;

    try {
      const result = streamText({
        model: chatModel(OUTREACH_MODEL_ID, { zdr: true }),
        system: buildOutreachSystemPrompt(),
        prompt: buildOutreachUserPrompt({
          sender: inputs.sender,
          recipient: inputs.recipient,
          sourceContext: inputs.sourceContext,
          outreachType: args.outreachType as OutreachType,
          customIntent: args.customIntent,
        }),
        temperature: TEMPERATURE,
        abortSignal: timeoutController.signal,
        onError: ({ error }) => {
          textCollectError =
            error instanceof Error
              ? error
              : new Error(typeof error === "string" ? error : "stream error");
        },
      });

      // Tee the UI message stream into the agent component (for live
      // subscribers via syncStreams) and a parallel collector that builds
      // up the final message text. We can't await `result.text` *and*
      // pass `result.toUIMessageStream()` to consumeStream, both consume
      // the same underlying stream, so we capture text from the chunk
      // stream as it flows.
      const uiStream = result.toUIMessageStream();
      const [forStreamer, forCapture] = uiStream.tee();
      const consumePromise = streamer.consumeStream(forStreamer);

      // Capture text-delta chunks so we can persist a `finalMessage` for
      // revisits without having to replay the live stream.
      const reader = forCapture.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && typeof value === "object" && "type" in value) {
            const chunk = value as {
              type: string;
              delta?: string;
              text?: string;
            };
            if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
              buffered.push(chunk.delta);
            } else if (
              chunk.type === "text" &&
              typeof chunk.text === "string"
            ) {
              buffered.push(chunk.text);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      await consumePromise;

      if (textCollectError) throw textCollectError;

      const finalMessage = buffered.join("").trim();
      if (!finalMessage) {
        throw new Error("Model returned an empty message");
      }

      await ctx.runMutation(internal.peopleOutreach._setFinal, {
        threadId: args.threadId,
        outcome: { kind: "done", finalMessage },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to draft outreach";
      console.error("peopleOutreach._streamOutreach:failed", {
        threadId: args.threadId,
        message,
      });
      try {
        await streamer.fail(message);
      } catch {
        // Streamer may already be closed by the failure; ignore.
      }
      await ctx.runMutation(internal.peopleOutreach._setFinal, {
        threadId: args.threadId,
        outcome: { kind: "error", error: message },
      });
    } finally {
      clearTimeout(onTimeout);
      streamer.abortController.signal.removeEventListener(
        "abort",
        onStreamerAbort,
      );
    }
  },
});
