// app/workspace/career-compass/CanvasNodes.tsx
"use client";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Id } from "@/convex/_generated/dataModel";

export type GuideCardData = {
  guideId: Id<"career_guides"> | string;
  title: string;
  slotKind: "strong" | "bridge" | "aspirational" | "extra";
  arcScore: number;
  whyMatchReason: string;
};

const SLOT_BADGE_LABEL: Record<GuideCardData["slotKind"], string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "More",
};

export function GuideCard({
  card,
  reaction,
  onClick,
}: {
  card: GuideCardData;
  reaction?: "saved";
  onClick: () => void;
}) {
  const isSaved = reaction === "saved";
  return (
    <button
      type="button"
      data-testid="guide-card"
      onClick={onClick}
      className={cn(
        "group relative flex w-[200px] flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-all",
        // Magnify and elevate visually on hover/focus. z-elevation lives
        // on the wrapper div in DiscoverCanvas (the wrapper's transform
        // creates a stacking context that would trap any z-index here).
        "hover:scale-[2] hover:border-ink-deep hover:shadow-lg focus-visible:scale-[2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        isSaved
          ? "border-hairline-strong bg-paper-raised"
          : "border-hairline bg-white",
        card.slotKind === "extra" && "opacity-90",
      )}
    >
      {isSaved && (
        <Bookmark className="absolute right-2.5 top-2.5 size-3.5 fill-ink text-ink" />
      )}
      {/* Eyebrow — collapsed at rest, fades in on hover/focus. */}
      <span className="max-h-0 overflow-hidden text-[11px] italic text-mute opacity-0 transition-all duration-200 group-hover:max-h-6 group-hover:opacity-100 group-focus-visible:max-h-6 group-focus-visible:opacity-100">
        {SLOT_BADGE_LABEL[card.slotKind]}
      </span>
      {/* Title — always visible. */}
      <div className="line-clamp-2 text-sm font-medium leading-tight text-ink">
        {card.title}
      </div>
      {/* Why-match — collapsed at rest, expands on hover/focus. */}
      <div className="line-clamp-2 max-h-0 overflow-hidden text-xs italic text-ink-soft opacity-0 transition-all duration-200 group-hover:max-h-12 group-hover:opacity-100 group-focus-visible:max-h-12 group-focus-visible:opacity-100">
        {card.whyMatchReason}
      </div>
    </button>
  );
}

export function UserNode({
  initials,
  currentRoleChip,
  onClick,
}: {
  initials: string;
  currentRoleChip?: string;
  onClick?: () => void;
}) {
  const avatar = (
    <button
      type="button"
      onClick={onClick}
      className="flex size-20 items-center justify-center rounded-full bg-ink text-paper text-2xl font-medium ring-4 ring-paper transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-paper hover:scale-105"
    >
      <span>{initials}</span>
    </button>
  );

  if (!currentRoleChip) return avatar;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{avatar}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-[12px]">
          {currentRoleChip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function LaneLabel({
  label,
  count,
  onFocus,
}: {
  kind: "linear" | "adjacent" | "earlier" | "transformational";
  label: string;
  count: number;
  onFocus?: () => void;
}) {
  const content = (
    <div className="flex flex-col items-center gap-1 whitespace-nowrap">
      <span className="font-medium uppercase tracking-[0.2em] text-base text-ink/85">
        {label}
      </span>
      <span className="text-[11px] text-mute">
        {count} {count === 1 ? "guide" : "guides"}
      </span>
    </div>
  );

  if (count === 0 || !onFocus) {
    // No cards to focus into — render as static content.
    return <div className="pointer-events-none">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onFocus}
      className="rounded-md px-3 py-2 transition-colors hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
    >
      {content}
    </button>
  );
}
