"use node";

/**
 * Per-job-posting voice assistant. Node runtime.
 *
 * Mirrors voiceCallsNode.ts (per-guide) and compassVoiceNode.ts (per-canvas).
 * The browser opens its own WebSocket directly to Gemini Live; this action
 * just (a) gathers the job-flavoured context, (b) mints an ephemeral token
 * (with API-key fallback per V1 commit 0689253), (c) creates the persisted
 * row in "active" state, (d) returns credentials to the browser.
 *
 * Post-call analysis is shared with the per-guide / compass paths:
 * voiceCallsNode.processCallAnalysis is keyed on callId, doesn't care which
 * surface produced the row, so finalize() will schedule it for job calls
 * the same way.
 */

import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { GoogleGenAI } from "@google/genai";
import {
  buildJobSnapshotForVoice,
  buildCompanyContextForVoice,
  buildFitNarrativeForVoice,
  buildProfileSnapshotForVoice,
  aggregateJobCitations,
} from "./jobVoiceContext";
import { jobAdviserPrompt } from "../lib/ai/prompts/jobAdviser";

// Same Gemini Live model + voice defaults as the per-guide and compass paths.
// If we rotate one, doing the swap in all three files at once keeps the
// surfaces in sync; deliberately not extracted to a shared constant because
// that would hide the dependency between the surfaces' configs.
const LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = "Aoede";
const TOKEN_USES = 1;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const NEW_SESSION_TTL_MS = 2 * 60 * 1000;

export const mintJobSession = action({
  args: {
    jobPostingId: v.id("job_postings"),
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
        v.literal("posting-not-found"),
        v.literal("posting-not-ready"),
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
        };
      }
    | {
        ok: false;
        reason:
          | "anonymous"
          | "posting-not-found"
          | "posting-not-ready"
          | "no-api-key";
      }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, reason: "anonymous" };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("jobVoiceNode.mintJobSession: GEMINI_API_KEY missing");
      return { ok: false, reason: "no-api-key" };
    }

    const bundle = await ctx.runQuery(internal.jobVoice._gatherJobContext, {
      jobPostingId: args.jobPostingId,
      tokenIdentifier: identity.tokenIdentifier,
    });
    if (!bundle) return { ok: false, reason: "anonymous" };
    if (!bundle.posting || !bundle.company) {
      return { ok: false, reason: "posting-not-found" };
    }
    if (
      bundle.posting.contentStatus !== "complete" ||
      !bundle.posting.content
    ) {
      // Pending shell users see a "we're rewriting this" page; the call
      // would have nothing useful to say without enriched content.
      return { ok: false, reason: "posting-not-ready" };
    }

    const jobCtx = buildJobSnapshotForVoice({
      posting: bundle.posting,
      company: bundle.company,
    });
    if (!jobCtx) return { ok: false, reason: "posting-not-ready" };

    const companyCtx = buildCompanyContextForVoice({
      company: bundle.company,
      companyResearch: bundle.companyResearch,
      companyRoleResearch: bundle.companyRoleResearch,
      hasRoleArchetype: bundle.posting.roleArchetypeSlug != null,
    });

    const fit = buildFitNarrativeForVoice({
      jobEmbeddings: bundle.jobEmbeddings,
      profileEmbeddings: bundle.profileEmbeddings,
    });

    const profileCtx = buildProfileSnapshotForVoice({
      user: bundle.user,
      enrichment: bundle.enrichment,
      profile: bundle.profile,
    });

    const citations = aggregateJobCitations({
      companyResearch: bundle.companyResearch,
      companyRoleResearch: bundle.companyRoleResearch,
      linkedGuide: bundle.linkedGuide,
    });

    const linkedGuideRef = bundle.linkedGuide
      ? { title: bundle.linkedGuide.title, slug: bundle.linkedGuide.slug }
      : null;

    const systemInstruction = jobAdviserPrompt({
      job: jobCtx,
      company: companyCtx,
      fit,
      linkedGuide: linkedGuideRef,
      profile: profileCtx,
      citations,
    });

    // Mint credentials, try ephemeral first, fall back to raw API key per
    // V1 commit 0689253. Gemini's auth_tokens endpoint occasionally flakes;
    // the fallback keeps calls working when it does.
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
        "jobVoiceNode.mintJobSession: ephemeral mint failed, falling back to API key",
        err instanceof Error ? err.message : String(err),
      );
      credential = { type: "api_key", value: apiKey };
      authMode = "apiKey";
    }

    const voiceId = args.voiceId ?? DEFAULT_VOICE;
    const sessionId = crypto.randomUUID();
    const title = `Talking through: ${jobCtx.title} at ${jobCtx.companyName}`;

    const callId = await ctx.runMutation(
      internal.jobVoice._createJobSession,
      {
        userId: bundle.user._id,
        jobPostingId: args.jobPostingId,
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
      },
    };
  },
});
