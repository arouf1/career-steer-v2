"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type CallTimerState = "idle" | "connecting" | "connected" | "ended" | "error";

/**
 * Tracks call duration in seconds while the call is connected and a
 * conversation has actually started (someone has spoken). The "wait until
 * first speech" rule means connection setup time isn't counted against the
 * displayed duration, matches V1's behaviour.
 *
 * No time limits in this V2 port, discovery calls are unmetered for now.
 */
export function useCallTimer({
  callState,
  isAITalking,
  userSpeaking,
}: {
  callState: CallTimerState;
  isAITalking: boolean;
  userSpeaking: boolean;
}) {
  const [duration, setDuration] = useState(0);
  const [conversationStarted, setConversationStarted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatDuration = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }, []);

  const resetTimer = useCallback(() => {
    setDuration(0);
    setConversationStarted(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Reset when the call returns to idle. Adjust-during-render to avoid
  // a useEffect that mirrors callState.
  const [prevCallState, setPrevCallState] = useState(callState);
  if (prevCallState !== callState) {
    setPrevCallState(callState);
    if (callState === "idle") {
      if (duration !== 0) setDuration(0);
      if (conversationStarted) setConversationStarted(false);
    }
  }

  // Mark conversation as started the moment either side speaks.
  if (
    callState === "connected" &&
    (isAITalking || userSpeaking) &&
    !conversationStarted
  ) {
    setConversationStarted(true);
  }

  useEffect(() => {
    if (
      callState === "connected" &&
      conversationStarted &&
      !intervalRef.current
    ) {
      intervalRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else if (callState !== "connected" || !conversationStarted) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [callState, conversationStarted]);

  return { duration, formatDuration, resetTimer };
}
