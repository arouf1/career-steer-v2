"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { AlertCircle, X } from "lucide-react";
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
  const [endedError, setEndedError] = useState<string | null>(null);

  // Subscribe to the prep status doc once we have a prepSessionId.
  const prep = useQuery(
    api.interviewSim.subscribeToPrep,
    prepSessionId ? { prepSessionId } : "skip",
  );
  const liveReady = prep?.status === "ready";

  // Reset state when the dialog closes. Setting state in a dep-driven effect is
  // the correct pattern here; linter rule is overly broad for this use case.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("prep");
      setPrepSessionId(null);
      setEndedCallId(null);
      setEndedError(null);
    }
  }, [open]);

  // Advance prep → live as soon as the server reports ready.
  // Driven by useEffect to avoid stale-closure bugs in callbacks.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (liveReady && phase === "prep") setPhase("live");
  }, [liveReady, phase]);

  const handleEnded = (id: Id<"voice_calls"> | null, error: string | null) => {
    setEndedCallId(id);
    setEndedError(error);
    setPhase("feedback");
  };

  const dialogTitleText =
    phase === "feedback"
      ? `Mock interview feedback: ${callTitle}`
      : `Mock interview: ${callTitle}`;

  // The InterviewLiveCall mounts ONCE per dialog open and stays mounted across
  // the prep → live transition. During prep it's rendered into an sr-only
  // wrapper so the WebSocket stays alive; once liveReady flips we drop the
  // sr-only and the user sees it. This avoids the unmount/remount cycle that
  // would tear down the WebSocket and trigger a duplicate mintInterviewSession.
  const livePhaseActive = phase === "prep" || phase === "live";
  const liveVisible = phase === "live" || (phase === "prep" && liveReady);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block accidental close while live; user has an explicit End Call
        // button inside InterviewLiveCall.
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
            {/* Cancel affordance during prep — there's no End Call button yet
                so give the user an explicit out if research stalls. */}
            {phase === "prep" && !liveReady && (
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => onOpenChange(false)}
                className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-paper-raised text-mute transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            )}

            {/* Phase 1 — prep progress visible until live takes over. */}
            {phase === "prep" && !liveReady && (
              <InterviewPrepProgress
                status={(prep?.status ?? "researching") as PrepStatus}
                detail={prep?.detail}
                error={prep?.error}
                companyName={companyName}
              />
            )}

            {/* Phase 2 — single InterviewLiveCall, mounted across prep/live.
                Hidden via sr-only during prep so the WebSocket stays alive. */}
            {livePhaseActive && (
              <div className={liveVisible ? "flex flex-1 flex-col" : "sr-only"}>
                <InterviewLiveCall
                  jobPostingId={jobPostingId}
                  callTitle={callTitle}
                  voiceId={voiceId}
                  onEnded={handleEnded}
                  onPrepSessionId={(id) => setPrepSessionId(id)}
                />
              </div>
            )}

            {/* Phase 3a — mint failed fast (no callId): show error + close affordance. */}
            {phase === "feedback" && !endedCallId && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <AlertCircle className="h-8 w-8 text-mute" strokeWidth={1.5} />
                <p className="text-sm text-ink">Couldn&apos;t start your mock interview.</p>
                {endedError && <p className="text-[12px] text-mute">{endedError}</p>}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-2 inline-flex h-9 items-center rounded-pill bg-ink px-4 text-[13px] font-medium text-paper transition-colors hover:bg-ink/80"
                >
                  Close
                </button>
              </div>
            )}

            {/* Phase 3b — feedback, mounts after a real call ends with a callId. */}
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
