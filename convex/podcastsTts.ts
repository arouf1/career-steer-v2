"use node";

import { v } from "convex/values";
import { GoogleGenAI } from "@google/genai";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { HOST } from "../lib/podcast/voices";
import { buildSpeakerPrompt } from "../lib/ai/prompts/podcast";
import {
  base64ToBytes,
  parseAudioMimeType,
  pcmBytesToWav,
  pcmDurationSeconds,
} from "../lib/podcast/wav";
import {
  JINGLE_BITS_PER_SAMPLE,
  JINGLE_CHANNELS,
  JINGLE_PCM_BASE64,
  JINGLE_SAMPLE_RATE,
} from "../lib/podcast/jingle-pcm";

// Gap between jingle tail and first spoken word so the host doesn't step on
// the music's release.
const JINGLE_TAIL_SILENCE_MS = 350;

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

    const { transcript, guestName, guestRole, guestVoice, personaTraits } =
      guide.podcast;

    const stylePrompt = buildSpeakerPrompt({
      guestName,
      guestRole,
      personaTraits,
    });
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
            // 1.5 — stepped down from the docs' example value of 2.0
            // because max creativity made Alice (the host) drift in pitch
            // and timbre between episodes. Still well above the 1.0 default
            // so the delivery keeps its podcast-y energy.
            temperature: 1.5,
            abortSignal: controller.signal,
          },
        });

        const part = res.candidates?.[0]?.content?.parts?.[0];
        const inline = part?.inlineData;
        if (!inline?.data) {
          throw new Error("no_audio_in_response");
        }
        const mimeType = inline.mimeType ?? "audio/L16;rate=24000";

        // The bundled jingle is pre-rendered to 24 kHz mono 16-bit PCM. If
        // Gemini ever returns a different format we can't safely concatenate
        // raw PCM, so fail loud rather than ship corrupted audio. Parse the
        // mime so we tolerate extra parameters Gemini may add (e.g. observed
        // `audio/L16;codec=pcm;rate=24000` after a model update).
        const fmt = parseAudioMimeType(mimeType);
        if (
          fmt.sampleRate !== JINGLE_SAMPLE_RATE ||
          fmt.numChannels !== JINGLE_CHANNELS ||
          fmt.bitsPerSample !== JINGLE_BITS_PER_SAMPLE
        ) {
          throw new Error(
            `unexpected_tts_format:${fmt.sampleRate}Hz/${fmt.numChannels}ch/${fmt.bitsPerSample}bit (mime=${mimeType})`,
          );
        }

        const jinglePcm = base64ToBytes(JINGLE_PCM_BASE64);
        const episodePcm = base64ToBytes(inline.data);
        const silenceBytes =
          Math.round((JINGLE_SAMPLE_RATE * JINGLE_TAIL_SILENCE_MS) / 1000) *
          JINGLE_CHANNELS *
          (JINGLE_BITS_PER_SAMPLE / 8);
        const combined = new Uint8Array(
          jinglePcm.length + silenceBytes + episodePcm.length,
        );
        combined.set(jinglePcm, 0);
        // silenceBytes region is already zero-initialized.
        combined.set(episodePcm, jinglePcm.length + silenceBytes);

        const wavBytes = pcmBytesToWav(combined, mimeType);
        // BlobPart wants ArrayBuffer-backed views; copy to a fresh ArrayBuffer
        // so the type matches even if the source view is over a SharedArrayBuffer.
        const buffer = new ArrayBuffer(wavBytes.byteLength);
        new Uint8Array(buffer).set(wavBytes);
        const blob = new Blob([buffer], { type: "audio/wav" });
        const audioStorageId = await ctx.storage.store(blob);
        const durationSeconds = pcmDurationSeconds(combined.length, mimeType);

        await ctx.runMutation(internal.podcasts._completePodcast, {
          guideId: args.guideId,
          audioStorageId,
          durationSeconds,
        });
        await ctx.runMutation(internal.podcasts._markJingled, {
          guideId: args.guideId,
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

// Backfill helper: prepends the bundled jingle to an already-synthesized
// episode without re-running TTS. Validates the existing WAV header matches
// the jingle's format (24 kHz / mono / 16-bit), splices in PCM space, stores
// the new blob, updates the guide, then deletes the old storage blob.
export const prependJingleToExisting = internalAction({
  args: { guideId: v.id("career_guides") },
  returns: v.object({
    previousDurationSeconds: v.number(),
    newDurationSeconds: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    previousDurationSeconds: number;
    newDurationSeconds: number;
  }> => {
    const guide: {
      podcast?: {
        audioStorageId?: string;
        durationSeconds?: number;
        hasJingle?: boolean;
      };
    } | null = await ctx.runQuery(internal.careerGuides._getById, {
      guideId: args.guideId,
    });
    const existingId = guide?.podcast?.audioStorageId;
    if (!existingId) {
      throw new Error("no_existing_audio");
    }
    if (guide?.podcast?.hasJingle) {
      throw new Error("already_jingled");
    }
    const existing = await ctx.storage.get(existingId);
    if (!existing) {
      throw new Error("audio_blob_missing");
    }
    const wavBuffer = new Uint8Array(await existing.arrayBuffer());
    if (wavBuffer.length < 44) {
      throw new Error("audio_truncated");
    }
    const view = new DataView(
      wavBuffer.buffer,
      wavBuffer.byteOffset,
      wavBuffer.byteLength,
    );
    // RIFF header sanity + format extraction. Fields per the canonical 44-byte
    // PCM WAV header we emit in lib/podcast/wav.ts.
    const isRiff =
      wavBuffer[0] === 0x52 && wavBuffer[1] === 0x49 &&
      wavBuffer[2] === 0x46 && wavBuffer[3] === 0x46;
    const isWave =
      wavBuffer[8] === 0x57 && wavBuffer[9] === 0x41 &&
      wavBuffer[10] === 0x56 && wavBuffer[11] === 0x45;
    if (!isRiff || !isWave) {
      throw new Error("not_riff_wav");
    }
    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);
    if (
      sampleRate !== JINGLE_SAMPLE_RATE ||
      channels !== JINGLE_CHANNELS ||
      bitsPerSample !== JINGLE_BITS_PER_SAMPLE
    ) {
      throw new Error(
        `format_mismatch:${sampleRate}Hz/${channels}ch/${bitsPerSample}bit`,
      );
    }
    const episodePcm = wavBuffer.subarray(44);
    const jinglePcm = base64ToBytes(JINGLE_PCM_BASE64);
    const silenceBytes =
      Math.round((JINGLE_SAMPLE_RATE * JINGLE_TAIL_SILENCE_MS) / 1000) *
      JINGLE_CHANNELS *
      (JINGLE_BITS_PER_SAMPLE / 8);
    const combined = new Uint8Array(
      jinglePcm.length + silenceBytes + episodePcm.length,
    );
    combined.set(jinglePcm, 0);
    combined.set(episodePcm, jinglePcm.length + silenceBytes);

    const mimeType = `audio/L${JINGLE_BITS_PER_SAMPLE};rate=${JINGLE_SAMPLE_RATE}`;
    const wavBytes = pcmBytesToWav(combined, mimeType);
    const buffer = new ArrayBuffer(wavBytes.byteLength);
    new Uint8Array(buffer).set(wavBytes);
    const blob = new Blob([buffer], { type: "audio/wav" });
    const newStorageId = await ctx.storage.store(blob);
    const newDurationSeconds = pcmDurationSeconds(combined.length, mimeType);

    await ctx.runMutation(internal.podcasts._completePodcast, {
      guideId: args.guideId,
      audioStorageId: newStorageId,
      durationSeconds: newDurationSeconds,
    });
    await ctx.runMutation(internal.podcasts._markJingled, {
      guideId: args.guideId,
    });
    // Free the old blob now that the guide points at the new one.
    try {
      await ctx.storage.delete(existingId);
    } catch (err) {
      console.warn("prependJingleToExisting:old_blob_delete_failed", {
        guideId: args.guideId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return {
      previousDurationSeconds: guide?.podcast?.durationSeconds ?? 0,
      newDurationSeconds,
    };
  },
});
