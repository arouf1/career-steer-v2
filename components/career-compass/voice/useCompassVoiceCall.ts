"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  PCMPlayer,
  prewarmAudio,
  startPCMCapture,
  type PCMCaptureHandle,
  type PrewarmedAudio,
} from "@/lib/client/geminiAudio";
import {
  COMPASS_TOOL_NAMES,
  type CompassLaneKind,
  type CompassSurface,
  type CompassToolName,
} from "@/lib/ai/prompts/compassAdviser";

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

// The server now hands back a ready-to-send setup message (minimal on the
// ephemeral path, full on the API-key fallback path). The client just
// ws.send()s it on open — see convex/lib/voiceLiveConfig.ts for the full
// rationale. We keep `model` + `voice` as separate fields purely for
// console diagnostics / display, not for wire use.
type ServerSetupMessage = Record<string, unknown>;

type AuthCredential =
  | { type: "ephemeral_token"; value: string }
  | { type: "api_key"; value: string };

/**
 * Tool callbacks the dock wires from DiscoverCanvas. Each one performs the
 * action and returns a short result that the voice model uses as the source
 * of truth for its spoken reply ("Saved 'Product Manager'.", "Couldn't find
 * that card on your canvas.").
 *
 * Callbacks are read through a ref inside the WS handler so the live
 * connection always sees the latest closure even though `ws.onmessage` was
 * set up at call-start time. Same pattern as `mutedRef` below.
 */
export type CompassToolResult = { ok: true; message?: string } | {
  ok: false;
  message: string;
};

export type CompassToolCallbacks = {
  onOpenCard: (guideId: string) => Promise<CompassToolResult>;
  onCloseCard: () => Promise<CompassToolResult>;
  onSaveCard: (guideId: string) => Promise<CompassToolResult>;
  onUnsaveCard: (guideId: string) => Promise<CompassToolResult>;
  onDismissCard: (guideId: string) => Promise<CompassToolResult>;
  onUndismissCard: (guideId: string) => Promise<CompassToolResult>;
  onRefreshCanvas: () => Promise<CompassToolResult>;
  // Desktop only — undefined on mobile. The dispatcher returns an
  // unwired-tool error if the model calls a callback that's missing.
  onSetDensity?: (level: string) => Promise<CompassToolResult>;
  // Mobile only — undefined on desktop.
  onGoToLane?: (lane: string) => Promise<CompassToolResult>;
};

export type CompassDensityLevel = "focused" | "explore" | "wide";

export type UseCompassVoiceCallArgs = {
  voiceId?: string;
  tools?: CompassToolCallbacks;
  /**
   * Current density on the user's canvas. Determines (a) which cards get
   * baked into the system prompt at call start and (b) which cards the live
   * canvas-context query subscribes to. Read through a ref so the hook
   * always sees the current value when the call mints / the live query
   * fires.
   */
  densityLevel?: CompassDensityLevel;
  /**
   * Device surface — drives which tool list the server declares and how
   * the prompt frames navigation. Defaults to "desktop".
   */
  surface?: CompassSurface;
  /**
   * Mobile only — which lane is currently in view. Updates mid-call are
   * pushed to the model via clientContent so it knows what's on-screen.
   */
  activeLane?: CompassLaneKind;
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
  const {
    voiceId,
    tools,
    densityLevel = "focused",
    surface = "desktop",
    activeLane,
  } = args;

  const mintSession = useAction(api.compassVoiceNode.mintCompassSession);
  const appendMessage = useMutation(api.voiceCalls.appendMessage);
  const finalize = useMutation(api.voiceCalls.finalize);

  // Stash the latest tool callbacks in a ref so handleServerMessage (set up
  // once per call inside ws.onmessage) always reads the current closure.
  // Without this, callbacks captured at call-start would go stale if the
  // parent re-renders mid-call.
  const toolsRef = useRef<CompassToolCallbacks | undefined>(tools);
  useEffect(() => {
    toolsRef.current = tools;
  }, [tools]);

  // Same pattern for density — startCall reads through the ref so a slider
  // tick mid-mint doesn't get clobbered by a stale closure.
  const densityRef = useRef<CompassDensityLevel>(densityLevel);
  useEffect(() => {
    densityRef.current = densityLevel;
  }, [densityLevel]);

  const surfaceRef = useRef<CompassSurface>(surface);
  useEffect(() => {
    surfaceRef.current = surface;
  }, [surface]);

  const activeLaneRef = useRef<CompassLaneKind | undefined>(activeLane);
  useEffect(() => {
    activeLaneRef.current = activeLane;
  }, [activeLane]);

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
      if (finalizedRef.current) {
        console.log("[compass-voice] finalizeCall: already finalized, skip");
        return;
      }
      console.log("[compass-voice] finalizeCall: status=", status);
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

  // Dispatch a single function call to the matching ref-stashed callback.
  // Unknown names and missing/invalid args are reported back to the model as
  // `{ ok: false, message }` so it can apologise rather than silently retry.
  const runToolCall = useCallback(
    async (call: {
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }): Promise<CompassToolResult> => {
      const cbs = toolsRef.current;
      const name = call.name as CompassToolName | undefined;
      if (!name || !COMPASS_TOOL_NAMES.includes(name)) {
        return { ok: false, message: `Unknown tool: ${call.name ?? "(none)"}` };
      }
      if (!cbs) {
        return {
          ok: false,
          message: "Tools aren't wired up on this surface — describe instead.",
        };
      }
      try {
        switch (name) {
          case "openCard": {
            const guideId = call.args?.guideId;
            if (typeof guideId !== "string" || guideId.length === 0) {
              return { ok: false, message: "Missing guideId for openCard." };
            }
            return await cbs.onOpenCard(guideId);
          }
          case "closeCard":
            return await cbs.onCloseCard();
          case "saveCard": {
            const guideId = call.args?.guideId;
            if (typeof guideId !== "string" || guideId.length === 0) {
              return { ok: false, message: "Missing guideId for saveCard." };
            }
            return await cbs.onSaveCard(guideId);
          }
          case "unsaveCard": {
            const guideId = call.args?.guideId;
            if (typeof guideId !== "string" || guideId.length === 0) {
              return { ok: false, message: "Missing guideId for unsaveCard." };
            }
            return await cbs.onUnsaveCard(guideId);
          }
          case "dismissCard": {
            const guideId = call.args?.guideId;
            if (typeof guideId !== "string" || guideId.length === 0) {
              return { ok: false, message: "Missing guideId for dismissCard." };
            }
            return await cbs.onDismissCard(guideId);
          }
          case "undismissCard": {
            const guideId = call.args?.guideId;
            if (typeof guideId !== "string" || guideId.length === 0) {
              return {
                ok: false,
                message: "Missing guideId for undismissCard.",
              };
            }
            return await cbs.onUndismissCard(guideId);
          }
          case "refreshCanvas":
            return await cbs.onRefreshCanvas();
          case "setDensity": {
            const level = call.args?.level;
            if (typeof level !== "string" || level.length === 0) {
              return { ok: false, message: "Missing level for setDensity." };
            }
            if (!cbs.onSetDensity) {
              return {
                ok: false,
                message:
                  "Density isn't adjustable on this surface (mobile shows everything in a vertical pager).",
              };
            }
            return await cbs.onSetDensity(level);
          }
          case "goToLane": {
            const lane = call.args?.lane;
            if (typeof lane !== "string" || lane.length === 0) {
              return { ok: false, message: "Missing lane for goToLane." };
            }
            if (!cbs.onGoToLane) {
              return {
                ok: false,
                message:
                  "Lane navigation isn't needed on this surface — all four lanes are visible at once.",
              };
            }
            return await cbs.onGoToLane(lane);
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown tool error.";
        console.warn("useCompassVoiceCall: tool dispatch failed", name, err);
        return { ok: false, message };
      }
    },
    [],
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
      // back over the same socket — Gemini correlates by `id`.
      const toolCall = data.toolCall as
        | { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }
        | undefined;
      if (toolCall?.functionCalls?.length) {
        const calls = toolCall.functionCalls;
        console.log("[compass-voice] toolCall received:", calls);
        void (async () => {
          const responses = await Promise.all(
            calls.map(async (c) => {
              const result = await runToolCall(c);
              console.log("[compass-voice] tool dispatched:", c.name, "→", result);
              return {
                id: c.id,
                name: c.name,
                response: result,
              };
            }),
          );
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            console.log("[compass-voice] sending toolResponse:", responses);
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
    [persistMessage, runToolCall],
  );

  const startCall = useCallback(async () => {
    console.log(
      "[compass-voice] startCall: begin",
      "callState=",
      callState,
      "ua=",
      typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
    );
    if (callState !== "idle" && callState !== "ended" && callState !== "error") {
      console.log("[compass-voice] startCall: bail, callState not idle/ended/error");
      return;
    }

    // ── iOS Safari guard ────────────────────────────────────────────────
    // Acquire mic + create + resume both AudioContexts INSIDE the user-
    // gesture sync window. iOS rejects getUserMedia called after any await,
    // and starts AudioContexts suspended unless resumed from a gesture.
    // Must run before any await — including before the React state updates
    // below (those are sync, but keeping the prewarm above any other work
    // makes the gesture-window contract obvious).
    let prewarm: PrewarmedAudio;
    try {
      prewarm = prewarmAudio();
    } catch (err) {
      console.warn("[compass-voice] prewarmAudio threw", err);
      setError("Couldn't open audio on this device. Try another browser.");
      setCallState("error");
      return;
    }

    setError(null);
    setCallState("connecting");
    finalizedRef.current = false;
    console.log("[compass-voice] startCall: state=connecting, racing mint+mic");

    // Race mint and mic-permission in parallel — both are network/UI round
    // trips, no point serialising them.
    let mintResult: Awaited<ReturnType<typeof mintSession>>;
    let micStream: MediaStream;
    try {
      const [mr, ms] = await Promise.all([
        mintSession({
          voiceId,
          densityLevel: densityRef.current,
          surface: surfaceRef.current,
          activeLane: activeLaneRef.current,
        }),
        (async () => {
          const stream = await prewarm.streamPromise;
          await prewarm.ready;
          return stream;
        })(),
      ]);
      mintResult = mr;
      micStream = ms;
      console.log(
        "[compass-voice] mint+mic resolved",
        "mintOk=",
        mintResult.ok,
        "tracks=",
        micStream.getTracks().length,
      );
    } catch (err) {
      const name = err instanceof Error ? err.name : "Unknown";
      console.warn("[compass-voice] prewarm/mint failed", name, err);
      setError(
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser settings and try again."
          : name === "NotFoundError"
          ? "No microphone found on this device."
          : err instanceof Error
          ? err.message
          : "Failed to start the call.",
      );
      setCallState("error");
      prewarm.abort();
      return;
    }
    if (!mintResult.ok) {
      console.warn("[compass-voice] mint not ok, reason=", mintResult.reason);
      setError(reasonToMessage(mintResult.reason));
      setCallState("error");
      prewarm.abort();
      return;
    }

    sessionIdRef.current = mintResult.sessionId;
    startedAtRef.current = Date.now();
    const setupMessage: ServerSetupMessage =
      mintResult.setupMessage as ServerSetupMessage;
    const auth: AuthCredential = mintResult.auth;

    const isEphemeral = auth.type === "ephemeral_token";
    const baseUrl = isEphemeral ? GEMINI_WS_URL_EPHEMERAL : GEMINI_WS_URL_APIKEY;
    const authParam = isEphemeral
      ? `access_token=${encodeURIComponent(auth.value)}`
      : `key=${encodeURIComponent(auth.value)}`;
    const wsUrl = `${baseUrl}?${authParam}`;
    console.log(
      "[compass-voice] opening WS",
      "isEphemeral=",
      isEphemeral,
      "model=",
      mintResult.model,
      "voice=",
      mintResult.voice,
    );

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const player = new PCMPlayer({
      audioContext: prewarm.playbackContext,
      onPlaybackStart: () => setIsAITalking(true),
      onPlaybackEnd: () => setIsAITalking(false),
    });
    playerRef.current = player;

    ws.onopen = () => {
      console.log("[compass-voice] ws.onopen");
      // Setup is built server-side (see convex/lib/voiceLiveConfig.ts).
      // Ephemeral path: minimal — just `setup.model`. The full session
      // config is bound at the token via liveConnectConstraints, so the
      // constrained WS endpoint pulls it from there.
      // API-key fallback path: full setup payload, model + every option.
      const isMinimalSetup =
        Object.keys(
          (setupMessage as { setup?: Record<string, unknown> }).setup ?? {},
        ).length === 1;
      console.log(
        "[compass-voice] sending setup",
        "isMinimal=",
        isMinimalSetup,
      );
      try {
        ws.send(JSON.stringify(setupMessage));
        console.log("[compass-voice] setup sent");
      } catch (err) {
        console.error("[compass-voice] setup send failed", err);
      }
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
        console.log(
          "[compass-voice] ws.onmessage keys=",
          Object.keys(data),
        );

        handleServerMessage(data);

        if ("setupComplete" in data && !captureRef.current) {
          console.log("[compass-voice] setupComplete received, starting PCM capture");
          try {
            const handle = await startPCMCapture(
              (base64PCM) => {
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
              },
              {
                stream: micStream,
                audioContext: prewarm.captureContext,
              },
            );
            captureRef.current = handle;
            // Surface the handle to the dock for analyser attachment.
            setCaptureHandle(handle);
            console.log("[compass-voice] capture handle wired to ref + state");
          } catch (err) {
            const name = err instanceof Error ? err.name : "Unknown";
            console.error(
              "[compass-voice] mic capture failed",
              "name=",
              name,
              err,
            );
            setError(
              "Couldn't start the microphone. Try again in a moment.",
            );
            setCallState("error");
            await finalizeCall("error");
            return;
          }

          console.log("[compass-voice] sending hello realtimeInput.text");
          wsRef.current?.send(
            JSON.stringify({ realtimeInput: { text: "Hello" } }),
          );
        }
      } catch (err) {
        console.warn("[compass-voice] ws.onmessage parse error", err);
      }
    };

    ws.onerror = (event) => {
      console.warn("[compass-voice] ws.onerror", event);
      setError("Connection error. Try again in a moment.");
      setCallState("error");
      void finalizeCall("error");
    };

    ws.onclose = (event) => {
      console.log(
        "[compass-voice] ws.onclose",
        "code=",
        event.code,
        "reason=",
        event.reason,
        "wasClean=",
        event.wasClean,
      );
      if (!finalizedRef.current) {
        setCallState((prev) =>
          prev === "connected" || prev === "connecting" ? "ended" : prev,
        );
        void finalizeCall("interrupted");
      }
    };
  }, [callState, finalizeCall, handleServerMessage, mintSession, voiceId]);

  const endCall = useCallback(async () => {
    console.log("[compass-voice] endCall: user-initiated");
    setCallState("ended");
    await finalizeCall("completed");
  }, [finalizeCall]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // ── Realtime canvas sync ────────────────────────────────────────────────
  // Subscribe to the live canvas-context query whenever a call is in flight
  // (connecting / connected). When the formatted canvas text changes —
  // density tick, save/dismiss reaction, snapshot regen — push it to the
  // model via `clientContent` with `turnComplete: false` so it lands in the
  // running session context without triggering a model response of its own.
  const liveContextActive =
    callState === "connecting" || callState === "connected";
  const liveContext = useQuery(
    api.compassVoice.getLiveCanvasContext,
    liveContextActive ? { densityLevel } : "skip",
  );
  const lastSentLiveContextRef = useRef<string | null>(null);
  // Reset the dedupe ref whenever a new call starts so the first update of
  // the next call isn't suppressed against a previous call's value.
  useEffect(() => {
    if (callState === "idle" || callState === "ended" || callState === "error") {
      lastSentLiveContextRef.current = null;
    }
  }, [callState]);
  useEffect(() => {
    if (callState !== "connected") return;
    if (!liveContext) return;
    const text = liveContext.text;
    if (text === lastSentLiveContextRef.current) return;
    // Debounce so a slider drag (which fires three setDensity ticks in <1s)
    // coalesces into one update.
    const t = setTimeout(() => {
      if (
        wsRef.current?.readyState !== WebSocket.OPEN ||
        !setupCompleteRef.current
      ) {
        return;
      }
      const message = `[Canvas state — density: ${liveContext.densityLevel}; saved: ${liveContext.savedCount}]\n${text}`;
      wsRef.current.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: "user", parts: [{ text: message }] }],
            // turnComplete: false → the model absorbs this into the running
            // turn context without producing a response. The user's next
            // audio chunk closes the turn for it.
            turnComplete: false,
          },
        }),
      );
      lastSentLiveContextRef.current = text;
    }, 500);
    return () => clearTimeout(t);
  }, [callState, liveContext]);

  // Mobile only — push activeLane changes to the model mid-call so it
  // knows what's actually on the user's screen as they swipe between
  // lanes. The same clientContent / turnComplete: false pattern as the
  // canvas-state sync above.
  const lastSentActiveLaneRef = useRef<CompassLaneKind | null>(null);
  useEffect(() => {
    if (callState === "idle" || callState === "ended" || callState === "error") {
      lastSentActiveLaneRef.current = null;
    }
  }, [callState]);
  useEffect(() => {
    if (callState !== "connected") return;
    if (!activeLane) return;
    if (activeLane === lastSentActiveLaneRef.current) return;
    const t = setTimeout(() => {
      if (
        wsRef.current?.readyState !== WebSocket.OPEN ||
        !setupCompleteRef.current
      ) {
        return;
      }
      wsRef.current.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: "user",
                parts: [{ text: `[Active lane changed: ${activeLane}]` }],
              },
            ],
            turnComplete: false,
          },
        }),
      );
      lastSentActiveLaneRef.current = activeLane;
    }, 200);
    return () => clearTimeout(t);
  }, [callState, activeLane]);

  useEffect(() => {
    return () => {
      console.log(
        "[compass-voice] hook unmount cleanup",
        "finalized=",
        finalizedRef.current,
        "hasSession=",
        !!sessionIdRef.current,
      );
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
