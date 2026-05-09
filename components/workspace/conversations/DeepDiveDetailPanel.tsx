// components/workspace/conversations/DeepDiveDetailPanel.tsx
//
// Editorial detail panel for deep-dive conversations (career / compass / job).
// Single-column reading flow on plain paper — no card-in-card chrome, no
// priority-grouped action-point sub-cards, no chromatic sentiment chips
// (those quietly violated the One Voice Rule). Section breaks are hairline
// dividers; typography carries the hierarchy.

"use client";

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
  surface: "guide" | "compass" | "job";
  className?: string;
};

const SURFACE_LABEL: Record<Props["surface"], string> = {
  guide: "Career deep dive",
  compass: "Compass",
  job: "Job deep dive",
};

export function DeepDiveDetailPanel({
  summary,
  meta,
  surface,
  className,
}: Props) {
  // Strip the conversational "Talking through: " prefix the deep-dive
  // pipeline uses — the masthead label already sets surface context. Mirrors
  // DeepDiveRow.
  const cleanMetaTitle = meta.title.replace(/^Talking through:\s*/i, "");
  const title = summary.title?.trim() || cleanMetaTitle;

  // Action points — flatten with priority-implicit ordering (high → med → low).
  // No grouped sub-cards; the order alone communicates priority.
  const orderedActionPoints = [
    ...summary.actionPoints.filter((a) => a.priority === "high"),
    ...summary.actionPoints.filter((a) => a.priority === "medium"),
    ...summary.actionPoints.filter((a) => a.priority === "low"),
  ];

  return (
    <div className={cn("flex flex-col", className)}>
      {/* ── Masthead + Summary ──────────────────────────────────────────── */}
      <section id="summary" className="scroll-mt-24">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
          {SURFACE_LABEL[surface]} <span aria-hidden>·</span>{" "}
          {summary.sentiment} <span aria-hidden>·</span>{" "}
          {formatDuration(meta.durationSeconds)} <span aria-hidden>·</span>{" "}
          {formatRelative(meta.createdAt)}
        </p>

        <h1 className="mt-5 text-[36px] font-normal leading-tight text-ink [font-family:var(--font-serif)]">
          {title}
        </h1>

        {summary.summary && (
          <p className="mt-4 max-w-[60ch] text-[18px] leading-relaxed text-body [font-family:var(--font-serif)]">
            {summary.summary}
          </p>
        )}
      </section>

      {/* ── Insights ───────────────────────────────────────────────────── */}
      {summary.insights.length > 0 && (
        <section id="insights" className="scroll-mt-24">
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
            Insights
          </p>
          <ul className="flex flex-col gap-5">
            {summary.insights.map((insight, i) => (
              <li
                key={i}
                className="flex items-start gap-4 max-w-[60ch] text-[15px] leading-relaxed text-ink"
              >
                {/* Editorial hairline-bullet — 1px vertical rule per DESIGN.md */}
                <span
                  className="mt-2 inline-block h-2.5 w-px shrink-0 bg-hairline-strong"
                  aria-hidden
                />
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Topics covered ─────────────────────────────────────────────── */}
      {summary.keyTopics.length > 0 && (
        <section id="topics" className="scroll-mt-24">
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
            Topics covered
          </p>
          <div className="flex flex-wrap gap-2">
            {summary.keyTopics.map((topic, i) => (
              <span
                key={i}
                className="rounded-pill border border-hairline bg-paper-raised px-3 py-1 text-[12px] text-ink"
              >
                {topic}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Action points (numbered editorial list, priority implicit in order) ─ */}
      {orderedActionPoints.length > 0 && (
        <section id="actions" className="scroll-mt-24">
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
            Action points
          </p>
          <ol className="flex flex-col">
            {orderedActionPoints.map((a, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-5 py-5",
                  i === 0 ? "" : "border-t border-hairline",
                )}
              >
                <span
                  className={cn(
                    "shrink-0 text-[24px] leading-none text-ink [font-family:var(--font-serif)]",
                    a.priority === "high" ? "font-medium" : "font-normal",
                  )}
                  aria-hidden
                >
                  {i + 1}
                </span>
                <p className="min-w-0 flex-1 max-w-[60ch] text-[14px] leading-relaxed text-ink">
                  {a.description}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Suggested follow-ups ───────────────────────────────────────── */}
      {summary.followUpNeeded && summary.followUpSuggestions.length > 0 && (
        <section id="follow-ups" className="scroll-mt-24">
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
            Suggested follow-ups
          </p>
          <ul className="flex flex-col gap-5">
            {summary.followUpSuggestions.map((suggestion, i) => (
              <li
                key={i}
                className="flex items-start gap-4 max-w-[60ch] text-[14px] leading-relaxed text-ink"
              >
                <span
                  className="mt-2 inline-block h-2.5 w-px shrink-0 bg-hairline-strong"
                  aria-hidden
                />
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 1) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
