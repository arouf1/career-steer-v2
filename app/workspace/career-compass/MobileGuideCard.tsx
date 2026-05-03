// app/workspace/career-compass/MobileGuideCard.tsx
"use client";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

type SlotKind = "strong" | "bridge" | "aspirational" | "extra";

const SLOT_BADGE: Record<SlotKind, string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "More",
};

export type MobileGuideCardData = {
  guideId: Id<"career_guides">;
  title: string;
  slotKind: SlotKind;
  whyMatchReason: string;
  arcScore: number;
  reaction?: "saved";
};

export function MobileGuideCard({
  card,
  onTap,
}: {
  card: MobileGuideCardData;
  onTap: () => void;
}) {
  const matchScore = Math.round(card.arcScore * 100);
  const isSaved = card.reaction === "saved";
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "relative flex w-full flex-col gap-2 rounded-lg border px-4 py-3 text-left transition-all",
        "hover:border-ink-deep hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        isSaved
          ? "border-hairline-strong bg-paper-raised"
          : "border-hairline bg-white",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] italic text-mute">
          {SLOT_BADGE[card.slotKind]}
        </span>
        <span className="text-[11px] italic text-mute">{matchScore}% match</span>
      </div>
      <div className="text-sm font-medium text-ink line-clamp-2">{card.title}</div>
      <div className="text-xs italic text-ink-soft line-clamp-2">
        {card.whyMatchReason}
      </div>
      {isSaved && (
        <Bookmark className="absolute right-3 top-3 size-3.5 fill-ink text-ink" />
      )}
    </button>
  );
}
