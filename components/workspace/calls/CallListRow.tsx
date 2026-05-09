// components/workspace/calls/CallListRow.tsx
//
// Single row in the /workspace/calls list. Mobile: stacks chip + title on top,
// meta + excerpt below. sm+: three horizontal zones.

"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CallSurfaceChip } from "./CallSurfaceChip";
import type { Id } from "@/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Surface = "guide" | "compass" | "job" | "interview_job";

type CallRow = {
  _id: Id<"voice_calls">;
  surface?: Surface;
  title: string;
  totalDurationSeconds: number;
  createdAt: number;
  archivedAt?: number;
  aiSummary?: unknown;
  messagesCount: number;
  searchScore?: number;
};

type Props = {
  call: CallRow;
  onArchive: () => void;
  onUnarchive: () => void;
  className?: string;
};

// ---------------------------------------------------------------------------
// Inline helpers (no third-party date library)
// ---------------------------------------------------------------------------

/** "3m 21s" for >60s, "45s" otherwise */
function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${seconds}s`;
}

/** Relative date: "2 hours ago", "3 days ago", "Aug 12 2024" */
function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  // Beyond 7 days: "Aug 12" or "Aug 12 2023" when not this year
  const d = new Date(ms);
  const monthDay = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const year = d.getFullYear();
  if (year !== new Date().getFullYear()) return `${monthDay} ${year}`;
  return monthDay;
}

// ---------------------------------------------------------------------------
// Excerpt + badge helpers — surface-discriminated
// ---------------------------------------------------------------------------

function getExcerpt(surface: Surface | undefined, aiSummary: unknown): string | null {
  if (!aiSummary || typeof aiSummary !== "object") return null;
  const summary = aiSummary as Record<string, unknown>;
  if (surface === "interview_job") {
    return typeof summary.oneLineVerdict === "string" ? summary.oneLineVerdict : null;
  }
  return typeof summary.summary === "string" ? summary.summary : null;
}

function getOverallScore(surface: Surface | undefined, aiSummary: unknown): number | null {
  if (surface !== "interview_job" || !aiSummary || typeof aiSummary !== "object") return null;
  const s = aiSummary as Record<string, unknown>;
  return typeof s.overallScore === "number" ? s.overallScore : null;
}

type Sentiment = "positive" | "neutral" | "negative";
function getSentiment(surface: Surface | undefined, aiSummary: unknown): Sentiment | null {
  if (surface === "interview_job" || !aiSummary || typeof aiSummary !== "object") return null;
  const s = aiSummary as Record<string, unknown>;
  const v = s.sentiment;
  if (v === "positive" || v === "neutral" || v === "negative") return v;
  return null;
}

const SENTIMENT_DOT: Record<Sentiment, string> = {
  positive: "bg-emerald-500",
  neutral:  "bg-mute",
  negative: "bg-rose-500",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CallListRow({ call, onArchive, onUnarchive, className }: Props) {
  const href = `/workspace/calls/${call._id}` as const;
  const excerpt = getExcerpt(call.surface, call.aiSummary);
  const score = getOverallScore(call.surface, call.aiSummary);
  const sentiment = getSentiment(call.surface, call.aiSummary);
  const isArchived = call.archivedAt !== undefined;

  return (
    <article
      className={cn(
        "group border-b border-hairline px-4 py-4 transition-colors duration-200 hover:bg-ink/[0.015] sm:px-6",
        isArchived && "opacity-60",
        className,
      )}
    >
      {/* Main row — stacks on mobile, horizontal on sm+ */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">

        {/* Left: chip + title + excerpt */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CallSurfaceChip surface={call.surface} size="sm" />
            <Link
              href={href}
              className="truncate text-sm font-medium text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              {call.title}
            </Link>
          </div>

          {excerpt && (
            <p className="mt-1 line-clamp-1 text-[12px] leading-relaxed text-mute">
              {excerpt}
            </p>
          )}
        </div>

        {/* Right: meta + badges + action menu */}
        <div className="flex shrink-0 items-center gap-3 sm:pt-0.5">
          {/* Score badge (interview_job only) */}
          {score !== null && (
            <span className="inline-flex items-baseline gap-0.5 rounded-pill border border-hairline bg-paper-raised px-2 py-0.5 text-[11px] font-medium text-ink/70">
              <span>{score.toFixed(1)}</span>
              <span className="text-mute">/5</span>
            </span>
          )}

          {/* Sentiment dot (non-interview surfaces) */}
          {sentiment !== null && (
            <span
              className={cn("size-1.5 shrink-0 rounded-full", SENTIMENT_DOT[sentiment])}
              aria-label={`Sentiment: ${sentiment}`}
            />
          )}

          {/* Semantic search relevance badge */}
          {call.searchScore !== undefined && (
            <span className="text-[11px] text-mute" aria-label="Search relevance">
              {Math.round(call.searchScore * 100)}%
            </span>
          )}

          {/* Duration + relative date */}
          <span className="whitespace-nowrap text-[12px] text-mute">
            {formatDuration(call.totalDurationSeconds)}
            <span className="mx-1 opacity-40">·</span>
            {formatRelative(call.createdAt)}
          </span>

          {/* Action menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Call actions"
                className="flex size-7 items-center justify-center rounded-control text-mute opacity-0 transition-opacity hover:bg-ink/5 hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 group-hover:opacity-100"
              >
                <MoreHorizontal className="size-4" strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <DropdownMenuItem asChild>
                <Link href={href}>Open</Link>
              </DropdownMenuItem>
              {isArchived ? (
                <DropdownMenuItem onClick={onUnarchive}>
                  Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onArchive}>
                  Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}
