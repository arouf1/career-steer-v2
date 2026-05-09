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
 * Realtime voice hook for the interview-simulation feature.
 *
 * Cloned from useJobVoiceCall — the WebSocket + PCM plumbing is identical
 * to the deep-dive call. The differences:
 *   - mints from api.interviewSimNode.mintInterviewSession (passing
 *     prepSessionId so the server can write status updates the dialog
 *     subscribes to)
 *   - surfaces prepSessionId on the return so the dialog can subscribe
 *     to the prep-status doc during Phase 1
 *   - returns the same shape as useJobVoiceCall so the dialog body can
 *     stay near-identical
 *
 * A unification refactor (extract the WebSocket loop into a shared base
 * hook taking a `mintActionRef`) is a deliberate post-MVP follow-up.
 */

const GEMINI_WS_URL_EPHEMERAL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
const GEMINI_WS_URL_APIKEY =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export type InterviewCallState =
  | "idle"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export type InterviewTranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
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
  tools: unknown[];
};

type AuthCredential =
  | { type: "ephemeral_token"; value: string }
  | { type: "api_key"; value: string };

export type UseInterviewCallArgs = {
  jobPostingId: Id<"job_postings">;
  voiceId?: string;
};

export type UseInterviewCallReturn = {
  callState: InterviewCallState;
  error: string | null;
  isAITalking: boolean;
  userSpeaking: boolean;
  transcript: InterviewTranscriptEntry[];
  currentAssistantUtterance: string;
  startCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  isMuted: boolean;
  callId: Id<"voice_calls"> | null;
  prepSessionId: string | null;
};

export function useInterviewCall(
  args: UseInterviewCallArgs,
): UseInterviewCallReturn {
  const { jobPostingId, voiceId } = args;

  const mintSession = useAction(api.interviewSimNode.mintInterviewSession);
  const appendMessage = useMutation(api.voiceCalls.appendMessage);
  const finalize = useMutation(api.voiceCalls.finalize);
  const markCovered = useMutation(api.voiceCalls.markDimensionCovered);

  const [callState, setCallState] = useState<InterviewCallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isAITalking, setIsAITalking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<InterviewTranscriptEntry[]>([]);
  const [currentAssistantUtterance, setCurrentAssistantUtterance] =
    useState("");
  const [isMuted, setIsMuted] = useState(false);
  // These are exposed as reactive return values AND read in async closures —
  // keep both a ref (for stable closure access) and a matching state.
  const [callId, setCallId] = useState<Id<"voice_calls"> | null>(null);
  const [prepSessionId, setPrepSessionId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const captureRef = useRef<PCMCaptureHandle | null>(null);
  const setupCompleteRef = useRef(false);
  const mutedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const callIdRef = useRef<Id<"voice_calls"> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const pendingAssistantRef = useRef<string>("");
  const finalizedRef = useRef(false);
  const prepSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

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
        console.warn("useInterviewCall: appendMessage failed", err);
      }
    },
    [appendMessage],
  );

  // Dispatch a single Gemini Live function call to the matching Convex mutation.
  // Returns { ok: false, error } rather than throwing so the WS message handler
  // can never crash on a malformed or unknown call.
  const runToolCall = useCallback(
    async (call: {
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }): Promise<{ ok: boolean; [key: string]: unknown }> => {
      if (!call.name) return { ok: false, error: "missing function name" };
      if (call.name !== "markDimensionCovered") {
        return { ok: false, error: `unknown function: ${call.name}` };
      }

      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return { ok: false, error: "no active session" };
      }

      const args = call.args ?? {};
      const dimension =
        typeof args.dimension === "string" ? args.dimension : null;
      const evidence =
        typeof args.evidence === "string" ? args.evidence : null;
      const confidenceRaw =
        typeof args.confidence === "string" ? args.confidence : null;
      const confidence =
        confidenceRaw === "weak" ||
        confidenceRaw === "solid" ||
        confidenceRaw === "strong"
          ? confidenceRaw
          : null;

      if (!dimension || !evidence || !confidence) {
        return { ok: false, error: "invalid args" };
      }

      try {
        const result = await markCovered({
          sessionId,
          dimension,
          evidence,
          confidence,
        });
        return result;
      } catch (err) {
        console.error("[interview-voice] markDimensionCovered failed", err);
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [markCovered],
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
          await finalize({ sessionId, status, totalDurationSeconds });
        } catch (err) {
          console.warn("useInterviewCall: finalize failed", err);
        }
      }
      sessionIdRef.current = null;
      callIdRef.current = null;
      setCallId(null);
      startedAtRef.current = null;
      prepSessionIdRef.current = null;
      setPrepSessionId(null);
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

      // Tool calls arrive as their own top-level message, separate from
      // `serverContent`. Run each, then ship a single `toolResponse` frame
      // back over the same socket — Gemini correlates by `id`. Mirrors
      // useCompassVoiceCall.
      const toolCall = data.toolCall as
        | {
            functionCalls?: Array<{
              id?: string;
              name?: string;
              args?: Record<string, unknown>;
            }>;
          }
        | undefined;
      if (toolCall?.functionCalls?.length) {
        const calls = toolCall.functionCalls;
        console.log("[interview-voice] toolCall received:", calls);
        void (async () => {
          const responses = await Promise.all(
            calls.map(async (c) => {
              const result = await runToolCall(c);
              console.log("[interview-voice] tool dispatched:", c.name, "→", result);
              return {
                id: c.id,
                name: c.name,
                response: result,
              };
            }),
          );
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                toolResponse: { functionResponses: responses },
              }),
            );
          }
        })();
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

      if (sc.interrupted) {
        playerRef.current?.interrupt();
        setIsAITalking(false);
        setUserSpeaking(true);
      }
    },
    [persistMessage, runToolCall],
  );

  const startCall = useCallback(async () => {
    if (callState !== "idle" && callState !== "ended" && callState !== "error") {
      return;
    }

    setError(null);
    setTranscript([]);
    setCurrentAssistantUtterance("");
    setCallState("connecting");
    finalizedRef.current = false;

    if (!prepSessionIdRef.current) {
      const newPrepId = crypto.randomUUID();
      prepSessionIdRef.current = newPrepId;
      setPrepSessionId(newPrepId);
    }

    let mintResult: Awaited<ReturnType<typeof mintSession>>;
    try {
      mintResult = await mintSession({
        jobPostingId,
        prepSessionId: prepSessionIdRef.current,
        voiceId,
      });
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
    callIdRef.current = mintResult.callId ?? null;
    setCallId(mintResult.callId ?? null);
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
          tools: config.tools,
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
          } catch (err) {
            console.error("useInterviewCall: mic capture failed", err);
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
        console.warn("useInterviewCall: message parse error", err);
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
  }, [
    callState,
    finalizeCall,
    handleServerMessage,
    jobPostingId,
    mintSession,
    voiceId,
  ]);

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
    transcript,
    currentAssistantUtterance,
    startCall,
    endCall,
    toggleMute,
    isMuted,
    callId,
    prepSessionId,
  };
}

function reasonToMessage(
  reason:
    | "anonymous"
    | "posting-not-found"
    | "posting-not-ready"
    | "rate-limited"
    | "research-failed"
    | "no-api-key",
): string {
  switch (reason) {
    case "anonymous":
      return "Please sign in to start an interview.";
    case "posting-not-found":
      return "We couldn't find this posting.";
    case "posting-not-ready":
      return "This posting is still being prepared.";
    case "rate-limited":
      return "You've run 5 mock interviews today. Come back tomorrow.";
    case "research-failed":
      return "We couldn't research this company right now.";
    case "no-api-key":
      return "Voice service is unavailable. Please try again shortly.";
  }
}
