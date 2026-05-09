"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Loader2, Target, X } from "lucide-react";
import type { InterviewRubric } from "@/lib/ai/prompts/interviewer";
import { InterviewDetailPanel } from "@/components/workspace/calls/InterviewDetailPanel";

type Props = {
  callId: Id<"voice_calls">;
  onClose: () => void;
};

export function InterviewFeedback({ callId, onClose }: Props) {
  const call = useQuery(api.voiceCalls.getCallById, { callId });
  const summary = call?.aiSummary as InterviewRubric | undefined;

  if (!call) return null;
  if (call.messages.length < 4) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <Target className="h-8 w-8 text-mute" strokeWidth={1.5} />
        <p className="text-sm text-ink">Call ended before we had enough to grade.</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-pill bg-ink px-4 py-1.5 text-[13px] font-medium text-paper hover:bg-ink-deep"
        >
          Close
        </button>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-mute" strokeWidth={1.5} />
        <p className="text-sm text-ink">Analyzing your interview…</p>
        <p className="text-[12px] text-mute">Usually 10–15 seconds.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex justify-end p-4 pb-0">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-mute hover:text-ink"
        >
          <X className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>
      <InterviewDetailPanel
        rubric={summary}
        meta={{
          title: call.title,
          createdAt: call.createdAt,
          durationSeconds: call.totalDurationSeconds,
        }}
      />
    </div>
  );
}
