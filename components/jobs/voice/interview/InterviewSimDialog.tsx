"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Id } from "@/convex/_generated/dataModel";
import { InterviewPrepProgress, type PrepStatus } from "./InterviewPrepProgress";
import { InterviewLiveCall } from "./InterviewLiveCall";
import { InterviewFeedback } from "./InterviewFeedback";

type Props = {
  jobPostingId: Id<"job_postings">;
  callTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voiceId?: string;
  companyName?: string;
};

type Phase = "prep" | "live" | "feedback";

export function InterviewSimDialog({
  jobPostingId,
  callTitle,
  open,
  onOpenChange,
  voiceId,
  companyName,
}: Props) {
  const [phase, setPhase] = useState<Phase>("prep");
  const [prepSessionId, setPrepSessionId] = useState<string | null>(null);
  const [endedCallId, setEndedCallId] = useState<Id<"voice_calls"> | null>(null);

  // Subscribe to the prep status doc once we have a prepSessionId.
  const prep = useQuery(
    api.interviewSim.subscribeToPrep,
    prepSessionId ? { prepSessionId } : "skip",
  );

  // Reset state when the dialog closes.
  useEffect(() => {
    if (!open) {
      setPhase("prep");
      setPrepSessionId(null);
      setEndedCallId(null);
    }
  }, [open]);

  // Auto-advance from prep → live as soon as the server reports ready.
  // The live call is mounted from open=true; the prep progress just
  // determines what we render in the dialog body until ready.
  const liveReady = prep?.status === "ready";

  // The InterviewLiveCall reports the call id when the call ends; we then
  // flip to phase=feedback.
  const handleEnded = (id: Id<"voice_calls"> | null) => {
    setEndedCallId(id);
    setPhase("feedback");
  };

  const dialogTitleText =
    phase === "feedback"
      ? `Mock interview feedback: ${callTitle}`
      : `Mock interview: ${callTitle}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block close while live (the InterviewLiveCall handles end-call
        // gracefully; we just stop the user from accidentally torpedoing
        // their interview with a click outside).
        if (!next && phase === "live") return;
        onOpenChange(next);
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-black/40" />
        <DialogContent
          showCloseButton={false}
          className="mx-auto w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-2xl border-0 p-0 shadow-2xl sm:rounded-3xl"
        >
          <DialogTitle className="sr-only">{dialogTitleText}</DialogTitle>

          <div className="relative flex min-h-[600px] max-h-[90vh] flex-col bg-paper">
            {/* Phase 1: prep — visible until liveReady && phase==="prep" */}
            {phase === "prep" && !liveReady && (
              <InterviewPrepProgress
                status={(prep?.status ?? "researching") as PrepStatus}
                detail={prep?.detail}
                error={prep?.error}
                companyName={companyName}
              />
            )}

            {/* Phase 1→2 transition: render the live call as soon as ready,
                or always (mounting it kicks off the mint flow that writes
                the prep status). */}
            {(phase === "prep" && liveReady) || phase === "live" ? (
              <InterviewLiveCall
                jobPostingId={jobPostingId}
                callTitle={callTitle}
                voiceId={voiceId}
                onEnded={handleEnded}
                onPrepSessionId={(id) => {
                  setPrepSessionId(id);
                  if (phase === "prep" && liveReady) setPhase("live");
                }}
              />
            ) : null}

            {/* Mount-once invisible bootstrapper: the InterviewLiveCall will
                START the prep on mount because useInterviewCall.startCall
                runs immediately. We mount it offscreen during prep so the
                mint kicks off; once liveReady flips we hoist it into view. */}
            {phase === "prep" && !liveReady && (
              <div className="sr-only" aria-hidden>
                <InterviewLiveCall
                  jobPostingId={jobPostingId}
                  callTitle={callTitle}
                  voiceId={voiceId}
                  onEnded={() => void 0}
                  onPrepSessionId={(id) => setPrepSessionId(id)}
                />
              </div>
            )}

            {phase === "feedback" && endedCallId && (
              <InterviewFeedback
                callId={endedCallId}
                onClose={() => onOpenChange(false)}
              />
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
