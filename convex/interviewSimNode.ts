"use node";

/**
 * Interview-simulation Node-runtime surface.
 *
 * Single client entry point: mintInterviewSession.
 *   1. Auth + load context.
 *   2. Check per-day rate limit (5 / 24h).
 *   3. Create prep-status doc so the dialog can subscribe immediately.
 *   4. Refresh stale research (interviewBundle, news) via
 *      _synthesizeInterviewResearch (synchronous inline call — the dialog
 *      waits on status transitions before moving to Phase 2).
 *   5. Build the interviewer system prompt.
 *   6. Mint a Gemini Live ephemeral token with tools: [{ googleSearch: {} }]
 *      bound at token time (ephemeral path) / returned in sessionConfig
 *      (API-key fallback path). Pattern mirrors voiceCallsNode.mintSession.
 *   7. Create the voice_calls row with surface: "interview_job".
 *   8. Patch prep-status to "ready" with the callId.
 *
 * processInterviewAnalysis runs after voiceCalls.finalize for interview rows
 * (dispatched in Task 7). Generates the rubric with verbatim-quote retries.
 */

import {
  action,
  internalAction,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { GoogleGenAI } from "@google/genai";
import { generateText, Output } from "ai";
import { chatModel } from "../lib/ai/providers";
import { CONTENT_MODEL_ID } from "../lib/ai/prompts/career-guides";
import {
  buildInterviewQueries,
  buildNewsQuery,
  isBundleStale,
  isNewsStale,
} from "./lib/interviewResearch";
import {
  InterviewSynthesisSchema,
  InterviewRubricSchema,
  buildSynthesisPrompt,
  buildInterviewerPrompt,
  buildRubricPrompt,
  enforceVerbatimQuotes,
  type CandidateContext,
  type InterviewRubric,
} from "../lib/ai/prompts/interviewer";
import { exaAnswer, type Citation } from "../lib/server/exa";
import {
  buildLiveConfig,
  buildFullSetupMessage,
  buildMinimalSetupMessage,
} from "./lib/voiceLiveConfig";

const LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = "Aoede";
const TOKEN_USES = 1;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const NEW_SESSION_TTL_MS = 2 * 60 * 1000;

const SYNTHESIS_TIMEOUT_MS = 90_000;
const ANALYSIS_TIMEOUT_MS = 90_000;
const RATE_LIMIT_PER_DAY = 5;

// ─── mintInterviewSession (client entry) ──────────────────────────────────

export const mintInterviewSession = action({
  args: {
    jobPostingId: v.id("job_postings"),
    prepSessionId: v.string(), // client-generated UUID for the status doc
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
        tools: v.array(v.any()),
      }),
    }),
    v.object({
      ok: v.literal(false),
      reason: v.union(
        v.literal("anonymous"),
        v.literal("posting-not-found"),
        v.literal("posting-not-ready"),
        v.literal("rate-limited"),
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
    | {
        ok: false;
        reason:
          | "anonymous"
          | "posting-not-found"
          | "posting-not-ready"
          | "rate-limited"
          | "no-api-key";
      }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, reason: "anonymous" };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[interviewSim:mint] GEMINI_API_KEY missing");
      return { ok: false, reason: "no-api-key" };
    }

    const bundle = await ctx.runQuery(
      internal.interviewSim._gatherInterviewContext,
      {
        jobPostingId: args.jobPostingId,
        tokenIdentifier: identity.tokenIdentifier,
      },
    );
    if (!bundle) return { ok: false, reason: "anonymous" };
    if (!bundle.posting || !bundle.company) {
      return { ok: false, reason: "posting-not-found" };
    }
    if (
      bundle.posting.contentStatus !== "complete" ||
      !bundle.posting.content
    ) {
      return { ok: false, reason: "posting-not-ready" };
    }

    // Per-day rate limit (5 / 24h, by user).
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recent = await ctx.runQuery(
      internal.interviewSim._countRecentInterviews,
      { userId: bundle.user._id, since },
    );
    if (recent >= RATE_LIMIT_PER_DAY) {
      return { ok: false, reason: "rate-limited" };
    }

    // Create the prep-status doc so the dialog can subscribe immediately.
    await ctx.runMutation(internal.interviewSim._createPrepStatus, {
      prepSessionId: args.prepSessionId,
      userId: bundle.user._id,
      jobPostingId: args.jobPostingId,
      detail: bundle.company.nameRaw,
    });

    const bundleStale = isBundleStale(
      bundle.companyRoleResearch?.interviewBundle?.generatedAt,
    );
    const newsStale = isNewsStale(
      bundle.companyResearch?.recentNews?.fetchedAt,
    );

    if (bundleStale || newsStale) {
      // Inline synchronous call — the dialog status doc transitions keep the
      // user informed while we wait. We do not fire-and-forget because the
      // bundle must be ready before we build the system instruction below.
      await ctx.runAction(
        internal.interviewSimNode._synthesizeInterviewResearch,
        {
          prepSessionId: args.prepSessionId,
          companyId: bundle.company._id,
          companyName: bundle.company.nameRaw,
          roleTitle: bundle.posting.title,
          cacheKeySlug: bundle.cacheKeySlug,
          runBundle: bundleStale,
          runNews: newsStale,
        },
      );
    }

    // Re-fetch context now that synthesis may have populated the bundle.
    const refreshed = await ctx.runQuery(
      internal.interviewSim._gatherInterviewContext,
      {
        jobPostingId: args.jobPostingId,
        tokenIdentifier: identity.tokenIdentifier,
      },
    );
    const interviewBundle =
      refreshed?.companyRoleResearch?.interviewBundle ?? fallbackBundle();
    const news = refreshed?.companyResearch?.recentNews;

    await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
      prepSessionId: args.prepSessionId,
      status: "minting_token",
    });

    // Build the system instruction.
    // Schema: users.name (not firstName); profiles.headline (not currentTitle).
    const candidate: CandidateContext = {
      firstName: bundle.user.name ?? "there",
      currentTitle: bundle.profile?.headline ?? undefined,
      yearsExperience: bundle.enrichment?.totalYearsExperience ?? undefined,
      topSkills: bundle.enrichment?.enrichedSkills
        ?.slice(0, 5)
        .map((s: { canonical: string }) => s.canonical),
      narrative: bundle.enrichment?.narrativeSummary ?? undefined,
      resumeExcerpt: bundle.profile?.rawText?.slice(0, 800) ?? undefined,
    };

    const systemInstruction = buildInterviewerPrompt({
      candidate,
      posting: {
        title: bundle.posting.title,
        city: bundle.posting.city,
        excerpt: bundle.posting.content?.overview?.slice(0, 500) ?? undefined,
      },
      company: { name: bundle.company.nameRaw },
      bundle: interviewBundle,
      news,
    });

    const voiceId = args.voiceId ?? DEFAULT_VOICE;

    // Build the live config with tools bound at token time (same pattern as
    // voiceCallsNode.mintSession). googleSearch is the only tool — the
    // interviewer prompt instructs the model to call it at most once per call.
    const liveConfig = buildLiveConfig({
      model: LIVE_MODEL,
      voice: voiceId,
      systemInstruction,
      tools: [{ googleSearch: {} }],
    });

    // Mint the Gemini Live token.
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    let credential: { type: "ephemeral_token" | "api_key"; value: string };
    let authMode: "ephemeral" | "apiKey";
    let setupMessage: Record<string, unknown>;
    try {
      const token = await client.authTokens.create({
        config: {
          uses: TOKEN_USES,
          expireTime: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
          newSessionExpireTime: new Date(
            Date.now() + NEW_SESSION_TTL_MS,
          ).toISOString(),
          // Bind the full live config at the token so the client's setup
          // message can be minimal. Mirrors voiceCallsNode.mintSession.
          liveConnectConstraints: {
            model: LIVE_MODEL,
            config: liveConfig as never,
          },
        },
      });
      if (!token.name) throw new Error("empty_token_name");
      credential = { type: "ephemeral_token", value: token.name };
      authMode = "ephemeral";
      setupMessage = buildMinimalSetupMessage(LIVE_MODEL);
    } catch (err) {
      console.warn(
        "[interviewSim:mint] ephemeral mint failed, falling back to API key",
        err instanceof Error ? err.message : String(err),
      );
      credential = { type: "api_key", value: apiKey };
      authMode = "apiKey";
      // Full setup must include tools on the API-key path (no constraint binding).
      setupMessage = buildFullSetupMessage({
        model: LIVE_MODEL,
        voice: voiceId,
        systemInstruction,
        tools: [{ googleSearch: {} }],
      });
    }

    const sessionId = crypto.randomUUID();
    const title = `Mock interview: ${bundle.posting.title} at ${bundle.company.nameRaw}`;

    const callId = await ctx.runMutation(
      internal.interviewSim._createInterviewSession,
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

    await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
      prepSessionId: args.prepSessionId,
      status: "ready",
      voiceCallId: callId,
    });

    // Return sessionConfig including tools so the client hook can wire them
    // on the API-key path. On the ephemeral path the client only needs to
    // send the minimal setup message (token has everything), but returning
    // tools here is harmless and keeps the hook interface uniform.
    return {
      ok: true,
      callId,
      sessionId,
      auth: credential,
      sessionConfig: {
        model: LIVE_MODEL,
        voice: voiceId,
        systemInstruction,
        tools: [{ googleSearch: {} }],
      },
    };
  },
});

// ─── _synthesizeInterviewResearch ─────────────────────────────────────────

export const _synthesizeInterviewResearch = internalAction({
  args: {
    prepSessionId: v.string(),
    companyId: v.id("companies"),
    companyName: v.string(),
    roleTitle: v.string(),
    cacheKeySlug: v.string(),
    runBundle: v.boolean(),
    runNews: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (!args.runBundle && !args.runNews) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SYNTHESIS_TIMEOUT_MS);

    try {
      const queries = buildInterviewQueries({
        companyName: args.companyName,
        roleTitle: args.roleTitle,
      });
      const newsQuery = buildNewsQuery({ companyName: args.companyName });

      type Slice = {
        answer: string;
        citations: Citation[];
        costCents: number;
      } | null;

      const fetchOne = async (q: string): Promise<Slice> => {
        try {
          const r = await exaAnswer(q, { signal: controller.signal });
          return {
            answer: r.answer,
            citations: r.citations,
            costCents: r.costCents,
          };
        } catch (err) {
          console.error(
            "[interviewSim:exa]",
            err instanceof Error ? err.message : String(err),
          );
          return null;
        }
      };

      const [loop, questions, rigor, prestige, news] = await Promise.all([
        args.runBundle ? fetchOne(queries.loop) : Promise.resolve(null),
        args.runBundle ? fetchOne(queries.questions) : Promise.resolve(null),
        args.runBundle ? fetchOne(queries.rigor) : Promise.resolve(null),
        args.runBundle
          ? fetchOne(queries.prestigeSignals)
          : Promise.resolve(null),
        args.runNews ? fetchOne(newsQuery) : Promise.resolve(null),
      ]);

      let totalCostCents = 0;
      for (const r of [loop, questions, rigor, prestige, news]) {
        if (r) totalCostCents += r.costCents;
      }

      // ── Path A: news-only refresh ─────────────────────────────────────────
      // Write bullets directly from Exa without an LLM call.
      if (!args.runBundle && args.runNews && news) {
        const bullets = parseNewsBulletsFromExa(
          news.answer,
          news.citations,
        ).slice(0, 6);
        await ctx.runMutation(
          internal.interviewSim._patchCompanyResearchNews,
          { companyId: args.companyId, bullets },
        );
        return null;
      }

      // ── Path D: all Exa queries failed ─────────────────────────────────────
      // Write a generic-but-honest fallback so we don't refetch on every call
      // within 30d, and so the user can still proceed with the interview.
      const bundleAnyOk = loop || questions || rigor || prestige;
      if (!bundleAnyOk) {
        await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
          prepSessionId: args.prepSessionId,
          status: "synthesizing",
          detail: "Falling back to a generic interviewer brief",
        });
        await ctx.runMutation(internal.interviewSim._patchInterviewBundle, {
          companyId: args.companyId,
          roleArchetypeSlug: args.cacheKeySlug,
          interviewProse: `We couldn't fetch live research for ${args.companyName}. The interview will use a generic ${args.roleTitle} loop calibrated to the role.`,
          interviewBundle: {
            ...fallbackBundle(),
            modelUsed: "fallback",
          },
          costCents: totalCostCents,
        });
        return null;
      }

      // ── Path B / C: bundle synthesis (with or without news) ───────────────
      await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
        prepSessionId: args.prepSessionId,
        status: "synthesizing",
      });

      const synthesisPrompt = buildSynthesisPrompt({
        companyName: args.companyName,
        roleTitle: args.roleTitle,
        exaResults: {
          loop: loop ?? undefined,
          questions: questions ?? undefined,
          rigor: rigor ?? undefined,
          prestigeSignals: prestige ?? undefined,
        },
        newsAnswer: news ?? undefined,
      });

      const { experimental_output } = await generateText({
        model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
        experimental_output: Output.object({ schema: InterviewSynthesisSchema }),
        prompt: synthesisPrompt,
        abortSignal: controller.signal,
      });

      const out = experimental_output;

      // Persist the bundle — include modelUsed per plan callout.
      await ctx.runMutation(internal.interviewSim._patchInterviewBundle, {
        companyId: args.companyId,
        roleArchetypeSlug: args.cacheKeySlug,
        interviewProse: out.interviewProse,
        interviewBundle: { ...out.interviewBundle, modelUsed: CONTENT_MODEL_ID },
        citations: collectCitations({ loop, questions, rigor, prestige }),
        costCents: totalCostCents,
      });

      // Persist news bullets (when present).
      if (out.recentNews?.bullets?.length) {
        await ctx.runMutation(
          internal.interviewSim._patchCompanyResearchNews,
          {
            companyId: args.companyId,
            bullets: out.recentNews.bullets.slice(0, 6),
          },
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[interviewSim:synthesis] failed", msg);
      await ctx.runMutation(internal.interviewSim._patchPrepStatus, {
        prepSessionId: args.prepSessionId,
        status: "failed",
        error: msg,
      });
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

// ─── processInterviewAnalysis (post-call rubric) ──────────────────────────

export const processInterviewAnalysis = internalAction({
  args: { callId: v.id("voice_calls") },
  returns: v.null(),
  handler: async (ctx: ActionCtx, args): Promise<null> => {
    const call = await ctx.runQuery(internal.voiceCalls._getCallById, {
      callId: args.callId,
    });
    if (!call) return null;
    if (call.surface !== "interview_job") return null;
    if (call.messages.length < 4) return null;
    if (!call.jobPostingId) return null;

    // Load the bundle the call was grounded in.
    const posting = await ctx.runQuery(
      internal.interviewSim._getPostingWithCompanyAndBundle,
      { jobPostingId: call.jobPostingId },
    );
    if (!posting?.bundle) return null;

    const transcript = formatTranscript(call.messages);
    const candidateBrief: CandidateContext = posting.candidate;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
    try {
      let attempt = 0;
      let failedQuotes: string[] | undefined;
      let rubric: InterviewRubric | null = null;

      // Verbatim-quote retry loop (max 2 attempts).
      while (attempt < 2) {
        attempt += 1;
        const prompt = buildRubricPrompt({
          candidate: candidateBrief,
          posting: {
            title: posting.postingTitle,
            city: posting.city,
            excerpt: undefined,
          },
          company: { name: posting.companyName },
          bundle: posting.bundle,
          transcript,
          failedQuotes,
        });
        const { experimental_output } = await generateText({
          model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
          experimental_output: Output.object({ schema: InterviewRubricSchema }),
          prompt,
          abortSignal: controller.signal,
        });
        rubric = experimental_output;

        const check = enforceVerbatimQuotes({
          transcript,
          bestQuote: rubric.bestMoment.quote,
          missQuote: rubric.biggestMiss.quote,
        });
        if (check.ok) break;
        failedQuotes = check.missing;
      }

      if (!rubric) return null;

      // Strip offending quote fields if still bad after 2 attempts.
      const stripped = stripFailedQuotesIfStillBad(transcript, rubric);

      await ctx.runMutation(internal.interviewSim._patchInterviewRubric, {
        callId: args.callId,
        aiSummary: stripped,
      });
    } catch (err) {
      console.error(
        "[interviewSim:analysis] failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});

// ─── helpers ──────────────────────────────────────────────────────────────

function formatTranscript(
  messages: Array<{ role: string; content: string }>,
): string {
  return messages
    .map(
      (m) =>
        `${m.role === "user" ? "Candidate" : "Interviewer"}: ${m.content}`,
    )
    .join("\n");
}

function fallbackBundle() {
  return {
    rounds: [
      {
        name: "Recruiter screen",
        focus: "Mutual fit + basic background",
        interviewerArchetype: "recruiter",
      },
      {
        name: "Hiring manager",
        focus: "Experience and motivation",
        interviewerArchetype: "hiring manager",
      },
      {
        name: "Role-specific deep dive",
        focus: "Skills relevant to the role",
        interviewerArchetype: "senior practitioner",
      },
    ],
    signatureQuestions: [
      {
        question: "Tell me about yourself.",
        rationale: "Generic opener.",
      },
      {
        question: "Why are you interested in this role?",
        rationale: "Tests motivation.",
      },
      {
        question: "Walk me through a project you're proud of.",
        rationale: "Tests depth.",
      },
      {
        question: "Tell me about a time you handled a difficult situation.",
        rationale: "Behavioral.",
      },
      {
        question: "What questions do you have for me?",
        rationale: "Closer.",
      },
    ],
    rubric: {
      rigor: 3,
      rigorRationale: "Generic fallback — no live research available.",
      interviewerArchetype: "hiring manager",
      dimensions: [
        {
          key: "structure",
          anchorBelow: "Rambling.",
          anchorAt: "STAR or similar.",
          anchorAbove: "Crisp + quantified.",
        },
        {
          key: "depth",
          anchorBelow: "Surface-only.",
          anchorAt: "Adequate detail.",
          anchorAbove: "Probes own assumptions.",
        },
        {
          key: "role-fit",
          anchorBelow: "Misaligned.",
          anchorAt: "Plausible match.",
          anchorAbove: "Strong evidence.",
        },
        {
          key: "company-fit",
          anchorBelow: "Generic.",
          anchorAt: "Aware of the company.",
          anchorAbove: "Specific + informed.",
        },
      ],
    },
    prestigeSignals: {},
    generatedAt: Date.now(),
    modelUsed: "fallback",
  };
}

function collectCitations(
  slices: Record<string, { citations: Citation[] } | null>,
) {
  const out: Record<string, Citation[]> = {};
  const interviewCitations: Citation[] = [];
  for (const k of Object.keys(slices)) {
    const c = slices[k]?.citations ?? [];
    interviewCitations.push(...c);
  }
  if (interviewCitations.length) {
    out.interview = interviewCitations.slice(0, 12);
  }
  return out;
}

function parseNewsBulletsFromExa(answer: string, citations: Citation[]) {
  // Heuristic: split prose answer by sentence, pair sequentially with
  // citations until exhausted. Conservative to avoid hallucinated headlines —
  // if Exa returns no citations, return [].
  if (!citations.length) return [];
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const bullets: Array<{
    headline: string;
    summary: string;
    sourceUrl: string;
    publisher?: string;
    publishedAt?: number;
  }> = [];
  for (let i = 0; i < Math.min(sentences.length, citations.length); i++) {
    const s = sentences[i];
    const c = citations[i];
    bullets.push({
      headline: c.title.length > 100 ? `${c.title.slice(0, 97)}…` : c.title,
      summary: s.length > 200 ? `${s.slice(0, 197)}…` : s,
      sourceUrl: c.url,
      publisher: c.publisher,
    });
  }
  return bullets;
}

function stripFailedQuotesIfStillBad(
  transcript: string,
  rubric: InterviewRubric,
): InterviewRubric {
  const check = enforceVerbatimQuotes({
    transcript,
    bestQuote: rubric.bestMoment.quote,
    missQuote: rubric.biggestMiss.quote,
  });
  if (check.ok) return rubric;
  return {
    ...rubric,
    bestMoment: { quote: "", why: rubric.bestMoment.why },
    biggestMiss: {
      quote: "",
      why: rubric.biggestMiss.why,
      betterAnswerSketch: rubric.biggestMiss.betterAnswerSketch,
    },
  };
}
