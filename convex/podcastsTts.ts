"use node";

import { v } from "convex/values";
import { GoogleGenAI } from "@google/genai";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { HOST } from "../lib/podcast/voices";
import { buildSpeakerPrompt } from "../lib/ai/prompts/podcast";
import { pcmDurationSeconds, pcmToWav } from "../lib/podcast/wav";

const TTS_MODEL = "gemini-3.1-flash-tts-preview";
const TTS_TIMEOUT_MS = 180_000;

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    try {
      const ai = new GoogleGenAI({ apiKey });
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
          temperature: 1.0,
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
    } catch (err) {
      console.error("synthesize:failed", { guideId: args.guideId, err });
      await ctx.runMutation(internal.podcasts._failPodcast, {
        guideId: args.guideId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});
