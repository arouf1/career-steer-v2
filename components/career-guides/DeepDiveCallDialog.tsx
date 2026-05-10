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
import { useDeepDiveCall } from "./useDeepDiveCall";
import { VoiceCallHeader } from "./voice-call/VoiceCallHeader";
import { VoiceCallAnimation } from "./voice-call/VoiceCallAnimation";
import { VoiceCallTranscription } from "./voice-call/VoiceCallTranscription";
import { VoiceCallStatus } from "./voice-call/VoiceCallStatus";
import { VoiceCallControls } from "./voice-call/VoiceCallControls";
import { useCallTimer } from "./voice-call/useCallTimer";

type Props = {
  guideId: Id<"career_guides">;
  guideTitle: string;
  region: "us" | "uk";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voiceId?: string;
};

/**
 * Deep-dive call modal. Modeled directly on V1's VoiceCall.tsx structure:
 * fixed-frame card with header, focal animation (Rive halo), toggleable
 * transcription, status text, and a compact 2-button control bar.
 *
 * The modal is opened from the sidebar tile already committed to a call -
 * there is no in-modal "Start call" button. Closing the modal during a live
 * call ends the call cleanly via the underlying hook.
 */
export function DeepDiveCallDialog({
  guideId,
  guideTitle,
  region,
  open,
  onOpenChange,
  voiceId,
}: Props) {
  const call = useDeepDiveCall({ guideId, region, voiceId });
  const [showTranscription, setShowTranscription] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const startedRef = useRef(false);

  const timer = useCallTimer({
    callState: call.callState,
    isAITalking: call.isAITalking,
    userSpeaking: call.userSpeaking,
  });

  // Rive halo. The state-machine has three booleans we drive each render
  // based on call state, listening (user speaking), thinking (connecting
  // or open mic with no one talking), speaking (AI talking).
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

  // Auto-start when the dialog opens. We don't wait for a click, the user
  // already clicked "Start call" in the sidebar tile.
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

  // Once the call ends or errors, allow the user to close the modal.
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
    // Block closing while a call is live unless we've ended explicitly.
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
            Deep-dive call: {guideTitle}
          </DialogTitle>

          <div className="relative flex h-[600px] max-h-[90vh] flex-col bg-paper">
            <div className="flex flex-1 flex-col gap-6 overflow-hidden p-4 sm:p-6">
              <VoiceCallHeader
                guideTitle={guideTitle}
                duration={timer.duration}
                formatDuration={timer.formatDuration}
              />

              {/* Focal centerpiece. Rive halo OR transcript view */}
              {!showTranscription ? (
                <VoiceCallAnimation RiveComponent={RiveComponent} rive={rive} />
              ) : (
                <VoiceCallTranscription
                  messages={call.transcript}
                  currentAssistantUtterance={call.currentAssistantUtterance}
                  callState={call.callState}
                />
              )}

              {/* View toggle, only when there's something to switch to */}
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

function getStatusText(call: ReturnType<typeof useDeepDiveCall>): string {
  switch (call.callState) {
    case "idle":
      return "Ready to connect";
    case "connecting":
      return "Connecting to your career adviser…";
    case "connected": {
      if (
        !call.isAITalking &&
        !call.userSpeaking
      ) {
        return "Connected, say hi to start";
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
