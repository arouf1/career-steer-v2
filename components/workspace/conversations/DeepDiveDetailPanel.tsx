"use client";

import {
  AlertTriangle,
  ArrowRight,
  Circle,
  Hash,
  Lightbulb,
  MessageCircleQuestion,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeepDiveSummary } from "@/lib/ai/prompts/voiceAdviser";

type Props = {
  summary: DeepDiveSummary;
  meta: {
    /** Row title — may differ from summary.title */
    title: string;
    createdAt: number;
    durationSeconds: number;
  };
  className?: string;
};

export function DeepDiveDetailPanel({ summary, meta, className }: Props) {
  const highPoints = summary.actionPoints.filter((a) => a.priority === "high");
  const mediumPoints = summary.actionPoints.filter(
    (a) => a.priority === "medium",
  );
  const lowPoints = summary.actionPoints.filter((a) => a.priority === "low");

  return (
    <div className={cn("flex flex-col gap-5 p-5 sm:p-6", className)}>
      {/* Header */}
      <header>
        <p className="text-[12px] uppercase tracking-wide text-mute">
          Deep dive · {meta.title}
        </p>
        <h2 className="mt-1 text-[22px] font-medium leading-snug text-ink [font-family:var(--font-serif)]">
          {summary.title || meta.title}
        </h2>
        {/* Status chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          <SentimentChip sentiment={summary.sentiment} />
          <EngagementChip engagement={summary.userEngagement} />
          <GuideRelevanceChip relevance={summary.guideRelevance} />
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-ink">
          {summary.summary}
        </p>
      </header>

      {/* Insights */}
      {summary.insights.length > 0 && (
        <section aria-label="Insights">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <Lightbulb className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Insights
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {summary.insights.map((insight, i) => (
              <li key={i} className="text-[13px] text-ink/80 pl-1">
                {insight}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Key topics */}
      {summary.keyTopics.length > 0 && (
        <section aria-label="Key topics">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <Hash className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Key topics
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.keyTopics.map((topic, i) => (
              <span
                key={i}
                className="border-hairline rounded-pill border bg-paper-raised px-3 py-1 text-[12px] text-mute"
              >
                {topic}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Action points */}
      {summary.actionPoints.length > 0 && (
        <section aria-label="Action points">
          <p className="text-[13px] font-medium text-ink">Action points</p>
          <div className="mt-2 flex flex-col gap-3">
            {highPoints.length > 0 && (
              <PriorityGroup
                priority="high"
                items={highPoints.map((a) => a.description)}
              />
            )}
            {mediumPoints.length > 0 && (
              <PriorityGroup
                priority="medium"
                items={mediumPoints.map((a) => a.description)}
              />
            )}
            {lowPoints.length > 0 && (
              <PriorityGroup
                priority="low"
                items={lowPoints.map((a) => a.description)}
              />
            )}
          </div>
        </section>
      )}

      {/* Follow-ups */}
      {summary.followUpNeeded && summary.followUpSuggestions.length > 0 && (
        <section aria-label="Follow-up suggestions">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <MessageCircleQuestion
              className="h-3.5 w-3.5"
              strokeWidth={1.75}
              aria-hidden
            />
            Suggested follow-ups
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {summary.followUpSuggestions.map((suggestion, i) => (
              <li
                key={i}
                className="border-hairline rounded-card border bg-paper-raised px-3 py-2 text-[13px] text-ink"
              >
                {suggestion}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SentimentChip({
  sentiment,
}: {
  sentiment: DeepDiveSummary["sentiment"];
}) {
  const label: Record<typeof sentiment, string> = {
    positive: "Positive",
    neutral: "Neutral",
    negative: "Negative",
  };
  const styles: Record<typeof sentiment, string> = {
    positive:
      "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    neutral: "bg-paper-raised text-mute border-hairline",
    negative: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  };
  return (
    <span
      className={cn(
        "rounded-pill border px-2.5 py-0.5 text-[11px] font-medium",
        styles[sentiment],
      )}
    >
      {label[sentiment]}
    </span>
  );
}

function EngagementChip({
  engagement,
}: {
  engagement: DeepDiveSummary["userEngagement"];
}) {
  const label: Record<typeof engagement, string> = {
    high: "High engagement",
    medium: "Medium engagement",
    low: "Low engagement",
  };
  const styles: Record<typeof engagement, string> = {
    high: "bg-ink/10 text-ink border-ink/20",
    medium: "bg-paper-raised text-mute border-hairline",
    low: "bg-paper-raised text-mute border-hairline opacity-70",
  };
  return (
    <span
      className={cn(
        "rounded-pill border px-2.5 py-0.5 text-[11px] font-medium",
        styles[engagement],
      )}
    >
      {label[engagement]}
    </span>
  );
}

function GuideRelevanceChip({
  relevance,
}: {
  relevance: DeepDiveSummary["guideRelevance"];
}) {
  const label: Record<typeof relevance, string> = {
    "on-topic": "On topic",
    "partially-relevant": "Partially relevant",
    "off-topic": "Off topic",
  };
  const styles: Record<typeof relevance, string> = {
    "on-topic": "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    "partially-relevant": "bg-amber-500/10 text-amber-700 border-amber-500/30",
    "off-topic": "bg-rose-500/10 text-rose-700 border-rose-500/30",
  };
  return (
    <span
      className={cn(
        "rounded-pill border px-2.5 py-0.5 text-[11px] font-medium",
        styles[relevance],
      )}
    >
      {label[relevance]}
    </span>
  );
}

function PriorityGroup({
  priority,
  items,
}: {
  priority: "high" | "medium" | "low";
  items: string[];
}) {
  const chipStyles = {
    high: "bg-rose-500/10 text-rose-700 border-rose-500/30",
    medium: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    low: "bg-paper-raised text-mute border-hairline",
  };
  const Icon = {
    high: AlertTriangle,
    medium: Circle,
    low: ArrowRight,
  }[priority];

  return (
    <div>
      <span
        className={cn(
          "mb-1.5 inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] font-medium capitalize",
          chipStyles[priority],
        )}
      >
        <Icon className="h-3 w-3" strokeWidth={1.75} aria-hidden />
        {priority}
      </span>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li
            key={i}
            className="border-hairline rounded-card border bg-paper-raised px-3 py-2 text-[13px] text-ink"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
