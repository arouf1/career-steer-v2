"use client";
import Image from "next/image";
import { Bookmark } from "lucide-react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import type { CompassCard } from "../lib/mobileCompassTypes";

const SLOT_BADGE: Record<CompassCard["slotKind"], string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "More to explore",
};

/**
 * Mobile guide card row. Replaces the prior flat-text row with a small
 * editorial composition: thumbnail | title + why-match | match arc +
 * saved bookmark. Tap fills the entire card and opens the bottom sheet.
 *
 * Hero image subscribes lazily via Convex `useQuery` per card. With ~36
 * cards across 4 lanes that's 36 subscriptions, which Convex's client
 * cache handles cheaply (tiny payload, deduped). If profiling later
 * shows pressure here we can defer image subscription via Intersection
 * Observer; for now the simpler path wins.
 */
export function MobileGuideCard({
  card,
  reaction,
  onTap,
}: {
  card: CompassCard;
  reaction?: "saved";
  onTap: () => void;
}) {
  const image = useQuery(api.careerGuides.getCardImage, {
    guideId: card.guideId,
  });
  const matchPct = Math.round(card.arcScore * 100);
  const isSaved = reaction === "saved";

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${card.title}, ${SLOT_BADGE[card.slotKind]}, ${matchPct}% match`}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-card border px-3 py-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        isSaved
          ? "border-hairline-strong bg-paper-raised"
          : "border-hairline bg-white",
      )}
    >
      {/* Hero thumbnail, 64x64 rounded square. Renders a calm
          paper-raised placeholder until the image resolves. */}
      <div className="relative size-16 shrink-0 overflow-hidden rounded-md border border-hairline bg-paper-raised">
        {image && (
          <Image
            src={image.url}
            alt={image.alt}
            fill
            sizes="64px"
            className="object-cover"
          />
        )}
      </div>

      {/* Title + why-match */}
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-[10px] uppercase tracking-[0.16em] text-mute">
          {SLOT_BADGE[card.slotKind]}
        </div>
        <div className="mt-0.5 line-clamp-1 text-[14px] font-medium text-ink">
          {card.title}
        </div>
        <div className="mt-1 line-clamp-2 text-[12px] italic leading-snug text-ink-soft">
          {card.whyMatchReason}
        </div>
      </div>

      {/* Match arc + saved indicator */}
      <div className="flex shrink-0 flex-col items-center gap-1">
        <MatchArc value={card.arcScore} />
        {isSaved && (
          <Bookmark
            className="size-3.5 fill-ink text-ink"
            aria-label="Saved"
            strokeWidth={1.5}
          />
        )}
      </div>
    </button>
  );
}

/**
 * Tiny SVG arc that visualises arcScore as a stroke fraction around a
 * 28px circle. Quiet visual rhyme with the compass rings, same metaphor,
 * shrunk to per-card scale.
 */
function MatchArc({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  const r = 12;
  const C = 2 * Math.PI * r;
  const dash = `${C * v} ${C}`;
  const pct = Math.round(v * 100);
  return (
    <div className="relative size-7" aria-hidden>
      <svg viewBox="0 0 28 28" className="size-7 -rotate-90">
        <circle
          cx={14}
          cy={14}
          r={r}
          fill="none"
          stroke="oklch(0.88 0.004 35)"
          strokeWidth={2}
        />
        <circle
          cx={14}
          cy={14}
          r={r}
          fill="none"
          stroke="oklch(0.25 0.015 30)"
          strokeWidth={2}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-medium text-ink">
        {pct}
      </span>
    </div>
  );
}
