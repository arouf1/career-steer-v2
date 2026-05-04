"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Phone, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompassVoiceCall } from "./useCompassVoiceCall";
import { Waveform } from "./Waveform";
import { CompassVoiceControls } from "./CompassVoiceControls";

type Props = {
  /**
   * Whether the canvas snapshot is ready. The dock disables itself while the
   * compass is generating or failed — minting a session against a non-ready
   * canvas would just bounce server-side, so we keep the affordance honest.
   */
  canvasReady: boolean;
  /** Tailwind classes for outer wrapper positioning. */
  className?: string;
  /** Sticky-mobile variant: rounder dock + smaller pill, stretches to 100%. */
  variant?: "floating" | "sticky";
};

/**
 * Career Compass voice assistant dock.
 *
 * Idle: small pill button anchored bottom-right of the canvas wrapper. Click
 * starts the call. While connecting / connected, the pill expands into an
 * ambient bar with mic frequency waveform + status line + mute / end-call
 * controls. Caption-free by design — the canvas should remain the focal
 * point; the full transcript persists server-side and lands in the post-call
 * summary.
 */
export function CompassVoiceDock({
  canvasReady,
  className,
  variant = "floating",
}: Props) {
  const call = useCompassVoiceCall();
  const [recentlyEnded, setRecentlyEnded] = useState(false);

  // When the call ends or errors we briefly show a confirmation in the dock
  // before collapsing back to the idle pill. Lets the user register that
  // something happened without forcing them to click "close".
  useEffect(() => {
    if (call.callState === "ended" || call.callState === "error") {
      setRecentlyEnded(true);
      const timer = setTimeout(() => setRecentlyEnded(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [call.callState]);

  const isLive =
    call.callState === "connecting" || call.callState === "connected";
  const showPill = !isLive && !recentlyEnded;
  const showEndedFlash = recentlyEnded && !isLive;

  // Build (and tear down) an AnalyserNode pinned to the live capture's
  // sourceNode. Reusing the existing node keeps us at one MediaStreamSource
  // for the audio graph instead of two.
  const analyser = useAnalyserFromCapture(call.captureHandle);

  const statusLine = useMemo(() => {
    switch (call.callState) {
      case "connecting":
        return "Connecting…";
      case "connected":
        if (call.isAITalking) return "Adviser is speaking";
        if (call.userSpeaking) return "Listening — go ahead";
        return "Open mic — talk to me";
      default:
        return "";
    }
  }, [call.callState, call.isAITalking, call.userSpeaking]);

  return (
    <div
      className={cn(
        variant === "floating"
          ? "absolute bottom-4 right-4 z-30"
          : "sticky bottom-0 z-30 px-3 pb-3",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {showPill && (
          <motion.button
            key="pill"
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.2, 0.65, 0.3, 1] }}
            onClick={() => void call.startCall()}
            disabled={!canvasReady}
            aria-label="Talk to your compass"
            // Visual match for the canvas's existing zoom + settings cluster:
            // bg-ink / text-paper / hover:bg-ink-deep, no border, no shadow.
            className={cn(
              "inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-ink-deep",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
              "disabled:cursor-not-allowed disabled:opacity-50",
              variant === "sticky" ? "w-full justify-center" : "",
            )}
          >
            <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
            Talk to your compass
          </motion.button>
        )}

        {isLive && (
          <motion.div
            key="dock"
            initial={{ opacity: 0, y: 8, width: 0 }}
            animate={{
              opacity: 1,
              y: 0,
              width: variant === "floating" ? 480 : "100%",
            }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22, ease: [0.2, 0.65, 0.3, 1] }}
            // Dark dock: matches the canvas's existing zoom + settings cluster
            // (bg-ink). Border-free; the contrast against the white canvas is
            // strong enough on its own.
            className={cn(
              "overflow-hidden rounded-2xl bg-ink",
              variant === "floating" ? "max-w-[480px]" : "w-full",
            )}
            role="region"
            aria-label="Compass voice call"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper/10 text-paper">
                {call.callState === "connecting" ? (
                  <Loader2
                    aria-hidden
                    className="h-3.5 w-3.5 animate-spin"
                    strokeWidth={1.75}
                  />
                ) : (
                  <Phone aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] uppercase tracking-[0.12em] text-paper/55">
                  {statusLine}
                </p>
                <Waveform
                  analyser={analyser}
                  active={call.callState === "connected"}
                  height={28}
                  tone="light"
                />
              </div>

              <CompassVoiceControls
                isMuted={call.isMuted}
                onToggleMute={call.toggleMute}
                onEndCall={() => void call.endCall()}
              />
            </div>
          </motion.div>
        )}

        {showEndedFlash && (
          <motion.div
            key="ended"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.2, 0.65, 0.3, 1] }}
            // Same dark surface as the pill + dock for visual continuity
            // when the call collapses. Paper-tinted copy keeps the moment
            // quiet without losing legibility.
            className={cn(
              "rounded-pill bg-ink px-4 py-2 text-[13px] text-paper/70",
              variant === "sticky" ? "w-full text-center" : "",
            )}
            role="status"
          >
            {call.callState === "error"
              ? (call.error ?? "Connection error")
              : "Call ended — summary saved"}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Build an AnalyserNode pinned to the capture's sourceNode whenever the
 * capture is live, and tear it down when it's not. Returns null while idle
 * so the Waveform falls back to its procedural resting animation.
 */
function useAnalyserFromCapture(
  captureHandle:
    | ReturnType<typeof useCompassVoiceCall>["captureHandle"]
    | null,
): AnalyserNode | null {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (!captureHandle) {
      analyserRef.current = null;
      setAnalyser(null);
      return;
    }
    const a = captureHandle.audioContext.createAnalyser();
    a.fftSize = 256;
    a.smoothingTimeConstant = 0.85;
    captureHandle.sourceNode.connect(a);
    analyserRef.current = a;
    setAnalyser(a);
    return () => {
      try {
        captureHandle.sourceNode.disconnect(a);
      } catch {
        // already disconnected (audioContext may be closed)
      }
      analyserRef.current = null;
      setAnalyser(null);
    };
  }, [captureHandle]);

  return analyser;
}
