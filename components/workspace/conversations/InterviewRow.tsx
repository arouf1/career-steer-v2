// components/workspace/conversations/InterviewRow.tsx
//
// Row component for "interview_job" surface — the only surface that has a
// company anchor (logo + name) and an overall score. Editorial tone:
// EB Garamond serif on the score, Figtree on title + meta. The whole row is
// a clickable link; the action menu is always visible at opacity-40 and
// fades to full on hover/focus.

"use client";

import Link from "next/link";
import { Archive, ArchiveRestore, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type Props = {
  call: {
    _id: Id<"voice_calls">;
    title: string;
    totalDurationSeconds: number;
    createdAt: number;
    archivedAt?: number;
    aiSummary?: unknown;
    companyName?: string;
    companyLogoUrl?: string;
  };
  onArchive: () => void;
  onUnarchive: () => void;
};

export function InterviewRow({ call, onArchive, onUnarchive }: Props) {
  const summary = call.aiSummary as
    | { overallScore?: number; oneLineVerdict?: string }
    | undefined;
  const score = typeof summary?.overallScore === "number" ? summary.overallScore : null;
  const verdict = summary?.oneLineVerdict;
  const isArchived = call.archivedAt !== undefined;

  // Strip the redundant "Mock interview: " prefix — the row component itself
  // signals surface via the company anchor + score on the right.
  const cleanTitle = call.title.replace(/^Mock interview:\s*/i, "");

  return (
    <article
      className={cn(
        "group relative flex items-start gap-4 py-4 transition-opacity",
        isArchived && "opacity-60",
      )}
    >
      <Link
        href={`/workspace/conversations/${call._id}`}
        className="absolute inset-0 z-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
        aria-label={`Open mock interview: ${cleanTitle}`}
      />

      <CompanyAnchor
        name={call.companyName}
        logoUrl={call.companyLogoUrl}
        className="relative z-10 shrink-0"
      />

      <div className="relative z-10 min-w-0 flex-1">
        <h3 className="text-[15px] font-medium leading-snug text-ink">
          {cleanTitle}
        </h3>
        {verdict && (
          <p className="mt-0.5 line-clamp-1 text-[13px] text-mute">{verdict}</p>
        )}
        <div className="mt-2 flex items-center gap-2 text-[12px] text-mute">
          {call.companyName && (
            <>
              <span className="truncate">{call.companyName}</span>
              <Separator />
            </>
          )}
          <span>{formatDuration(call.totalDurationSeconds)}</span>
          <Separator />
          <span>{formatRelative(call.createdAt)}</span>
        </div>
      </div>

      {score !== null && (
        <div className="relative z-10 flex shrink-0 items-baseline gap-1 pt-0.5">
          <span className="text-[26px] font-normal leading-none text-ink [font-family:var(--font-serif)]">
            {score.toFixed(1)}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-mute">
            /5
          </span>
        </div>
      )}

      <div className="relative z-10 shrink-0 self-start opacity-40 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Row actions"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-mute hover:bg-paper-raised hover:text-ink"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => (isArchived ? onUnarchive() : onArchive())}>
              {isArchived ? (
                <>
                  <ArchiveRestore className="mr-2 h-4 w-4" strokeWidth={1.75} aria-hidden />
                  Unarchive
                </>
              ) : (
                <>
                  <Archive className="mr-2 h-4 w-4" strokeWidth={1.75} aria-hidden />
                  Archive
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// CompanyAnchor — logo or initials mark
// ---------------------------------------------------------------------------
//
// Loads the Brandfetch CDN URL via raw <img> (matches components/jobs/
// CompanyMark.tsx convention — Brandfetch CDN isn't in next.config.ts
// remotePatterns and we don't want to widen that surface for one row). Falls
// back to the company-name initial on missing or broken logo.

function CompanyAnchor({
  name,
  logoUrl,
  className,
}: {
  name?: string;
  logoUrl?: string;
  className?: string;
}) {
  if (logoUrl) {
    return (
      <div
        className={cn(
          "h-8 w-8 overflow-hidden rounded-full bg-paper-raised",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={name ? `${name} logo` : ""}
          width={32}
          height={32}
          className="h-full w-full object-contain p-0.5"
        />
      </div>
    );
  }
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <div
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full bg-paper-raised text-[14px] font-medium text-ink",
        className,
      )}
      aria-label={name ? `${name} logo placeholder` : "Company logo placeholder"}
    >
      {initial}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline helpers (intentionally duplicated with DeepDiveRow — two callers,
// 5 lines each; the indirection cost would outweigh DRY benefit)
// ---------------------------------------------------------------------------

function Separator() {
  return (
    <span className="text-hairline" aria-hidden>
      ·
    </span>
  );
}

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
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
