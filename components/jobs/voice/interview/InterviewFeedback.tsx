"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ChevronDown, Loader2, MessageSquareQuote, Sparkles, Target, X } from "lucide-react";
import { useState } from "react";
import type { InterviewRubric } from "@/lib/ai/prompts/interviewer";

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
    <div className="flex flex-col gap-5 overflow-y-auto p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] uppercase tracking-wide text-mute">Mock interview · {call.title}</p>
          <p className="mt-1 text-[28px] font-medium leading-none text-ink [font-family:var(--font-serif)]">
            {summary.overallScore.toFixed(1)}<span className="text-[18px] text-mute">/5</span>
          </p>
          <p className="mt-2 text-[14px] text-ink">{summary.oneLineVerdict}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-mute hover:text-ink">
          <X className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {summary.dimensions.map((d) => (
          <div key={d.key} className="border-hairline rounded-card border bg-paper-raised p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium capitalize text-ink">{d.key.replace(/-/g, " ")}</p>
              <p className="text-[16px] font-medium text-ink">
                {d.score == null ? <span className="text-mute">—</span> : `${d.score}/5`}
              </p>
            </div>
            {d.whatWorked && d.whatWorked !== "—" && (
              <p className="mt-2 text-[12px] text-ink">
                <span className="font-medium">Worked:</span> {d.whatWorked}
              </p>
            )}
            {d.whatToFix && d.whatToFix !== "—" && (
              <p className="mt-1 text-[12px] text-mute">
                <span className="font-medium">To fix:</span> {d.whatToFix}
              </p>
            )}
          </div>
        ))}
      </div>

      {summary.bestMoment.quote && (
        <Card icon={Sparkles} title="Best moment">
          <blockquote className="rounded-card bg-paper-raised p-3 font-mono text-[12px] text-ink">
            "{summary.bestMoment.quote}"
          </blockquote>
          <p className="mt-2 text-[12px] text-mute">{summary.bestMoment.why}</p>
        </Card>
      )}

      {summary.biggestMiss.quote && (
        <Card icon={MessageSquareQuote} title="Biggest miss">
          <blockquote className="rounded-card bg-paper-raised p-3 font-mono text-[12px] text-ink">
            "{summary.biggestMiss.quote}"
          </blockquote>
          <p className="mt-2 text-[12px] text-mute">{summary.biggestMiss.why}</p>
          <p className="mt-2 text-[12px] text-ink">
            <span className="font-medium">A stronger answer might:</span> {summary.biggestMiss.betterAnswerSketch}
          </p>
        </Card>
      )}

      <div>
        <p className="text-[13px] font-medium text-ink">Three things to do next</p>
        <div className="mt-2 flex flex-col gap-2">
          {summary.nextStepExercises.map((e, i) => (
            <Exercise key={i} title={e.title} why={e.why} how={e.how} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, children }: { icon: typeof X; title: string; children: React.ReactNode }) {
  return (
    <div className="border-hairline rounded-card border p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Exercise({ title, why, how }: { title: string; why: string; how: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-hairline rounded-card border bg-paper-raised">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <span className="text-[13px] font-medium text-ink">{title}</span>
        <ChevronDown
          className={`h-4 w-4 text-mute transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div className="border-t-hairline border-t px-3 pb-3 pt-2">
          <p className="text-[12px] text-mute">{why}</p>
          <p className="mt-1 text-[12px] text-ink">{how}</p>
        </div>
      )}
    </div>
  );
}
