"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CallTranscript } from "@/components/workspace/calls/CallTranscript";
import { InterviewDetailPanel } from "@/components/workspace/calls/InterviewDetailPanel";
import { DeepDiveDetailPanel } from "@/components/workspace/calls/DeepDiveDetailPanel";
import type { InterviewRubric } from "@/lib/ai/prompts/interviewer";
import type { DeepDiveSummary } from "@/lib/ai/prompts/voiceAdviser";

type Surface = "guide" | "compass" | "job" | "interview_job";

const SURFACE_LABEL: Record<Surface, string> = {
  guide: "Career deep dive",
  compass: "Compass",
  job: "Job deep dive",
  interview_job: "Mock interview",
};

type Props = {
  callId: string;
};

export function CallDetailClient({ callId }: Props) {
  const router = useRouter();

  const call = useQuery(api.voiceCalls.getCallById, {
    callId: callId as Id<"voice_calls">,
  });

  const archive = useMutation(api.voiceCalls.archive);
  const unarchive = useMutation(api.voiceCalls.unarchive);

  // ── Loading state ────────────────────────────────────────────────────────
  if (call === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-4xl items-center gap-2 p-8 text-[13px] text-mute">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
        Loading call…
      </div>
    );
  }

  // ── 404 / not-owned fallback ─────────────────────────────────────────────
  if (call === null) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-3 p-12 text-center">
        <p className="text-[14px] text-ink">Call not found.</p>
        <p className="text-[12px] text-mute">
          It may have been archived from a different account, or the link is
          wrong.
        </p>
        <Link
          href="/workspace/calls"
          className="mt-2 rounded-full border border-hairline bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-paper-raised"
        >
          Back to calls
        </Link>
      </div>
    );
  }

  // ── Derived state ────────────────────────────────────────────────────────
  const surface = (call.surface ?? "guide") as Surface;
  const isInterview = surface === "interview_job";
  const isArchived = call.archivedAt !== undefined && call.archivedAt !== null;

  const handleArchiveToggle = async () => {
    if (isArchived) {
      await unarchive({ callId: call._id as Id<"voice_calls"> });
    } else {
      await archive({ callId: call._id as Id<"voice_calls"> });
      // Drop user back to the list after archive so the row disappears from
      // the default (active-only) view — avoids visual confusion.
      router.push("/workspace/calls");
    }
  };

  const summary = call.aiSummary as DeepDiveSummary | InterviewRubric | null | undefined;
  const meta = {
    title: call.title as string,
    createdAt: call.createdAt as number,
    durationSeconds: call.totalDurationSeconds as number,
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
      {/* Header: back link + surface chip + archived badge + actions */}
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/workspace/calls"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-mute hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          All calls
        </Link>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
            {SURFACE_LABEL[surface]}
          </span>

          {isArchived && (
            <span className="inline-flex items-center rounded-full border border-hairline bg-paper-raised px-2 py-0.5 text-[10px] font-medium text-mute">
              Archived
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Call actions"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-mute hover:bg-paper-raised hover:text-ink"
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void handleArchiveToggle()}>
                {isArchived ? (
                  <>
                    <ArchiveRestore
                      className="mr-2 h-4 w-4"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    Unarchive
                  </>
                ) : (
                  <>
                    <Archive
                      className="mr-2 h-4 w-4"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    Archive
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Surface-aware summary panel */}
      {summary != null ? (
        isInterview ? (
          <InterviewDetailPanel
            rubric={summary as InterviewRubric}
            meta={meta}
            className="rounded-xl border border-hairline bg-paper"
          />
        ) : (
          <DeepDiveDetailPanel
            summary={summary as DeepDiveSummary}
            meta={meta}
            className="rounded-xl border border-hairline bg-paper"
          />
        )
      ) : (
        <div className="rounded-xl border border-hairline bg-paper p-6">
          <p className="text-[13px] text-mute">
            No summary available for this call.
          </p>
        </div>
      )}

      {/* Transcript — always rendered below the summary panel */}
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-ink">
          Transcript
        </h2>
        <div className="rounded-xl border border-hairline bg-paper p-4">
          <CallTranscript messages={call.messages ?? []} />
        </div>
      </section>
    </div>
  );
}
