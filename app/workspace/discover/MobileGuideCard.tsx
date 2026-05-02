// app/workspace/discover/MobileGuideCard.tsx
"use client";
import { Bookmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
        "relative flex w-full flex-col gap-2 rounded-lg border bg-background px-4 py-3 text-left shadow-sm",
        isSaved && "border-amber-400 bg-amber-50/50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Badge variant="secondary" className="text-[10px]">
          {SLOT_BADGE[card.slotKind]}
        </Badge>
        <span className="text-xs text-ink/60">{matchScore}%</span>
      </div>
      <div className="text-sm font-medium text-ink line-clamp-2">{card.title}</div>
      <div className="text-xs italic text-ink/60 line-clamp-2">
        {card.whyMatchReason}
      </div>
      {isSaved && (
        <Bookmark className="absolute right-3 top-3 size-3.5 fill-amber-500 text-amber-500" />
      )}
    </button>
  );
}
