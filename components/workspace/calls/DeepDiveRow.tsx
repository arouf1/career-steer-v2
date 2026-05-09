// components/workspace/calls/DeepDiveRow.tsx
//
// Row component for non-interview surfaces ("guide", "compass", "job"). The
// surface signal is carried by a Figtree label-cased eyebrow above an EB
// Garamond serif title — no chip, no chromatic accent. Body excerpt under the
// title at 60ch max width for editorial line-length.

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

type Surface = "guide" | "compass" | "job";

const SURFACE_EYEBROW: Record<Surface, string> = {
  guide: "Career deep dive",
  compass: "Compass",
  job: "Job deep dive",
};

type Props = {
  call: {
    _id: Id<"voice_calls">;
    surface?: Surface | "interview_job";
    title: string;
    totalDurationSeconds: number;
    createdAt: number;
    archivedAt?: number;
    aiSummary?: unknown;
  };
  onArchive: () => void;
  onUnarchive: () => void;
};

export function DeepDiveRow({ call, onArchive, onUnarchive }: Props) {
  const summary = call.aiSummary as { summary?: string } | undefined;
  const excerpt = summary?.summary;
  const isArchived = call.archivedAt !== undefined;

  // Defensive default to "guide" — legacy rows pre-discriminator landed there.
  // Cast back through Surface so the lookup is safe at the type level.
  const surface = (call.surface === "interview_job" ? "guide" : (call.surface ?? "guide")) as Surface;
  const eyebrow = SURFACE_EYEBROW[surface];

  // Strip the conversational "Talking through: " prefix the deep-dive
  // pipeline uses — the eyebrow already sets surface context.
  const cleanTitle = call.title.replace(/^Talking through:\s*/i, "");

  return (
    <article
      className={cn(
        "group relative py-5 transition-opacity",
        isArchived && "opacity-60",
      )}
    >
      <Link
        href={`/workspace/calls/${call._id}`}
        className="absolute inset-0 z-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
        aria-label={`Open call: ${cleanTitle}`}
      />

      <div className="relative z-10 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
            {eyebrow}
          </p>
          <h3 className="mt-1 text-[18px] font-normal leading-tight text-ink [font-family:var(--font-serif)]">
            {cleanTitle}
          </h3>
          {excerpt && (
            <p className="mt-2 line-clamp-2 max-w-[60ch] text-[13px] leading-relaxed text-body">
              {excerpt}
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-2 text-[12px] text-mute">
            <span>{formatDuration(call.totalDurationSeconds)}</span>
            <span aria-hidden>·</span>
            <span>{formatRelative(call.createdAt)}</span>
          </div>
        </div>

        <div className="shrink-0 opacity-40 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Inline helpers (intentionally duplicated with InterviewRow — two callers,
// 5 lines each; the indirection cost would outweigh DRY benefit)
// ---------------------------------------------------------------------------

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
