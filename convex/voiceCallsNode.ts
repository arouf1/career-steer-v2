"use node";

/**
 * Realtime AI voice "deep dive" — Node runtime.
 *
 * Two responsibilities:
 *
 *   1. mintSession (action): mint a Gemini Live ephemeral token (with API-key
 *      fallback per V1 commit 0689253), assemble the system instructions
 *      from profile + guide + citations, and create the persisted row before
 *      handing the credentials back to the browser.
 *   2. processCallAnalysis (internalAction): scheduled by voiceCalls.finalize
 *      after a successful call. Generates a structured summary (Gemini 3
 *      Flash via OpenRouter) and three semantic embeddings, then patches the
 *      call row.
 *
 * Live audio runs entirely browser↔Gemini Live; this file never sees PCM.
 */

import {
  action,
  internalAction,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { GoogleGenAI } from "@google/genai";
import { generateText, Output } from "ai";
import { chatModel, embedBatch } from "../lib/ai/providers";
import {
  DeepDiveSummarySchema,
  VOICE_SUMMARY_MODEL_ID,
  type DeepDiveSummary,
} from "../lib/ai/prompts/voiceAdviser";
import {
  aggregateGuideCitations,
  buildGuideContextForVoice,
  buildProfileSnapshotForVoice,
  buildSystemInstructions,
} from "./voiceCallContext";

// Per the plan: "verify the current Live model ID at implementation time".
// 2026-05 — Gemini 3.x Live "preview" lineage. If Google rotates this, the
// model field on the voice_calls row captures whatever was active at session
// start, so we can spot drift in production data.
const LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = "Aoede";
const TOKEN_USES = 1; // single-use; the WebSocket consumes the token on connect
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min hard limit
const NEW_SESSION_TTL_MS = 2 * 60 * 1000; // 2 min to first WS handshake

const ANALYSIS_TIMEOUT_MS = 60_000;
const SUMMARY_TEMPERATURE = 0.3;

// ── mintSession: the only entry point the client calls before opening the
// WebSocket to Gemini. Auth-gated, returns either ephemeral or apiKey
// credentials so the client knows which baseUrl + auth-param shape to use.

export const mintSession = action({
  args: {
    guideId: v.id("career_guides"),
    region: v.union(v.literal("us"), v.literal("uk")),
    voiceId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      callId: v.id("voice_calls"),
      sessionId: v.string(),
      auth: v.object({
        type: v.union(v.literal("ephemeral_token"), v.literal("api_key")),
        value: v.string(),
      }),
      sessionConfig: v.object({
        model: v.string(),
        voice: v.string(),
        systemInstruction: v.string(),
      }),
    }),
    v.object({
      ok: v.literal(false),
      reason: v.union(
        v.literal("anonymous"),
        v.literal("guide-not-found"),
        v.literal("guide-not-ready"),
        v.literal("no-api-key"),
        v.literal("mint-failed"),
      ),
    }),
  ),
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<
    | {
        ok: true;
        callId: Id<"voice_calls">;
        sessionId: string;
        auth: { type: "ephemeral_token" | "api_key"; value: string };
        sessionConfig: { model: string; voice: string; systemInstruction: string };
      }
    | {
        ok: false;
        reason:
          | "anonymous"
          | "guide-not-found"
          | "guide-not-ready"
          | "no-api-key"
          | "mint-failed";
      }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, reason: "anonymous" };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("voiceCallsNode.mintSession: GEMINI_API_KEY missing");
      return { ok: false, reason: "no-api-key" };
    }

    // Pull everything we need to assemble the prompt. Each of these queries
    // is cheap (single-doc lookups + bounded fan-outs); inline rather than
    // a single composite query because they're independently reusable.
    // Lives in voiceCalls.ts (V8 runtime) — internalQuery can't be defined
    // in a "use node" file.
    const bundle = await ctx.runQuery(
      internal.voiceCalls._gatherSessionContext,
      { guideId: args.guideId, tokenIdentifier: identity.tokenIdentifier },
    );
    if (!bundle) return { ok: false, reason: "anonymous" };
    if (!bundle.guide) return { ok: false, reason: "guide-not-found" };
    if (bundle.guide.contentStatus !== "complete" || !bundle.guide.content) {
      return { ok: false, reason: "guide-not-ready" };
    }

    const guideCtx = buildGuideContextForVoice({
      guide: bundle.guide,
      region: args.region,
    });
    if (!guideCtx) return { ok: false, reason: "guide-not-ready" };

    const profileCtx = buildProfileSnapshotForVoice({
      user: bundle.user,
      enrichment: bundle.enrichment,
      profile: bundle.profile,
    });

    const citations = aggregateGuideCitations({
      guide: bundle.guide,
      branches: bundle.branches,
      personalization: bundle.personalization,
    });

    const systemInstruction = buildSystemInstructions({
      guide: guideCtx,
      profile: profileCtx,
      citations,
    });

    const voiceId = args.voiceId ?? DEFAULT_VOICE;

    // Mint the credential. Try ephemeral first (preferred — single-use,
    // short-lived, scoped to this session); fall back to API key if Google's
    // auth_tokens endpoint returns an error. V1 commit 0689253 documented
    // that this fallback is needed in practice.
    //
    // We deliberately do NOT pass `liveConnectConstraints`. Yesterday's
    // 22ee91c locked model + voice at mint to stop voice rotation, but the
    // v1alpha BidiGenerateContentConstrained endpoint then started rejecting
    // our full client setup with WS close 1011 "Internal error encountered"
    // — the constrained endpoint is strict about overlap between locked
    // fields and the client setup payload, and we send a lot of additional
    // setup (tools, transcription, VAD, contextWindowCompression, etc.).
    // Rolling back to no-constraints lets the call connect; voice rotation
    // is the lesser of two evils.
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    let credential: { type: "ephemeral_token" | "api_key"; value: string };
    let authMode: "ephemeral" | "apiKey";
    try {
      const token = await client.authTokens.create({
        config: {
          uses: TOKEN_USES,
          expireTime: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
          newSessionExpireTime: new Date(
            Date.now() + NEW_SESSION_TTL_MS,
          ).toISOString(),
        },
      });
      if (!token.name) throw new Error("empty_token_name");
      credential = { type: "ephemeral_token", value: token.name };
      authMode = "ephemeral";
    } catch (err) {
      console.warn(
        "voiceCallsNode.mintSession: ephemeral mint failed, falling back to API key",
        err instanceof Error ? err.message : String(err),
      );
      credential = { type: "api_key", value: apiKey };
      authMode = "apiKey";
    }
    const sessionId = crypto.randomUUID();
    const title = `Talking through: ${bundle.guide.title}`;

    const callId = await ctx.runMutation(internal.voiceCalls._createSession, {
      userId: bundle.user._id,
      guideId: args.guideId,
      sessionId,
      title,
      voiceId,
      model: LIVE_MODEL,
      authMode,
    });

    return {
      ok: true,
      callId,
      sessionId,
      auth: credential,
      sessionConfig: {
        model: LIVE_MODEL,
        voice: voiceId,
        systemInstruction,
      },
    };
  },
});

// ── processCallAnalysis: scheduled from voiceCalls.finalize when a call
// completes. Pulls the transcript, asks Gemini Flash for a structured
// summary, embeds three views of the conversation, and patches the row.

export const processCallAnalysis = internalAction({
  args: { callId: v.id("voice_calls") },
  returns: v.null(),
  handler: async (ctx: ActionCtx, args) => {
    const call = await ctx.runQuery(internal.voiceCalls._getCallById, {
      callId: args.callId,
    });
    if (!call) {
      console.warn("processCallAnalysis: call vanished", args.callId);
      return null;
    }
    if (call.messages.length < 2) {
      console.warn("processCallAnalysis: too few messages, skipping", args.callId);
      return null;
    }

    const transcriptText = formatTranscript(call.messages);
    const userTurns = call.messages.filter((m) => m.role === "user").length;
    const assistantTurns = call.messages.length - userTurns;
    const durationMin = Math.max(1, Math.round(call.totalDurationSeconds / 60));

    const summaryPrompt = buildAnalysisPrompt({
      title: call.title,
      durationMin,
      userTurns,
      assistantTurns,
      transcript: transcriptText,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
    let summary: DeepDiveSummary | null = null;
    try {
      const { output } = await generateText({
        model: chatModel(VOICE_SUMMARY_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: DeepDiveSummarySchema }),
        prompt: summaryPrompt,
        temperature: SUMMARY_TEMPERATURE,
        abortSignal: controller.signal,
      });
      summary = output;
    } catch (err) {
      console.error("processCallAnalysis: summary generation failed", {
        callId: args.callId,
        err: err instanceof Error ? err.message : String(err),
      });
      // Soft-fail: don't poison the row. The call's transcript is still
      // there for manual inspection / a retry job later.
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (!summary) return null;

    const keyTopicsJoined = summary.keyTopics.join(" • ") || summary.title;
    let vectors: number[][];
    try {
      vectors = await embedBatch([
        { text: transcriptText, taskHint: "sentence similarity" },
        { text: summary.summary, taskHint: "sentence similarity" },
        { text: keyTopicsJoined, taskHint: "sentence similarity" },
      ]);
    } catch (err) {
      console.error("processCallAnalysis: embedding failed", {
        callId: args.callId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const [conversationEmbedding, summaryEmbedding, keyTopicsEmbedding] =
      vectors;

    await ctx.runMutation(internal.voiceCalls._patchAnalysis, {
      callId: args.callId,
      aiSummary: summary,
      conversationEmbedding,
      summaryEmbedding,
      keyTopicsEmbedding,
      title: summary.title,
    });

    return null;
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────

type StoredMessage = Doc<"voice_calls">["messages"][number];

function formatTranscript(messages: StoredMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Adviser"}: ${m.content}`)
    .join("\n");
}

function buildAnalysisPrompt(args: {
  title: string;
  durationMin: number;
  userTurns: number;
  assistantTurns: number;
  transcript: string;
}): string {
  return `You are analysing a transcript of a 1-on-1 voice "deep dive" career conversation between a user and an AI career adviser. Produce a structured summary that the user can revisit later.

Conversation: "${args.title}"
Duration: ~${args.durationMin} minutes
Turn counts: user ${args.userTurns}, adviser ${args.assistantTurns}

Guidelines for your output:
- Address the user directly ("you said…", "you wondered…") rather than third-person.
- British English; calm, neutral tone — no emojis.
- "title" should be a natural-language headline of ~6-10 words about what the conversation was actually about.
- "summary" is 2-3 sentences. State what was discussed and any decisions reached.
- "insights" lists genuine learnings — things the user *discovered* during the call. Skip generic platitudes.
- "actionPoints" should be concrete and grounded in what was actually said. If nothing actionable came up, return an empty array. Cap at five.
- "keyTopics" are short noun phrases (e.g. "salary expectations", "portfolio gaps", "career pivot to UX research"). Aim for 3-7.
- "guideRelevance" answers: did the conversation actually engage with the career path the user came in to discuss, or did it drift?

Transcript:
${args.transcript}`;
}
