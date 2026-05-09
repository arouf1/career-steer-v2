"use client";

import { ChevronDown, MessageSquareQuote, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { InterviewRubric } from "@/lib/ai/prompts/interviewer";

type Props = {
  rubric: InterviewRubric;
  meta: {
    title: string;
    createdAt: number;
    durationSeconds: number;
  };
  className?: string;
};

export function InterviewDetailPanel({ rubric, meta, className }: Props) {
  return (
    <div className={cn("flex flex-col gap-5 p-5 sm:p-6", className)}>
      <header>
        <p className="text-[12px] uppercase tracking-wide text-mute">
          Mock interview · {meta.title}
        </p>
        <p className="mt-1 text-[28px] font-medium leading-none text-ink [font-family:var(--font-serif)]">
          {rubric.overallScore.toFixed(1)}
          <span className="text-[18px] text-mute">/5</span>
        </p>
        <p className="mt-2 text-[14px] text-ink">{rubric.oneLineVerdict}</p>
      </header>

      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        aria-label="Dimension scores"
      >
        {rubric.dimensions.map((d) => (
          <div
            key={d.key}
            className="border-hairline rounded-card border bg-paper-raised p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium capitalize text-ink">
                {d.key.replace(/-/g, " ")}
              </p>
              <p className="text-[16px] font-medium text-ink">
                {d.score == null ? (
                  <span className="text-mute">—</span>
                ) : (
                  `${d.score}/5`
                )}
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
      </section>

      {rubric.bestMoment.quote && (
        <Card icon={Sparkles} title="Best moment">
          <blockquote className="rounded-card bg-paper-raised p-3 font-mono text-[12px] text-ink">
            &ldquo;{rubric.bestMoment.quote}&rdquo;
          </blockquote>
          <p className="mt-2 text-[12px] text-mute">{rubric.bestMoment.why}</p>
        </Card>
      )}

      {rubric.biggestMiss.quote && (
        <Card icon={MessageSquareQuote} title="Biggest miss">
          <blockquote className="rounded-card bg-paper-raised p-3 font-mono text-[12px] text-ink">
            &ldquo;{rubric.biggestMiss.quote}&rdquo;
          </blockquote>
          <p className="mt-2 text-[12px] text-mute">{rubric.biggestMiss.why}</p>
          <p className="mt-2 text-[12px] text-ink">
            <span className="font-medium">A stronger answer might:</span>{" "}
            {rubric.biggestMiss.betterAnswerSketch}
          </p>
        </Card>
      )}

      <section>
        <p className="text-[13px] font-medium text-ink">
          Three things to do next
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {rubric.nextStepExercises.map((e, i) => (
            <Exercise key={i} title={e.title} why={e.why} how={e.how} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-hairline rounded-card border p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Exercise({
  title,
  why,
  how,
}: {
  title: string;
  why: string;
  how: string;
}) {
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
          className={cn(
            "h-4 w-4 text-mute transition-transform",
            open && "rotate-180",
          )}
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
