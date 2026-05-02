// app/workspace/discover/FocusedLaneView.tsx
"use client";
import { useEffect } from "react";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import type { GuideCardData } from "./CanvasNodes";

const LANE_TINT: Record<string, string> = {
  linear: "oklch(0.975 0.011 70)",
  adjacent: "oklch(0.973 0.009 220)",
  earlier: "oklch(0.973 0.010 130)",
  transformational: "oklch(0.973 0.011 290)",
};

const SLOT_LABEL: Record<GuideCardData["slotKind"], string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "More",
};

// `x` / `y` are the card's position in the canvas's virtual coordinate
// system, where the user node sits at (0, 0). Carrying them through
// from DiscoverCanvas lets the focused grid mirror the canvas's
// "closer = closer fit" ordering rather than re-sorting by slot tier.
export type FocusedCard = GuideCardData & {
  lane: string;
  x: number;
  y: number;
};

export function FocusedLaneView({
  lane,
  label,
  cards,
  reactionByGuide,
  onBack,
  onCardClick,
}: {
  lane: string;
  label: string;
  cards: Array<FocusedCard>;
  reactionByGuide: Map<string, "saved">;
  onBack: () => void;
  onCardClick: (card: FocusedCard) => void;
}) {
  // Esc to exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  // Sort by squared Euclidean distance from the user node — mirrors the
  // canvas where closer to (0, 0) means closer fit. Squared distance is
  // sufficient since we only need ordering, not the actual magnitude.
  const sorted = [...cards].sort(
    (a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y),
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="absolute inset-0 z-30 flex flex-col"
      style={{ backgroundColor: LANE_TINT[lane] ?? "white" }}
    >
      {/* Top bar — back button + lane title */}
      <div className="flex items-center justify-between border-b border-hairline/60 bg-paper/40 px-6 py-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <ArrowLeft className="size-4" />
          Back to canvas
        </button>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-medium uppercase tracking-[0.2em] text-base text-ink/85">
            {label}
          </span>
          <span className="text-[11px] text-mute">
            {sorted.length} {sorted.length === 1 ? "guide" : "guides"}
          </span>
        </div>
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map((card, i) => (
            <motion.div
              key={card.guideId as string}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.03, ease: "easeOut" }}
            >
              <FocusedCardItem
                card={card}
                reaction={reactionByGuide.get(card.guideId as string)}
                onClick={() => onCardClick(card)}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// Variant of GuideCard that shows full content always (no hover-expand).
function FocusedCardItem({
  card,
  reaction,
  onClick,
}: {
  card: FocusedCard;
  reaction?: "saved";
  onClick: () => void;
}) {
  const isSaved = reaction === "saved";
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group relative flex h-full w-full flex-col gap-2 rounded-lg border px-4 py-4 text-left transition-colors hover:border-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper " +
        (isSaved
          ? "border-hairline-strong bg-paper-raised"
          : "border-hairline bg-white")
      }
    >
      <span className="text-[11px] italic text-mute">
        {SLOT_LABEL[card.slotKind]}
      </span>
      <div className="text-base font-medium leading-tight text-ink">
        {card.title}
      </div>
      <div className="text-sm italic text-ink-soft leading-relaxed">
        {card.whyMatchReason}
      </div>
    </button>
  );
}
