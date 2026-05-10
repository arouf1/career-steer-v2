"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";
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
  /** Whether this lane is the currently visible page in the pager. */
  isActive: boolean;
  /** Reports the lane's scrollTop upward; only fires when isActive. */
  onScrollY: (scrollTop: number) => void;
};

export type LaneFeedHandle = {
  /** Read the current scrollTop, used by the shell to sync compass shrink on lane change. */
  getScrollTop: () => number;
};

/**
 * One lane's content. Each lane owns its own scroll container so swiping
 * between lanes resets to that lane's scroll position rather than carrying
 * the previous lane's offset.
 *
 * The slide is `h-full` (it fills the carousel viewport, which fills the
 * pager, which fills the area below the compass header). Inside, content
 * sits in a flex column with `mt-auto` on the end-of-list marker so the
 * marker floats to the bottom of the viewport on sparse lanes, turning
 * the cream space between cards and marker into intentional whitespace.
 */
export const MobileLaneFeed = forwardRef<LaneFeedHandle, Props>(
  function MobileLaneFeed(
    { lane, cards, reactionByGuide, onCardTap, isActive, onScrollY }: Props,
    ref,
  ) {
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
      }),
      [],
    );

    // Bucket cards by tier and sort within tier by arcScore desc.
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
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto overscroll-contain"
        onScroll={(e) => {
          if (isActive) onScrollY(e.currentTarget.scrollTop);
        }}
      >
        <div className="flex min-h-full flex-col px-4 pb-10 pt-1">
          {/* Lane title block */}
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
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="max-w-[26ch] font-serif text-[15px] italic leading-relaxed text-mute">
                Swipe left or right to see your other directions.
              </p>
            </div>
          ) : (
            <>
              {TIER_ORDER.map((tier) => {
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
                            reaction={reactionByGuide.get(
                              c.guideId as string,
                            )}
                            onTap={() => onCardTap(c)}
                          />
                        </li>
                      ))}
                    </ul>
                  </motion.section>
                );
              })}

              {/* End-of-list marker, `mt-auto` floats it to the bottom of
                  the bounded lane viewport when content is sparse, so the
                  cream space between cards and marker reads as intentional
                  whitespace rather than missing content. On dense lanes it
                  sits naturally after the last card, reachable via scroll. */}
              <div
                aria-hidden
                className="mt-auto pt-10 flex items-center justify-center gap-3 px-12 opacity-70"
              >
                <span className="h-px flex-1 bg-hairline" />
                <span className="font-serif text-[11px] italic text-mute">
                  end of {cards.length === 1 ? "this option" : "this list"}
                </span>
                <span className="h-px flex-1 bg-hairline" />
              </div>
            </>
          )}
        </div>
      </div>
    );
  },
);
