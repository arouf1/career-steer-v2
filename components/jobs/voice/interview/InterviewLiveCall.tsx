"use client";

import { useEffect, useState } from "react";
import { useRive, useStateMachineInput } from "@rive-app/react-webgl2";
import type { Id } from "@/convex/_generated/dataModel";
import { useInterviewCall } from "./useInterviewCall";
import { VoiceCallHeader } from "@/components/career-guides/voice-call/VoiceCallHeader";
import { VoiceCallAnimation } from "@/components/career-guides/voice-call/VoiceCallAnimation";
import { VoiceCallTranscription } from "@/components/career-guides/voice-call/VoiceCallTranscription";
import { VoiceCallStatus } from "@/components/career-guides/voice-call/VoiceCallStatus";
import { VoiceCallControls } from "@/components/career-guides/voice-call/VoiceCallControls";
import { useCallTimer } from "@/components/career-guides/voice-call/useCallTimer";

type Props = {
  jobPostingId: Id<"job_postings">;
  callTitle: string;
  voiceId?: string;
  onEnded: (callId: Id<"voice_calls"> | null) => void;
  onPrepSessionId: (id: string) => void;
};

export function InterviewLiveCall({
  jobPostingId,
  callTitle,
  voiceId,
  onEnded,
  onPrepSessionId,
}: Props) {
  const call = useInterviewCall({ jobPostingId, voiceId });
  const [showTranscription, setShowTranscription] = useState(false);
  const [hasReportedEnded, setHasReportedEnded] = useState(false);

  const timer = useCallTimer({
    callState: call.callState,
    isAITalking: call.isAITalking,
    userSpeaking: call.userSpeaking,
  });

  const { rive, RiveComponent } = useRive({
    src: "/halo-2.0.riv",
    stateMachines: "default",
    autoplay: true,
  });
  const listeningInput = useStateMachineInput(rive, "default", "listening");
  const thinkingInput = useStateMachineInput(rive, "default", "thinking");
  const speakingInput = useStateMachineInput(rive, "default", "speaking");

  const isListening =
    call.callState === "connected" && call.userSpeaking && !call.isAITalking;
  const isThinking =
    call.callState === "connecting" ||
    (call.callState === "connected" && !call.userSpeaking && !call.isAITalking);
  const isSpeaking = call.callState === "connected" && call.isAITalking;

  useEffect(() => {
    // StateMachineInput.value is a Rive mutable setter, not React state — safe to assign.
    /* eslint-disable react-hooks/immutability */
    if (listeningInput) listeningInput.value = isListening;
    if (thinkingInput) thinkingInput.value = isThinking;
    if (speakingInput) speakingInput.value = isSpeaking;
    /* eslint-enable react-hooks/immutability */
  }, [isListening, isThinking, isSpeaking, listeningInput, thinkingInput, speakingInput]);

  // Auto-start on mount.
  useEffect(() => {
    void call.startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface prep session id upward as soon as we have it.
  useEffect(() => {
    if (call.prepSessionId) onPrepSessionId(call.prepSessionId);
  }, [call.prepSessionId, onPrepSessionId]);

  // Notify parent when the call ends so it can advance to Phase 3.
  // Setting state inside this effect is intentional — it's a one-shot guard
  // that prevents the onEnded callback from firing more than once.
  useEffect(() => {
    if ((call.callState === "ended" || call.callState === "error") && !hasReportedEnded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasReportedEnded(true);
      onEnded(call.callId ?? null);
    }
  }, [call.callState, call.callId, hasReportedEnded, onEnded]);

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-hidden p-4 sm:p-6">
      <VoiceCallHeader
        guideTitle={callTitle}
        duration={timer.duration}
        formatDuration={timer.formatDuration}
      />

      {!showTranscription ? (
        <VoiceCallAnimation RiveComponent={RiveComponent} rive={rive} />
      ) : (
        <VoiceCallTranscription
          messages={call.transcript}
          currentAssistantUtterance={call.currentAssistantUtterance}
          callState={call.callState}
        />
      )}

      {(call.callState === "connected" || call.callState === "connecting") && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowTranscription((v) => !v)}
            className="rounded-pill bg-paper-raised px-4 py-1.5 text-[12px] font-medium text-mute transition-colors duration-200 hover:bg-ink/5 hover:text-ink"
          >
            {showTranscription ? "Show animation" : "Show transcript"}
          </button>
        </div>
      )}

      <VoiceCallStatus statusText={statusFor(call.callState)} error={call.error} />

      <VoiceCallControls
        callState={call.callState}
        isMuted={call.isMuted}
        isProcessing={false}
        onToggleMute={call.toggleMute}
        onEndCall={async () => {
          await call.endCall();
        }}
        onClose={() => void 0}
      />
    </div>
  );
}

function statusFor(state: string): string {
  switch (state) {
    case "idle":
      return "Ready to connect";
    case "connecting":
      return "Connecting to your interviewer…";
    case "connected":
      return "Interview in progress";
    case "ended":
      return "Interview complete";
    case "error":
      return "Connection error";
    default:
      return "";
  }
}
