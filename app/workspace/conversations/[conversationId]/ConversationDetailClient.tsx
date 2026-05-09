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
import { ConversationTranscript } from "@/components/workspace/conversations/ConversationTranscript";
import { InterviewDetailPanel } from "@/components/workspace/conversations/InterviewDetailPanel";
import { DeepDiveDetailPanel } from "@/components/workspace/conversations/DeepDiveDetailPanel";
import type { InterviewRubric } from "@/lib/ai/prompts/interviewer";
import type { DeepDiveSummary } from "@/lib/ai/prompts/voiceAdviser";

type Surface = "guide" | "compass" | "job" | "interview_job";

type Props = {
  callId: string;
};

export function ConversationDetailClient({ callId }: Props) {
  const router = useRouter();

  const call = useQuery(api.voiceCalls.getCallById, {
    callId: callId as Id<"voice_calls">,
  });

  const archive = useMutation(api.voiceCalls.archive);
  const unarchive = useMutation(api.voiceCalls.unarchive);

  // ── Loading state ────────────────────────────────────────────────────────
  // Page width: max-w-3xl (~768px) keeps body lines under ~75ch at standard
  // text size — matches the editorial reading-flow rule in DESIGN.md.
  if (call === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 p-8 text-[13px] text-mute">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
        Loading conversation…
      </div>
    );
  }

  // ── 404 / not-owned fallback ─────────────────────────────────────────────
  if (call === null) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 p-12 text-center">
        <p className="text-[14px] text-ink">Conversation not found.</p>
        <p className="text-[12px] text-mute">
          It may have been archived from a different account, or the link is
          wrong.
        </p>
        <Link
          href="/workspace/conversations"
          className="mt-2 rounded-full border border-hairline bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-paper-raised"
        >
          All conversations
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
      router.push("/workspace/conversations");
    }
  };

  const summary = call.aiSummary as DeepDiveSummary | InterviewRubric | null | undefined;
  // companyName / companyLogoUrl are bundled onto the row by getCallById's
  // posting→company join (see convex/voiceCalls.ts) but aren't part of the
  // base voice_calls Doc shape, so they're surfaced via an unknown-cast.
  const callExtras = call as unknown as {
    companyName?: string;
    companyLogoUrl?: string;
  };
  const meta = {
    title: call.title as string,
    createdAt: call.createdAt as number,
    durationSeconds: call.totalDurationSeconds as number,
    companyName: callExtras.companyName,
    companyLogoUrl: callExtras.companyLogoUrl,
  };

  // ── Render ───────────────────────────────────────────────────────────────
  // max-w-3xl (~768px) keeps body lines under the 65-75ch editorial rule
  // from DESIGN.md. Panels render flush onto paper — no wrapping cards.
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
      {/* Header: back link on the left, archived chip + actions on the right.
          The surface label is no longer rendered here — it now lives on the
          masthead inside each panel. */}
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/workspace/conversations"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-mute hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          All conversations
        </Link>

        <div className="flex items-center gap-3">
          {isArchived && (
            <span className="inline-flex items-center rounded-full border border-hairline bg-paper-raised px-2 py-0.5 text-[10px] font-medium text-mute">
              Archived
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Conversation actions"
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

      {/* Surface-aware summary panel — flush on paper, no wrapping card */}
      {summary != null ? (
        isInterview ? (
          <InterviewDetailPanel
            rubric={summary as InterviewRubric}
            meta={meta}
          />
        ) : (
          <DeepDiveDetailPanel
            summary={summary as DeepDiveSummary}
            meta={meta}
            surface={surface as "guide" | "compass" | "job"}
          />
        )
      ) : (
        <div className="py-6">
          <p className="text-[13px] text-mute">
            No summary available for this conversation.
          </p>
        </div>
      )}

      {/* Transcript — flush, with editorial section label, no card chrome */}
      <section className="mt-12">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
          Transcript
        </p>
        <ConversationTranscript messages={call.messages ?? []} />
      </section>
    </div>
  );
}
