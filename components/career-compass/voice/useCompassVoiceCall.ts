"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  PCMPlayer,
  startPCMCapture,
  type PCMCaptureHandle,
} from "@/lib/client/geminiAudio";

/**
 * Career Compass voice assistant hook — parallel to useDeepDiveCall, with
 * three differences:
 *
 *  1. Mints via api.compassVoiceNode.mintCompassSession (no guideId / region
 *     args; the action loads the user's latest canvas snapshot itself).
 *  2. Exposes the live PCMCaptureHandle so the ambient dock can wire an
 *     AnalyserNode into the dock's waveform without duplicating the
 *     MediaStreamSource.
 *  3. Doesn't expose a transcript array — the compass surface is caption-
 *     free by design (transcripts still persist server-side).
 *
 * Same WebSocket → setup → mic capture lifecycle as the per-guide path.
 */

const GEMINI_WS_URL_EPHEMERAL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
const GEMINI_WS_URL_APIKEY =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export type CompassCallState =
  | "idle"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

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

export type UseCompassVoiceCallArgs = {
  voiceId?: string;
};

export type UseCompassVoiceCallReturn = {
  callState: CompassCallState;
  error: string | null;
  isAITalking: boolean;
  userSpeaking: boolean;
  /**
   * Live capture handle — null until the call is connected. The dock uses
   * `captureHandle.audioContext` + `captureHandle.sourceNode` to attach an
   * AnalyserNode for the waveform visualisation.
   */
  captureHandle: PCMCaptureHandle | null;
  startCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  isMuted: boolean;
};

export function useCompassVoiceCall(
  args: UseCompassVoiceCallArgs = {},
): UseCompassVoiceCallReturn {
  const { voiceId } = args;

  const mintSession = useAction(api.compassVoiceNode.mintCompassSession);
  const appendMessage = useMutation(api.voiceCalls.appendMessage);
  const finalize = useMutation(api.voiceCalls.finalize);

  const [callState, setCallState] = useState<CompassCallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isAITalking, setIsAITalking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [captureHandle, setCaptureHandle] = useState<PCMCaptureHandle | null>(
    null,
  );

  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const captureRef = useRef<PCMCaptureHandle | null>(null);
  const setupCompleteRef = useRef(false);
  const mutedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const pendingAssistantRef = useRef<string>("");
  const finalizedRef = useRef(false);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  // Persist a transcript message server-side. The compass surface doesn't
  // render it locally, but we still keep the full transcript on disk for the
  // post-call summary.
  const persistMessage = useCallback(
    async (message: AppendMessageInput) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      try {
        await appendMessage({ sessionId, message });
      } catch (err) {
        console.warn("useCompassVoiceCall: appendMessage failed", err);
      }
    },
    [appendMessage],
  );

  const teardown = useCallback(() => {
    setupCompleteRef.current = false;
    captureRef.current?.stop();
    captureRef.current = null;
    setCaptureHandle(null);
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
          await finalize({ sessionId, status, totalDurationSeconds });
        } catch (err) {
          console.warn("useCompassVoiceCall: finalize failed", err);
        }
      }
      sessionIdRef.current = null;
      startedAtRef.current = null;
    },
    [finalize, teardown],
  );

  const handleServerMessage = useCallback(
    (data: Record<string, unknown>) => {
      if ("setupComplete" in data) {
        setupCompleteRef.current = true;
        setCallState("connected");
        return;
      }

      const sc = data.serverContent as Record<string, unknown> | undefined;
      if (!sc) return;

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
        }
      }

      const outputTx = sc.outputTranscription as { text?: string } | undefined;
      if (outputTx?.text) {
        pendingAssistantRef.current += outputTx.text;
      }

      if (sc.turnComplete) {
        const accumulated = pendingAssistantRef.current.trim();
        pendingAssistantRef.current = "";
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
    setCallState("connecting");
    finalizedRef.current = false;

    let mintResult: Awaited<ReturnType<typeof mintSession>>;
    try {
      mintResult = await mintSession({ voiceId });
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
          systemInstruction: { parts: [{ text: config.systemInstruction }] },
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
              endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
              prefixPaddingMs: 200,
              silenceDurationMs: 500,
            },
          },
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
            // Surface the handle to the dock for analyser attachment.
            setCaptureHandle(handle);
          } catch (err) {
            console.error("useCompassVoiceCall: mic capture failed", err);
            setError(
              "Microphone access was denied or unavailable. Allow it in your browser settings and try again.",
            );
            setCallState("error");
            await finalizeCall("error");
            return;
          }

          wsRef.current?.send(
            JSON.stringify({ realtimeInput: { text: "Hello" } }),
          );
        }
      } catch (err) {
        console.warn("useCompassVoiceCall: message parse error", err);
      }
    };

    ws.onerror = () => {
      setError("Connection error. Try again in a moment.");
      setCallState("error");
      void finalizeCall("error");
    };

    ws.onclose = () => {
      if (!finalizedRef.current) {
        setCallState((prev) =>
          prev === "connected" || prev === "connecting" ? "ended" : prev,
        );
        void finalizeCall("interrupted");
      }
    };
  }, [callState, finalizeCall, handleServerMessage, mintSession, voiceId]);

  const endCall = useCallback(async () => {
    setCallState("ended");
    await finalizeCall("completed");
  }, [finalizeCall]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  useEffect(() => {
    return () => {
      if (!finalizedRef.current && sessionIdRef.current) {
        void finalizeCall("interrupted");
      } else {
        teardown();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    callState,
    error,
    isAITalking,
    userSpeaking,
    captureHandle,
    startCall,
    endCall,
    toggleMute,
    isMuted,
  };
}

function reasonToMessage(
  reason: "anonymous" | "canvas-not-ready" | "no-api-key",
): string {
  switch (reason) {
    case "anonymous":
      return "Sign in to talk to your compass.";
    case "canvas-not-ready":
      return "Your compass is still loading. Try again in a moment.";
    case "no-api-key":
      return "Voice calls aren't configured on this deployment.";
  }
}
