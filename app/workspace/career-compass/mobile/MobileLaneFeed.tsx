"use client";
import { motion } from "motion/react";

import {
  COMPASS_LANE_LABEL,
  COMPASS_LANE_TITLE,
} from "../lib/mobileCompassGeometry";
import type { CompassCard, CompassLane } from "../lib/mobileCompassTypes";
import { MobileGuideCard } from "./MobileGuideCard";

const TIER_LABEL: Record<CompassCard["slotKind"], string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "More to explore",
};

const TIER_ORDER: ReadonlyArray<CompassCard["slotKind"]> = [
  "strong",
  "bridge",
  "aspirational",
  "extra",
] as const;

const EXTRA_CAP = 6;

type Props = {
  lane: CompassLane;
  cards: ReadonlyArray<CompassCard>;
  reactionByGuide: ReadonlyMap<string, "saved">;
  onCardTap: (card: CompassCard) => void;
};

/**
 * Vertical content for one lane. Sizes to its own content — no `h-full`,
 * no internal scroll. The shell owns the page-level scroll, and the lane
 * pager (Embla + AutoHeight plugin) resizes the carousel viewport to
 * match the active lane's height. So a lane with one card renders at
 * one-card height; a lane with fourteen renders at fourteen-card height
 * and the shell scrolls.
 */
export function MobileLaneFeed({
  lane,
  cards,
  reactionByGuide,
  onCardTap,
}: Props) {
  // Group cards by tier and sort within tier by arcScore desc.
  const byTier = new Map<CompassCard["slotKind"], CompassCard[]>();
  for (const c of cards) {
    let arr = byTier.get(c.slotKind);
    if (!arr) {
      arr = [];
      byTier.set(c.slotKind, arr);
    }
    arr.push(c);
  }
  for (const tier of TIER_ORDER) {
    const arr = byTier.get(tier);
    if (!arr) continue;
    arr.sort((a, b) => b.arcScore - a.arcScore);
    if (tier === "extra" && arr.length > EXTRA_CAP) {
      arr.length = EXTRA_CAP;
    }
  }

  return (
    <div className="flex flex-col px-4 pb-12 pt-1">
      {/* Lane title block — confident editorial header. Always rendered
          (even when this lane is empty) so the user keeps their bearings
          while swiping. Eyebrow uses the short-form compass label. */}
      <header className="mb-4 mt-2">
        <p className="text-[10px] uppercase tracking-[0.24em] text-mute">
          {COMPASS_LANE_LABEL[lane]}
        </p>
        <h2 className="mt-1 font-serif text-[24px] leading-[1.05] tracking-tight text-ink">
          {COMPASS_LANE_TITLE[lane]}
        </h2>
        <p className="mt-1 text-[12px] italic text-ink-soft">
          {cards.length === 0
            ? "No options in this direction yet"
            : `${cards.length} ${cards.length === 1 ? "option" : "options"} matched to you`}
        </p>
      </header>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 pt-10 text-center">
          <p className="max-w-[26ch] font-serif text-[15px] italic leading-relaxed text-mute">
            Swipe left or right to see your other directions.
          </p>
        </div>
      ) : (
        TIER_ORDER.map((tier) => {
          const tierCards = byTier.get(tier);
          if (!tierCards || tierCards.length === 0) return null;
          return (
            <motion.section
              key={tier}
              className="mt-5 first:mt-1"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.35,
                ease: [0.2, 0.65, 0.3, 1],
              }}
            >
              <header className="mb-3 flex items-baseline gap-3 px-1">
                <span className="font-serif text-[15px] italic leading-none text-ink">
                  {TIER_LABEL[tier]}
                </span>
                <span
                  aria-hidden
                  className="h-px flex-1 translate-y-[-2px] bg-hairline"
                />
                <span className="text-[10px] uppercase tracking-[0.18em] text-mute">
                  {tierCards.length}
                </span>
              </header>
              <ul className="flex flex-col gap-2" role="list">
                {tierCards.map((c) => (
                  <li key={c.guideId as string}>
                    <MobileGuideCard
                      card={c}
                      reaction={reactionByGuide.get(c.guideId as string)}
                      onTap={() => onCardTap(c)}
                    />
                  </li>
                ))}
              </ul>
            </motion.section>
          );
        })
      )}
    </div>
  );
}
