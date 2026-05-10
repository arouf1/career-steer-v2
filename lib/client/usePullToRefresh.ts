"use client";
import { useEffect, useRef, useState } from "react";

type Options = {
  /**
   * Called once when the user releases past the threshold. Should return a
   * promise, the indicator stays visible until the promise resolves.
   */
  onRefresh: () => Promise<void> | void;
  /**
   * Pixels of pull required to trigger. Defaults to 70.
   */
  threshold?: number;
  /**
   * Maximum visible pull (the indicator clamps here). Defaults to 110.
   */
  max?: number;
  /**
   * Disable pull-to-refresh (e.g. while a sheet is open).
   */
  disabled?: boolean;
};

/**
 * Lightweight pull-to-refresh primitive for a scroll container.
 *
 * Usage:
 *   const { containerRef, pullDistance, refreshing, indicatorOpacity } =
 *     usePullToRefresh({ onRefresh });
 *
 *   <div ref={containerRef} className="overflow-y-auto">
 *      // ... scrolling content ...
 *   </div>
 *
 * The hook only intercepts touch gestures when the container is at scrollTop
 * 0 and the gesture is pulling downward. Vertical scroll inside the
 * container otherwise behaves natively. No interference with horizontal
 * gestures (those are typically handled by an outer pager. Embla locks
 * its own axis on touchstart).
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 70,
  max = 110,
  disabled = false,
}: Options) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Track gesture state in a ref so handlers see the latest value without
  // re-binding on every render.
  // `axisLocked` is set on the first move that crosses the deadband and
  // remains until touchend, once we've decided "this is a horizontal swipe"
  // we do nothing for the rest of the gesture, so a slightly-diagonal swipe
  // never accidentally fires pull-to-refresh.
  const gesture = useRef<{
    startY: number | null;
    startX: number | null;
    capturing: boolean;
    axisLocked: "vertical" | "horizontal" | null;
  }>({
    startY: null,
    startX: null,
    capturing: false,
    axisLocked: null,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      // Only arm the gesture when the container is at the top of its scroll.
      if (el.scrollTop > 0) {
        gesture.current = {
          startY: null,
          startX: null,
          capturing: false,
          axisLocked: null,
        };
        return;
      }
      gesture.current = {
        startY: e.touches[0].clientY,
        startX: e.touches[0].clientX,
        capturing: false,
        axisLocked: null,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (gesture.current.startY === null || gesture.current.startX === null) {
        return;
      }
      const dy = e.touches[0].clientY - gesture.current.startY;
      const dx = e.touches[0].clientX - gesture.current.startX;
      // If we've already decided the axis on a prior move, honour it for
      // the rest of the gesture.
      if (gesture.current.axisLocked === "horizontal") return;

      // First-time axis decision: wait for the gesture to leave a small
      // deadband, then commit to whichever axis dominates. Horizontal lock
      // means the lane pager owns the gesture; vertical lock means
      // pull-to-refresh owns it. This is the same axis-lock pattern Embla
      // uses on its side, so the two never fight.
      if (gesture.current.axisLocked === null) {
        const moved = Math.max(Math.abs(dx), Math.abs(dy));
        if (moved < 8) return; // deadband, too small to commit yet
        if (Math.abs(dx) > Math.abs(dy)) {
          gesture.current.axisLocked = "horizontal";
          return;
        }
        gesture.current.axisLocked = "vertical";
      }

      // Vertical-locked gesture from here on.
      if (dy <= 0) {
        // Upward, release the gesture so vertical scroll resumes.
        gesture.current = {
          startY: null,
          startX: null,
          capturing: false,
          axisLocked: null,
        };
        setPullDistance(0);
        return;
      }
      // Downward at scrollTop 0, capture the pull.
      gesture.current.capturing = true;
      // Resistance: linear up to threshold, then slows.
      const resisted =
        dy < threshold ? dy : threshold + (dy - threshold) * 0.4;
      setPullDistance(Math.min(max, resisted));
      // Prevent the page (or parent) from also scrolling while we're pulling.
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      const captured = gesture.current.capturing;
      gesture.current = {
        startY: null,
        startX: null,
        capturing: false,
        axisLocked: null,
      };
      if (!captured) {
        setPullDistance(0);
        return;
      }
      if (pullDistance >= threshold) {
        setRefreshing(true);
        setPullDistance(threshold); // settle at the indicator's final position
        Promise.resolve(onRefresh()).finally(() => {
          setRefreshing(false);
          setPullDistance(0);
        });
      } else {
        setPullDistance(0);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [disabled, max, onRefresh, pullDistance, refreshing, threshold]);

  // Indicator opacity ramps in over the first 30% of the pull and saturates
  // by the threshold. Lets the indicator fade in smoothly instead of pop.
  const indicatorOpacity = Math.min(
    1,
    Math.max(0, (pullDistance / threshold - 0.2) / 0.8),
  );
  const willTrigger = pullDistance >= threshold && !refreshing;

  return {
    containerRef,
    pullDistance,
    refreshing,
    indicatorOpacity,
    willTrigger,
  };
}
