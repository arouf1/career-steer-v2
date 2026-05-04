"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  PCMPlayer,
  startPCMCapture,
  type PCMCaptureHandle,
} from "@/lib/client/geminiAudio";

/**
 * Realtime "deep dive" call hook.
 *
 * Flow:
 *   1. mintSession (Convex action) returns ephemeral token + session config.
 *   2. Open WebSocket directly to Gemini Live (browser ↔ Google).
 *   3. Send the BidiGenerateContentSetup as the first WS message.
 *   4. On `setupComplete`, start mic capture + transcript persistence.
 *   5. Stream PCM audio in/out + parse transcript events for live captions.
 *   6. On end-call (or error/interrupt), call finalize which schedules the
 *      post-call analysis pipeline.
 *
 * No raw audio is persisted — only the rolling text transcript via
 * `appendMessage`. The action's response is the only place we ever see the
 * Google API key (when ephemeral mint failed and we're in apiKey-fallback
 * mode); per privacy rule, we don't log the value, only the auth mode.
 */

const GEMINI_WS_URL_EPHEMERAL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
const GEMINI_WS_URL_APIKEY =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export type DeepDiveCallState =
  | "idle"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export type DeepDiveTranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Server timestamp (ms) when the message was finalised on the client. */
  timestamp: number;
};

type AppendMessageInput = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  transcriptConfidence?: number;
};

type SessionConfigSnapshot = {
  model: string;
  voice: string;
  systemInstruction: string;
};

type AuthCredential =
  | { type: "ephemeral_token"; value: string }
  | { type: "api_key"; value: string };

export type UseDeepDiveCallArgs = {
  guideId: Id<"career_guides">;
  region: "us" | "uk";
  voiceId?: string;
};

export type UseDeepDiveCallReturn = {
  callState: DeepDiveCallState;
  error: string | null;
  isAITalking: boolean;
  userSpeaking: boolean;
  transcript: DeepDiveTranscriptEntry[];
  currentUserUtterance: string;
  currentAssistantUtterance: string;
  startCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  isMuted: boolean;
};

export function useDeepDiveCall(
  args: UseDeepDiveCallArgs,
): UseDeepDiveCallReturn {
  const { guideId, region, voiceId } = args;

  const mintSession = useAction(api.voiceCallsNode.mintSession);
  const appendMessage = useMutation(api.voiceCalls.appendMessage);
  const finalize = useMutation(api.voiceCalls.finalize);

  const [callState, setCallState] = useState<DeepDiveCallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isAITalking, setIsAITalking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<DeepDiveTranscriptEntry[]>([]);
  const [currentUserUtterance, setCurrentUserUtterance] = useState("");
  const [currentAssistantUtterance, setCurrentAssistantUtterance] =
    useState("");
  const [isMuted, setIsMuted] = useState(false);

  // Refs that survive re-renders and aren't part of render output.
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const captureRef = useRef<PCMCaptureHandle | null>(null);
  const setupCompleteRef = useRef(false);
  const mutedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const pendingAssistantRef = useRef<string>("");
  const finalizedRef = useRef(false);

  // Keep mutedRef in sync — capture callback reads from it on every chunk.
  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  // Persist a finalised user/assistant message both to Convex and to local
  // state. Idempotent on `id` thanks to dedup logic in the appendMessage
  // mutation, so retries are safe.
  const persistMessage = useCallback(
    async (message: AppendMessageInput) => {
      setTranscript((prev) =>
        prev.some((m) => m.id === message.id)
          ? prev
          : [
              ...prev,
              {
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
              },
            ],
      );

      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      try {
        await appendMessage({ sessionId, message });
      } catch (err) {
        // Network blip; log only — we re-render from the local optimistic
        // copy and the user keeps talking.
        console.warn("useDeepDiveCall: appendMessage failed", err);
      }
    },
    [appendMessage],
  );

  const teardown = useCallback(() => {
    setupCompleteRef.current = false;
    captureRef.current?.stop();
    captureRef.current = null;
    playerRef.current?.destroy();
    playerRef.current = null;
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // already closed
      }
      wsRef.current = null;
    }
    setIsAITalking(false);
    setUserSpeaking(false);
    setCurrentUserUtterance("");
    setCurrentAssistantUtterance("");
    pendingAssistantRef.current = "";
  }, []);

  const finalizeCall = useCallback(
    async (status: "completed" | "interrupted" | "error") => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;

      const sessionId = sessionIdRef.current;
      const startedAt = startedAtRef.current;
      const totalDurationSeconds = startedAt
        ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
        : 0;

      teardown();

      if (sessionId) {
        try {
          await finalize({
            sessionId,
            status,
            totalDurationSeconds,
          });
        } catch (err) {
          console.warn("useDeepDiveCall: finalize failed", err);
        }
      }
      sessionIdRef.current = null;
      startedAtRef.current = null;
    },
    [finalize, teardown],
  );

  const handleServerMessage = useCallback(
    (data: Record<string, unknown>) => {
      // Setup complete — server has accepted our config and is ready for
      // realtime input. Mic capture is wired up by the caller below.
      if ("setupComplete" in data) {
        setupCompleteRef.current = true;
        setCallState("connected");
        return;
      }

      const sc = data.serverContent as Record<string, unknown> | undefined;
      if (!sc) return;

      // Model audio + assistant transcript (delta).
      const modelTurn = sc.modelTurn as
        | { parts?: Array<{ inlineData?: { data?: string }; text?: string }> }
        | undefined;
      if (modelTurn?.parts) {
        setUserSpeaking(false);
        for (const part of modelTurn.parts) {
          if (part.inlineData?.data) {
            playerRef.current?.play(part.inlineData.data);
          }
        }
      }

      // User-side transcription (Gemini sends a single completed text per
      // turn rather than streaming deltas).
      const inputTx = sc.inputTranscription as { text?: string } | undefined;
      if (inputTx?.text) {
        const text = inputTx.text.trim();
        if (text) {
          void persistMessage({
            id: crypto.randomUUID(),
            role: "user",
            content: text,
            timestamp: Date.now(),
          });
          setCurrentUserUtterance("");
        }
      }

      // Assistant-side transcription (streamed deltas; flush on turnComplete).
      const outputTx = sc.outputTranscription as { text?: string } | undefined;
      if (outputTx?.text) {
        pendingAssistantRef.current += outputTx.text;
        setCurrentAssistantUtterance(pendingAssistantRef.current);
      }

      if (sc.turnComplete) {
        const accumulated = pendingAssistantRef.current.trim();
        pendingAssistantRef.current = "";
        setCurrentAssistantUtterance("");
        setIsAITalking(false);
        setUserSpeaking(true);
        if (accumulated) {
          void persistMessage({
            id: crypto.randomUUID(),
            role: "assistant",
            content: accumulated,
            timestamp: Date.now(),
          });
        }
      }

      if (sc.generationComplete) {
        setIsAITalking(false);
      }

      // Barge-in: server lets us know the model has been interrupted by the
      // user. Drop any queued audio so playback doesn't trail past the
      // interruption.
      if (sc.interrupted) {
        playerRef.current?.interrupt();
        setIsAITalking(false);
        setUserSpeaking(true);
      }
    },
    [persistMessage],
  );

  const startCall = useCallback(async () => {
    if (callState !== "idle" && callState !== "ended" && callState !== "error") {
      return;
    }

    setError(null);
    setTranscript([]);
    setCurrentUserUtterance("");
    setCurrentAssistantUtterance("");
    setCallState("connecting");
    finalizedRef.current = false;

    let mintResult: Awaited<ReturnType<typeof mintSession>>;
    try {
      mintResult = await mintSession({ guideId, region, voiceId });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start the call.",
      );
      setCallState("error");
      return;
    }
    if (!mintResult.ok) {
      setError(reasonToMessage(mintResult.reason));
      setCallState("error");
      return;
    }

    sessionIdRef.current = mintResult.sessionId;
    startedAtRef.current = Date.now();
    const config: SessionConfigSnapshot = mintResult.sessionConfig;
    const auth: AuthCredential = mintResult.auth;

    const isEphemeral = auth.type === "ephemeral_token";
    const baseUrl = isEphemeral ? GEMINI_WS_URL_EPHEMERAL : GEMINI_WS_URL_APIKEY;
    const authParam = isEphemeral
      ? `access_token=${encodeURIComponent(auth.value)}`
      : `key=${encodeURIComponent(auth.value)}`;
    const wsUrl = `${baseUrl}?${authParam}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const player = new PCMPlayer({
      onPlaybackStart: () => setIsAITalking(true),
      onPlaybackEnd: () => setIsAITalking(false),
    });
    playerRef.current = player;

    ws.onopen = () => {
      const setupMessage = {
        setup: {
          model: `models/${config.model}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: config.voice },
              },
            },
            temperature: 0.8,
          },
          systemInstruction: {
            parts: [{ text: config.systemInstruction }],
          },
          // VAD tuning — high sensitivity to speech start enables natural
          // barge-in, low end-of-speech sensitivity gives the user space to
          // pause mid-thought without the model jumping in.
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
              endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
              prefixPaddingMs: 200,
              silenceDurationMs: 500,
            },
          },
          // Sliding-window context compression unlocks sessions beyond the
          // base 15-min context window — important for an open-ended career
          // conversation.
          contextWindowCompression: { slidingWindow: {} },
          tools: [{ googleSearch: {} }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      } as const;
      ws.send(JSON.stringify(setupMessage));
    };

    ws.onmessage = async (event) => {
      try {
        let data: Record<string, unknown>;
        if (event.data instanceof Blob) {
          const text = await event.data.text();
          data = JSON.parse(text);
        } else {
          data = JSON.parse(event.data as string);
        }

        handleServerMessage(data);

        // First setupComplete: open the mic and start streaming.
        if ("setupComplete" in data && !captureRef.current) {
          try {
            const handle = await startPCMCapture((base64PCM) => {
              if (mutedRef.current) return;
              if (
                wsRef.current?.readyState !== WebSocket.OPEN ||
                !setupCompleteRef.current
              ) {
                return;
              }
              wsRef.current.send(
                JSON.stringify({
                  realtimeInput: {
                    audio: {
                      mimeType: "audio/pcm;rate=16000",
                      data: base64PCM,
                    },
                  },
                }),
              );
            });
            captureRef.current = handle;
          } catch (err) {
            console.error("useDeepDiveCall: mic capture failed", err);
            setError(
              "Microphone access was denied or unavailable. Allow it in your browser settings and try again.",
            );
            setCallState("error");
            await finalizeCall("error");
            return;
          }

          // Nudge the model to start the conversation. Gemini Live wants a
          // realtimeInput.text seed for the initial greeting; clientContent
          // is reserved for pre-loading turn history.
          wsRef.current?.send(
            JSON.stringify({ realtimeInput: { text: "Hello" } }),
          );
        }
      } catch (err) {
        console.warn("useDeepDiveCall: message parse error", err);
      }
    };

    ws.onerror = () => {
      setError("Connection error. Try again in a moment.");
      setCallState("error");
      void finalizeCall("error");
    };

    ws.onclose = () => {
      // We only treat the close as final if we haven't already finalized
      // (e.g. user-initiated end). The hook owns the lifecycle. Use a
      // functional setter so we read the latest call state — TS narrows
      // `callState` from the closure capture above, but the actual runtime
      // value will be "connected" / "connecting" if the WS closed mid-call.
      if (!finalizedRef.current) {
        setCallState((prev) =>
          prev === "connected" || prev === "connecting" ? "ended" : prev,
        );
        void finalizeCall("interrupted");
      }
    };
  }, [
    callState,
    finalizeCall,
    guideId,
    handleServerMessage,
    mintSession,
    region,
    voiceId,
  ]);

  const endCall = useCallback(async () => {
    setCallState("ended");
    await finalizeCall("completed");
  }, [finalizeCall]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Defensive cleanup if the component holding the hook unmounts mid-call.
  useEffect(() => {
    return () => {
      if (!finalizedRef.current && sessionIdRef.current) {
        void finalizeCall("interrupted");
      } else {
        teardown();
      }
    };
    // Intentionally empty deps — we only want this on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    callState,
    error,
    isAITalking,
    userSpeaking,
    transcript,
    currentUserUtterance,
    currentAssistantUtterance,
    startCall,
    endCall,
    toggleMute,
    isMuted,
  };
}

function reasonToMessage(
  reason:
    | "anonymous"
    | "guide-not-found"
    | "guide-not-ready"
    | "no-api-key"
    | "mint-failed",
): string {
  switch (reason) {
    case "anonymous":
      return "Sign in to start a deep-dive call.";
    case "guide-not-found":
      return "Couldn't load that career guide. Try refreshing.";
    case "guide-not-ready":
      return "This guide is still being prepared. Try again in a minute.";
    case "no-api-key":
      return "Voice calls aren't configured on this deployment.";
    case "mint-failed":
      return "Couldn't start the call session. Try again.";
  }
}
