"use client";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";

import {
  COMPASS_LANE_LABEL,
  COMPASS_LANE_TITLE,
} from "../lib/mobileCompassGeometry";
import type { CompassCard, CompassLane } from "../lib/mobileCompassTypes";
import { MobileGuideCard } from "./MobileGuideCard";
import { usePullToRefresh } from "@/lib/client/usePullToRefresh";

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
  /** Whether this lane is the active visible page in the pager. */
  isActive: boolean;
  /** Called when the user pulls past the threshold. Returns when complete. */
  onRefresh: () => Promise<void>;
  /** Called continuously with the lane's scrollTop. Active lane only. */
  onScrollY: (scrollTop: number) => void;
};

export type LaneFeedHandle = {
  /** Imperative read of the current scrollTop, for shell-side sync on lane switch. */
  getScrollTop: () => number;
};

/**
 * Vertical scroll feed for one lane. Owns its own scroll container so
 * pull-to-refresh and compass-shrink driven by scrollTop can both
 * coexist with horizontal lane swiping at the pager level. Embla locks
 * the gesture axis on touchstart, so vertical scroll/pull and horizontal
 * swipe never conflict.
 */
export const MobileLaneFeed = forwardRef<LaneFeedHandle, Props>(
  function MobileLaneFeed(
    {
      lane,
      cards,
      reactionByGuide,
      onCardTap,
      isActive,
      onRefresh,
      onScrollY,
    }: Props,
    ref,
  ) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const { containerRef: ptrRef, indicatorOpacity, refreshing, willTrigger } =
      usePullToRefresh({
        onRefresh,
        disabled: !isActive,
      });

    // Merge the local scroll ref with the pull-to-refresh hook's ref.
    const setRef = useCallback(
      (el: HTMLDivElement | null) => {
        scrollRef.current = el;
        ptrRef.current = el;
      },
      [ptrRef],
    );

    useImperativeHandle(
      ref,
      () => ({
        getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
      }),
      [],
    );

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
      <div className="relative h-full">
        {/* Pull-to-refresh indicator — pinned at top, fades in as the user pulls.
            Sits at z-index 1 so it floats above the scroll content. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-0 z-[1] flex items-center justify-center pt-2"
          style={{ opacity: indicatorOpacity }}
        >
          <ChevronDown
            className={
              "size-4 transition-transform duration-200 " +
              (willTrigger ? "rotate-180 text-ink" : "text-mute")
            }
            strokeWidth={1.75}
          />
        </div>

        <div
          ref={setRef}
          className="h-full overflow-y-auto overscroll-contain"
          onScroll={(e) => {
            if (isActive) onScrollY(e.currentTarget.scrollTop);
          }}
        >
          <div className="flex flex-col px-4 pb-12 pt-1">
            {/* Lane title block — confident editorial header. Always rendered
                (even when this lane is empty) so the user keeps their bearings
                while swiping. Eyebrow uses the short-form compass label so
                "NEXT STEPS" / "SIDEWAYS" / "EARLIER" / "PIVOTS" reads as the
                directional category, with the long-form serif title underneath
                as the section name. */}
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
              })
            )}
          </div>
        </div>

        {/* Loading overlay during refresh — keeps the indicator visible
            without changing scroll. */}
        {refreshing && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-0 z-[1] flex items-center justify-center py-3"
          >
            <span className="text-[11px] italic text-mute">Refreshing…</span>
          </div>
        )}
      </div>
    );
  },
);
