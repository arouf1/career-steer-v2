"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
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
import { WorkspaceLoadingArticle } from "@/components/workspace/WorkspaceLoading";
import { InterviewDetailPanel } from "@/components/workspace/conversations/InterviewDetailPanel";
import { DeepDiveDetailPanel } from "@/components/workspace/conversations/DeepDiveDetailPanel";
import {
  WikiTableOfContents,
  MobileTableOfContents,
} from "@/components/site/TableOfContents";
import type { SectionLink } from "@/components/site/TableOfContents";
import type { InterviewRubric } from "@/lib/ai/prompts/interviewer";
import type { DeepDiveSummary } from "@/lib/ai/prompts/voiceAdviser";

type Surface = "guide" | "compass" | "job" | "interview_job";

type Props = {
  callId: string;
};

// ── Section builder ──────────────────────────────────────────────────────────
// Builds the per-surface TOC sections list, omitting conditional blocks when
// the underlying data is absent (mirrors the career guide pattern).

function buildSections(
  surface: Surface,
  summary: DeepDiveSummary | InterviewRubric | null | undefined,
): SectionLink[] {
  if (surface === "interview_job") {
    const rubric = summary as InterviewRubric | null | undefined;
    const sections: SectionLink[] = [
      { id: "verdict", label: "Verdict" },
      { id: "dimensions", label: "How it landed" },
    ];
    if (rubric?.bestMoment?.quote) {
      sections.push({ id: "best-moment", label: "Best moment" });
    }
    if (rubric?.biggestMiss?.quote) {
      sections.push({ id: "biggest-miss", label: "Biggest miss" });
    }
    if (rubric?.nextStepExercises?.length) {
      sections.push({ id: "next-steps", label: "What to work on" });
    }
    sections.push({ id: "transcript", label: "Transcript" });
    return sections;
  }

  const s = summary as DeepDiveSummary | null | undefined;
  const sections: SectionLink[] = [{ id: "summary", label: "Summary" }];
  if (s?.insights?.length) sections.push({ id: "insights", label: "Insights" });
  if (s?.keyTopics?.length) sections.push({ id: "topics", label: "Topics covered" });
  if (s?.actionPoints?.length) sections.push({ id: "actions", label: "Action points" });
  if (s?.followUpNeeded && s?.followUpSuggestions?.length) {
    sections.push({ id: "follow-ups", label: "Follow-ups" });
  }
  sections.push({ id: "transcript", label: "Transcript" });
  return sections;
}

export function ConversationDetailClient({ callId }: Props) {
  const router = useRouter();

  const call = useQuery(api.voiceCalls.getCallById, {
    callId: callId as Id<"voice_calls">,
  });

  const archive = useMutation(api.voiceCalls.archive);
  const unarchive = useMutation(api.voiceCalls.unarchive);

  // ── Loading state ────────────────────────────────────────────────────────
  // Article-shape skeleton matches the eventual layout (TOC sidebar +
  // masthead + section stack) so the page rhythm doesn't shift when the
  // Convex query resolves. Honours prefers-reduced-motion via the shared
  // .skeleton-block utility.
  if (call === undefined) {
    return <WorkspaceLoadingArticle />;
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

  const sections = buildSections(surface, summary);

  // ── Render ───────────────────────────────────────────────────────────────
  // 12-col grid mirrors the career guide layout: lg:col-span-2 sticky TOC
  // sidebar + lg:col-span-8 reading column, max-w-6xl container.
  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
      {/* Top bar — back link + actions menu — full width */}
      <header className="mb-6 flex items-center justify-between gap-3 pt-4 sm:pt-6">
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

      <div className="lg:grid lg:grid-cols-12 lg:gap-12">
        {/* Desktop TOC sidebar — sticky, hidden below lg */}
        <aside className="hidden lg:col-span-2 lg:block">
          <div className="sticky top-24">
            <WikiTableOfContents sections={sections} eyebrow="In this summary" />
          </div>
        </aside>

        {/* Main reading column — lg:col-span-8 keeps body lines editorial-width */}
        <main className="lg:col-span-8">
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

          {/* Transcript — section label outside, ScrollArea sits inside a
              hairline rectangular container with an explicit height so the
              Radix Viewport's size-full resolves to a real boundary and the
              transcript actually scrolls instead of growing to content
              height. mb-16 keeps editorial breathing room before the page
              footer. */}
          <section id="transcript" className="mt-12 mb-16 scroll-mt-24">
            <p className="mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
              Transcript
            </p>
            <div className="h-[60vh] max-h-[640px] overflow-hidden border border-hairline bg-paper-raised">
              <ConversationTranscript messages={call.messages ?? []} />
            </div>
          </section>
        </main>
      </div>

      {/* Mobile floating section pill — hidden on lg+ (component self-hides) */}
      <MobileTableOfContents sections={sections} />
    </div>
  );
}
