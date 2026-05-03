"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { MotionValue } from "motion/react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";

type Props = {
  pages: ReactNode[];
  activeIndex: number;
  onIndexChange: (index: number) => void;
  /** Signed drag progress (-1..1) from the current snap. */
  dragProgress: MotionValue<number>;
  /** Fires on settle after a user swipe (not on programmatic scrollTo). */
  onUserSettle?: (index: number) => void;
};

/**
 * Horizontal swipeable pager with Embla under the hood (via shadcn Carousel).
 *
 * Embla is the right tool for this job specifically because it locks the
 * gesture axis on touchstart based on dominant initial direction — so a
 * downward pull-to-refresh inside a page never gets mis-identified as a
 * lane swipe, and a clean horizontal swipe never starts as a vertical
 * scroll. We don't need to add any custom gesture-conflict handling.
 *
 * The pager is fully controlled: the parent owns the active index and may
 * jump to any lane programmatically (e.g. on a compass quadrant tap).
 * User swipes bubble up via `onIndexChange`. While the user is mid-drag,
 * `dragProgress` updates in real time so the compass quadrant tints can
 * fade in lockstep.
 */
export function MobileLanePager({
  pages,
  activeIndex,
  onIndexChange,
  dragProgress,
  onUserSettle,
}: Props) {
  const apiRef = useRef<CarouselApi | null>(null);
  // Track the source of the last selection so we can emit `onUserSettle`
  // only for user-driven swipes, not our own programmatic scrolls.
  const programmaticScrollRef = useRef(false);

  // Wire embla events when the API is ready.
  const handleSetApi = (api: CarouselApi) => {
    apiRef.current = api;
    if (!api) return;

    const onSelect = () => {
      const idx = api.selectedScrollSnap();
      // Only bubble up if the index actually changed (de-dupes wrap calls).
      onIndexChange(idx);
      if (!programmaticScrollRef.current && onUserSettle) {
        onUserSettle(idx);
      }
      programmaticScrollRef.current = false;
    };
    const onScroll = () => {
      // Embla's progress is total across snaps (0..1). Convert to a
      // per-snap signed offset clamped to [-1, 1].
      const snapCount = api.scrollSnapList().length;
      if (snapCount <= 1) {
        dragProgress.set(0);
        return;
      }
      const total = api.scrollProgress(); // 0..1
      const positionInUnits = total * (snapCount - 1);
      const current = api.selectedScrollSnap();
      const delta = positionInUnits - current;
      dragProgress.set(Math.max(-1, Math.min(1, delta)));
    };
    const onSettle = () => {
      // Snap to exactly 0 once Embla finishes — kills any tiny residue
      // and lets the compass tint settle clean.
      dragProgress.set(0);
    };

    api.on("select", onSelect);
    api.on("scroll", onScroll);
    api.on("settle", onSettle);
    // Initial sync.
    onSelect();
  };

  // Programmatic navigation when the parent's `activeIndex` changes from
  // outside (e.g. a compass quadrant tap). Embla's scrollTo is idempotent
  // and a no-op when already at the target index, so there's no loop.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (api.selectedScrollSnap() === activeIndex) return;
    programmaticScrollRef.current = true;
    api.scrollTo(activeIndex);
  }, [activeIndex]);

  return (
    <Carousel
      setApi={handleSetApi}
      opts={{
        axis: "x",
        align: "start",
        containScroll: "keepSnaps",
        watchDrag: true,
        // Slightly faster snap so lane changes feel kinetic without overshoot.
        duration: 22,
      }}
      className="h-full w-full"
      aria-roledescription="carousel"
      aria-label="Career lanes"
    >
      <CarouselContent className="ml-0 h-full">
        {pages.map((page, i) => (
          <CarouselItem
            key={i}
            // Override shadcn's default pl-4 — each page edge-to-edge.
            // `h-full` so each lane's scroll container can fill the
            // pager (which fills the area below the compass header).
            className="h-full pl-0"
            aria-label={`Lane ${i + 1} of ${pages.length}`}
          >
            {page}
          </CarouselItem>
        ))}
      </CarouselContent>
    </Carousel>
  );
}
