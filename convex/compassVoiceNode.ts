"use node";

/**
 * Career Compass voice assistant — Node runtime.
 *
 * Mirrors voiceCallsNode.ts (per-guide call). The browser opens its own
 * WebSocket directly to Gemini Live; this action just (a) gathers the
 * canvas-flavoured context, (b) mints an ephemeral token (with API-key
 * fallback per V1 commit 0689253), (c) creates the persisted row in
 * "active" state, (d) returns credentials to the browser.
 *
 * Post-call analysis is shared with the per-guide path:
 * voiceCallsNode.processCallAnalysis is keyed on callId, doesn't care which
 * surface produced the row, so finalize() will schedule it for compass
 * calls just like guide calls.
 */

import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { GoogleGenAI } from "@google/genai";
import {
  buildProfileSnapshotForVoice,
  buildCanvasSnapshotForVoice,
  buildSavedGuideSet,
  aggregateCompassCitations,
} from "./compassVoiceContext";
import {
  compassAdviserPrompt,
  compassAdviserTools,
} from "../lib/ai/prompts/compassAdviser";

// Same Gemini Live model + voice defaults as the per-guide path. If we ever
// rotate one, doing the swap in both files at once keeps the surfaces in
// sync; deliberately not extracted to a shared constant because that would
// hide the dependency between the two surfaces' configs.
const LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = "Aoede";
const TOKEN_USES = 1;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const NEW_SESSION_TTL_MS = 2 * 60 * 1000;

const DENSITY_VALIDATOR = v.union(
  v.literal("focused"),
  v.literal("explore"),
  v.literal("wide"),
);

const SURFACE_VALIDATOR = v.union(
  v.literal("desktop"),
  v.literal("mobile"),
);

const LANE_VALIDATOR = v.union(
  v.literal("linear"),
  v.literal("adjacent"),
  v.literal("earlier"),
  v.literal("transformational"),
);

export const mintCompassSession = action({
  args: {
    voiceId: v.optional(v.string()),
    // Current density on the user's canvas at the moment of call start.
    // Determines which cards (curated only / +extras / all visible) get
    // injected into the system prompt. Defaults to "focused" if absent so
    // older clients still mint successfully.
    densityLevel: v.optional(DENSITY_VALIDATOR),
    // Device surface — determines which tools get declared (setDensity is
    // desktop-only, goToLane mobile-only) and how the prompt frames
    // navigation verbs. Defaults to "desktop".
    surface: v.optional(SURFACE_VALIDATOR),
    // Mobile only — which lane is currently in the pager view. Updated
    // mid-call via clientContent pushes from the hook when the user swipes.
    activeLane: v.optional(LANE_VALIDATOR),
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
        // Plain JSON `Tool[]` array, shipped verbatim into Gemini Live's
        // setup message. Validated by the SDK on Google's side; we don't
        // re-validate the shape here.
        tools: v.array(v.any()),
      }),
    }),
    v.object({
      ok: v.literal(false),
      reason: v.union(
        v.literal("anonymous"),
        v.literal("canvas-not-ready"),
        v.literal("no-api-key"),
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
        sessionConfig: {
          model: string;
          voice: string;
          systemInstruction: string;
          tools: unknown[];
        };
      }
    | { ok: false; reason: "anonymous" | "canvas-not-ready" | "no-api-key" }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, reason: "anonymous" };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("compassVoiceNode.mintCompassSession: GEMINI_API_KEY missing");
      return { ok: false, reason: "no-api-key" };
    }

    const bundle = await ctx.runQuery(
      internal.compassVoice._gatherCompassContext,
      { tokenIdentifier: identity.tokenIdentifier },
    );
    if (!bundle) return { ok: false, reason: "anonymous" };
    if (!bundle.canvas) {
      // Canvas hasn't been generated yet (or is in `generating` / `failed`).
      // The dock should disable itself in this state, but defend on the
      // server boundary too so a stale browser click doesn't mint a useless
      // session against a non-existent compass.
      return { ok: false, reason: "canvas-not-ready" };
    }

    const guidesById = new Map(bundle.guides.map((g) => [g._id, g]));
    const savedGuideIds = buildSavedGuideSet(bundle.reactions);

    const density = args.densityLevel ?? "focused";
    const canvasCtx = buildCanvasSnapshotForVoice({
      canvas: bundle.canvas,
      guidesById,
      savedGuideIds,
      density,
    });

    const profileCtx = buildProfileSnapshotForVoice({
      user: bundle.user,
      enrichment: bundle.enrichment,
      profile: bundle.profile,
    });

    const citations = aggregateCompassCitations({ guides: bundle.guides });

    const pivots = bundle.enrichment?.pivots ?? [];

    const surface = args.surface ?? "desktop";
    const dismissed = (
      bundle.dismissedGuides as Array<{
        guideId: Id<"career_guides">;
        title: string;
      }> | undefined
    )?.map((d) => ({ guideId: d.guideId as string, title: d.title })) ?? [];
    const systemInstruction = compassAdviserPrompt({
      canvas: canvasCtx,
      profile: profileCtx,
      pivots,
      citations,
      densityLevel: density,
      surface,
      activeLane: args.activeLane,
      dismissed,
    });

    const voiceId = args.voiceId ?? DEFAULT_VOICE;

    // Mint credentials — try ephemeral first, fall back to raw API key per
    // V1 commit 0689253. Gemini's auth_tokens endpoint occasionally flakes;
    // the fallback keeps calls working when it does.
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
        "compassVoiceNode.mintCompassSession: ephemeral mint failed, falling back to API key",
        err instanceof Error ? err.message : String(err),
      );
      credential = { type: "api_key", value: apiKey };
      authMode = "apiKey";
    }

    const sessionId = crypto.randomUUID();
    const title = "Talking through your compass";

    const callId = await ctx.runMutation(
      internal.compassVoice._createCompassSession,
      {
        userId: bundle.user._id,
        canvasSnapshotId: bundle.canvas._id,
        sessionId,
        title,
        voiceId,
        model: LIVE_MODEL,
        authMode,
      },
    );

    return {
      ok: true,
      callId,
      sessionId,
      auth: credential,
      sessionConfig: {
        model: LIVE_MODEL,
        voice: voiceId,
        systemInstruction,
        tools: compassAdviserTools(surface),
      },
    };
  },
});

