"use node";

import { v } from "convex/values";
import { GoogleGenAI } from "@google/genai";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { HOST } from "../lib/podcast/voices";
import { buildSpeakerPrompt } from "../lib/ai/prompts/podcast";
import { pcmDurationSeconds, pcmToWav } from "../lib/podcast/wav";

// Google publishes two multi-speaker TTS models. Flash is "optimized for
// cost-efficient everyday applications" — fine for short clips but drifts
// in clarity over a few minutes of continuous output (audio analysis on
// flash showed an 18% drop in spectral centroid past 80s). Pro is
// explicitly "optimized for structured workflows like podcast generation
// and audiobooks", which is exactly our use case. The AI Studio API name
// is `gemini-2.5-pro-preview-tts` (Vertex calls the same model
// `gemini-2.5-pro-tts`).
const TTS_MODEL = "gemini-2.5-pro-preview-tts";
// Pro TTS renders multi-speaker dialogue sequentially and can take 3-5 min
// on a 30-turn transcript. 180s was too aggressive — bumped to 6 min.
const TTS_TIMEOUT_MS = 360_000;
// Retry once if our own timeout fires; non-abort errors fail fast.
const TTS_RETRIES_ON_ABORT = 1;

export const synthesize = internalAction({
  args: { guideId: v.id("career_guides") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const guide = await ctx.runQuery(internal.careerGuides._getById, {
      guideId: args.guideId,
    });
    if (!guide?.podcast?.transcript || !guide.podcast.guestName || !guide.podcast.guestVoice || !guide.podcast.guestRole) {
      await ctx.runMutation(internal.podcasts._failPodcast, {
        guideId: args.guideId,
        error: "script_missing",
      });
      return null;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.podcasts._failPodcast, {
        guideId: args.guideId,
        error: "GEMINI_API_KEY_missing",
      });
      return null;
    }

    const { transcript, guestName, guestRole, guestVoice } = guide.podcast;

    const stylePrompt = buildSpeakerPrompt({ guestName, guestRole });
    const dialogueText = transcript
      .map((t) =>
        `${t.speaker === "host" ? HOST.name : guestName}: ${t.text}`,
      )
      .join("\n");
    const prompt = `${stylePrompt}\n\n${dialogueText}`;

    // 8000-byte combined cap on text+style. Truncate defensively.
    const totalBytes = new TextEncoder().encode(prompt).length;
    if (totalBytes > 7800) {
      await ctx.runMutation(internal.podcasts._failPodcast, {
        guideId: args.guideId,
        error: `prompt_too_long:${totalBytes}b`,
      });
      return null;
    }

    const ai = new GoogleGenAI({ apiKey });
    let lastErr: unknown;
    let success = false;
    for (let attempt = 0; attempt <= TTS_RETRIES_ON_ABORT; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
      try {
        const res = await ai.models.generateContent({
          model: TTS_MODEL,
          contents: prompt,
          config: {
            responseModalities: ["audio"],
            speechConfig: {
              languageCode: "en-US",
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: HOST.name,
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: HOST.voice },
                    },
                  },
                  {
                    speaker: guestName,
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: guestVoice },
                    },
                  },
                ],
              },
            },
            // Gemini's TTS docs use temperature 2.0 in their multi-speaker
            // examples — higher creativity gives more expressive delivery
            // (laugh tone variation, natural pauses) which is what we want
            // for a podcast feel.
            temperature: 2.0,
            abortSignal: controller.signal,
          },
        });

        const part = res.candidates?.[0]?.content?.parts?.[0];
        const inline = part?.inlineData;
        if (!inline?.data) {
          throw new Error("no_audio_in_response");
        }
        const mimeType = inline.mimeType ?? "audio/L16;rate=24000";
        const wavBytes = pcmToWav(inline.data, mimeType);
        // BlobPart wants ArrayBuffer-backed views; copy to a fresh ArrayBuffer
        // so the type matches even if the source view is over a SharedArrayBuffer.
        const buffer = new ArrayBuffer(wavBytes.byteLength);
        new Uint8Array(buffer).set(wavBytes);
        const blob = new Blob([buffer], { type: "audio/wav" });
        const audioStorageId = await ctx.storage.store(blob);
        const durationSeconds = pcmDurationSeconds(
          wavBytes.length - 44,
          mimeType,
        );

        await ctx.runMutation(internal.podcasts._completePodcast, {
          guideId: args.guideId,
          audioStorageId,
          durationSeconds,
        });
        success = true;
        break;
      } catch (err) {
        lastErr = err;
        const aborted = controller.signal.aborted;
        console.warn("synthesize:attempt-failed", {
          guideId: args.guideId,
          attempt,
          aborted,
          msg: err instanceof Error ? err.message : String(err),
        });
        // Only retry our own timeout aborts; other errors fail fast.
        if (!aborted) break;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!success) {
      console.error("synthesize:failed", { guideId: args.guideId, err: lastErr });
      await ctx.runMutation(internal.podcasts._failPodcast, {
        guideId: args.guideId,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
    }
    return null;
  },
});
