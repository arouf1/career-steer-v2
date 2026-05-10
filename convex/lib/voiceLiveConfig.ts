/**
 * Shared Gemini Live setup builder.
 *
 * Two surfaces, career-guide deep-dive (`voiceCallsNode.mintSession`) and
 * Career Compass (`compassVoiceNode.mintCompassSession`), both connect to
 * Gemini Live with the same model + nearly the same generation config.
 * They differ only in the system instruction and tool list. This module
 * keeps the wire shape in one place so the two surfaces can't drift.
 *
 * Why the dual return:
 *
 * - `liveConfig` is the SDK's `LiveConnectConfig` shape (top-level
 *   responseModalities, speechConfig, temperature, …). It's what the
 *   `@google/genai` SDK accepts for `liveConnectConstraints.config` at
 *   token mint. The SDK then transforms it to the wire format internally.
 *   Used on the ephemeral path: every field is bound at the token, so the
 *   client's setup message can be near-empty.
 *
 * - `setupMessage` is the raw WebSocket wire-format setup message
 *   (`{ setup: { model, generationConfig: {...}, systemInstruction, ... }}`).
 *   Used on the API-key fallback path where there is no constraint binding,
 *   so the client must send the full setup itself.
 *
 * Voice rotation regression note: yesterday's 22ee91c locked only model +
 * voice in `liveConnectConstraints` and left every other field in the
 * client's WS setup. The constrained endpoint then 1011'd because of
 * overlap between the locked subset and the unlocked rest. This module
 * fixes that by binding *all* fields at the token, so there's no overlap
 * to disagree on.
 */

export type VoiceLiveBuildArgs = {
  model: string;
  voice: string;
  systemInstruction: string;
  /**
   * Tool array shipped verbatim into the live setup. Compass uses
   * `[{functionDeclarations: [...]}, {googleSearch: {}}]`; per-guide uses
   * `[{googleSearch: {}}]`. Empty array is fine if the surface wants no
   * tools.
   */
  tools: unknown[];
};

export type LiveConnectConfigShape = Record<string, unknown>;
export type LiveSetupMessageShape = Record<string, unknown>;

const VAD_DEFAULTS = {
  startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
  endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
  prefixPaddingMs: 200,
  silenceDurationMs: 500,
} as const;

const TEMPERATURE = 0.8;
const RESPONSE_MODALITIES = ["AUDIO"] as const;

/**
 * Build the LiveConnectConfig (SDK shape) for use as
 * `liveConnectConstraints.config` at token mint time.
 */
export function buildLiveConfig(args: VoiceLiveBuildArgs): LiveConnectConfigShape {
  return {
    responseModalities: [...RESPONSE_MODALITIES],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: args.voice },
      },
    },
    temperature: TEMPERATURE,
    systemInstruction: { parts: [{ text: args.systemInstruction }] },
    tools: args.tools,
    realtimeInputConfig: {
      automaticActivityDetection: { ...VAD_DEFAULTS },
    },
    contextWindowCompression: { slidingWindow: {} },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

/**
 * Build the WebSocket setup message in wire format. Used on the API-key
 * fallback path where the client must send a full setup over the WS (no
 * constraints to inherit from).
 */
export function buildFullSetupMessage(
  args: VoiceLiveBuildArgs,
): LiveSetupMessageShape {
  return {
    setup: {
      model: `models/${args.model}`,
      generationConfig: {
        responseModalities: [...RESPONSE_MODALITIES],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: args.voice },
          },
        },
        temperature: TEMPERATURE,
      },
      systemInstruction: { parts: [{ text: args.systemInstruction }] },
      realtimeInputConfig: {
        automaticActivityDetection: { ...VAD_DEFAULTS },
      },
      contextWindowCompression: { slidingWindow: {} },
      tools: args.tools,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

/**
 * Build the *minimal* WebSocket setup message used on the ephemeral path
 * where every config field is already bound at the token. Per the live API
 * spec the client still has to send a setup message as the first message,
 * but the constrained endpoint takes the effective config from the token,
 * not the client setup. We send model only because tools at Google have
 * historically wanted *something* there; an empty `setup: {}` may also
 * work but `setup.model` matches what the SDK does.
 */
export function buildMinimalSetupMessage(model: string): LiveSetupMessageShape {
  return {
    setup: {
      model: `models/${model}`,
    },
  };
}
