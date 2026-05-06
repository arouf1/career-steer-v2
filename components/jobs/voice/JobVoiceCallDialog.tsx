"use client";

import { useEffect, useRef, useState } from "react";
import { useRive, useStateMachineInput } from "@rive-app/react-webgl2";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Id } from "@/convex/_generated/dataModel";
import { useJobVoiceCall } from "./useJobVoiceCall";
import { VoiceCallHeader } from "@/components/career-guides/voice-call/VoiceCallHeader";
import { VoiceCallAnimation } from "@/components/career-guides/voice-call/VoiceCallAnimation";
import { VoiceCallTranscription } from "@/components/career-guides/voice-call/VoiceCallTranscription";
import { VoiceCallStatus } from "@/components/career-guides/voice-call/VoiceCallStatus";
import { VoiceCallControls } from "@/components/career-guides/voice-call/VoiceCallControls";
import { useCallTimer } from "@/components/career-guides/voice-call/useCallTimer";

type Props = {
  jobPostingId: Id<"job_postings">;
  /** Pre-formatted "<role> at <company>" string for the header line. */
  callTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voiceId?: string;
};

/**
 * Per-job-posting voice deep-dive modal. Mirrors DeepDiveCallDialog —
 * fixed-frame card with header, focal animation (Rive halo), toggleable
 * transcription, status text, and a compact 2-button control bar.
 *
 * Opened from JobVoiceCallTile already committed to a call — no in-modal
 * "Start call" button. Closing the modal during a live call ends the call
 * cleanly via the underlying hook.
 */
export function JobVoiceCallDialog({
  jobPostingId,
  callTitle,
  open,
  onOpenChange,
  voiceId,
}: Props) {
  const call = useJobVoiceCall({ jobPostingId, voiceId });
  const [showTranscription, setShowTranscription] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const startedRef = useRef(false);

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
    (call.callState === "connected" &&
      !call.userSpeaking &&
      !call.isAITalking);
  const isSpeaking = call.callState === "connected" && call.isAITalking;

  useEffect(() => {
    if (listeningInput) {
      // eslint-disable-next-line react-hooks/immutability
      listeningInput.value = isListening;
    }
    if (thinkingInput) {
      // eslint-disable-next-line react-hooks/immutability
      thinkingInput.value = isThinking;
    }
    if (speakingInput) {
      // eslint-disable-next-line react-hooks/immutability
      speakingInput.value = isSpeaking;
    }
  }, [
    isListening,
    isThinking,
    isSpeaking,
    listeningInput,
    thinkingInput,
    speakingInput,
  ]);

  // Auto-start when the dialog opens. The user has already clicked "Start
  // call" on the tile.
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setCanClose(false);
      setShowTranscription(false);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    void call.startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (call.callState === "ended" || call.callState === "error") {
      setCanClose(true);
    }
  }, [call.callState]);

  const handleEndCall = async () => {
    await call.endCall();
  };

  const handleOpenChange = async (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (
      (call.callState === "connecting" || call.callState === "connected") &&
      !canClose
    ) {
      await call.endCall();
    }
    onOpenChange(false);
  };

  const statusText = getStatusText(call);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-black/40" />
        <DialogContent
          showCloseButton={false}
          className="mx-auto w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-2xl border-0 p-0 shadow-2xl sm:rounded-3xl"
        >
          <DialogTitle className="sr-only">
            Talk through this role: {callTitle}
          </DialogTitle>

          <div className="relative flex min-h-[600px] max-h-[90vh] flex-col bg-paper">
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

              {(call.callState === "connected" ||
                call.callState === "connecting") && (
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

              <VoiceCallStatus statusText={statusText} error={call.error} />

              <VoiceCallControls
                callState={call.callState}
                isMuted={call.isMuted}
                isProcessing={false}
                onToggleMute={call.toggleMute}
                onEndCall={handleEndCall}
                onClose={() => onOpenChange(false)}
              />
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function getStatusText(call: ReturnType<typeof useJobVoiceCall>): string {
  switch (call.callState) {
    case "idle":
      return "Ready to connect";
    case "connecting":
      return "Connecting to your career adviser…";
    case "connected": {
      if (!call.isAITalking && !call.userSpeaking) {
        return "Connected — say hi to start";
      }
      if (call.isAITalking) return "Adviser is speaking";
      return "Listening";
    }
    case "ended":
      return "Call ended";
    case "error":
      return "Connection error";
  }
}
