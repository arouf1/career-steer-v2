"use client";
import { useEffect, useMemo, useState } from "react";
import { motion, useTransform, type MotionValue } from "motion/react";

import {
  COMPASS_LANE_LABEL,
  COMPASS_LANE_ORDER,
  COMPASS_LANE_TITLE,
  NORMALISED_RADIUS,
  dotPosition,
  laneDotColor,
  laneTint,
  quadrantCenter,
  quadrantClipPath,
} from "../lib/mobileCompassGeometry";
import type { CompassCard, CompassLane } from "../lib/mobileCompassTypes";

type Props = {
  state: "loading" | "ready" | "failed";
  cards: ReadonlyArray<CompassCard>;
  activeLane: CompassLane;
  laneCounts: Record<CompassLane, number>;
  /**
   * Signed swipe progress from the lane pager (-1..1). 0 = settled,
   * ±1 = about to commit a lane change.
   */
  dragProgress: MotionValue<number>;
  /** Continuous scroll offset of the lane feed in pixels. */
  scrollY: MotionValue<number>;
  initials: string;
  /** One-shot reactive flash. Bump `ts` to refire. */
  lastFlash?: {
    guideId: string;
    kind: "save" | "dismiss";
    ts: number;
  } | null;
  prefersReducedMotion?: boolean;
};

const SCROLL_SHRINK = 200;
const CENTERPIECE_PX = 288;
const STICKY_PX = 96;

/**
 * Mobile Career Compass dial — passive indicator. Shows where the user is
 * in the career landscape (active lane = visibly darker quadrant slice)
 * but is *not* interactive: navigation between lanes happens via swiping
 * the pager below. Removing tap-to-switch gives the dial a single source
 * of truth (the pager) and keeps it from competing with the swipe gesture.
 *
 * Idle motion is intentionally restrained:
 *   - Avatar breathes very gently (4s opacity loop).
 *   - During loading the avatar pulses faster and sonar rings ripple.
 *   - No periodic scan sweep — was distracting once data was loaded.
 *
 * SVG renders in normalised viewBox `-1 -1 2 2`; geometry comes from
 * `mobileCompassGeometry.ts`. The compass shrinks from centerpiece to
 * sticky size based on the lane feed's scroll position.
 */
export function MobileCompass({
  state,
  cards,
  activeLane,
  laneCounts,
  dragProgress,
  scrollY,
  initials,
  lastFlash,
  prefersReducedMotion = false,
}: Props) {
  // Hoisted motion values — declared once per render in stable order.
  const sizePx = useTransform(scrollY, [0, SCROLL_SHRINK], [
    CENTERPIECE_PX,
    STICKY_PX,
  ]);
  const sizePxString = useTransform(sizePx, (v) => `${v}px`);
  const detailOpacity = useTransform(scrollY, [0, SCROLL_SHRINK * 0.6], [1, 0]);
  const stickyTextOpacity = useTransform(
    scrollY,
    [SCROLL_SHRINK * 0.5, SCROLL_SHRINK],
    [0, 1],
  );

  // Track the most recent flash so we can drive the dot bloom/fade.
  const [activeFlash, setActiveFlash] = useState<{
    guideId: string;
    kind: "save" | "dismiss";
    ts: number;
  } | null>(null);
  useEffect(() => {
    if (lastFlash) setActiveFlash(lastFlash);
  }, [lastFlash]);

  const laneLabelDim = state === "failed" ? 0.3 : 1;
  const ariaLabel = `Career landscape compass. Currently viewing ${COMPASS_LANE_TITLE[activeLane]}.`;

  return (
    <div className="flex w-full items-center justify-center">
      <motion.div
        className="flex items-center gap-3"
        style={{ width: sizePxString }}
      >
        <motion.svg
          viewBox="-1 -1 2 2"
          style={{
            width: sizePxString,
            height: sizePxString,
            overflow: "visible",
            flexShrink: 0,
          }}
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            <clipPath id="compass-disc">
              <circle cx={0} cy={0} r={1} />
            </clipPath>
          </defs>

          <g clipPath="url(#compass-disc)">
            {COMPASS_LANE_ORDER.map((lane) => (
              <QuadrantTint
                key={lane}
                lane={lane}
                activeLane={activeLane}
                dragProgress={dragProgress}
              />
            ))}
          </g>

          {/* Outer disc hairline */}
          <circle
            cx={0}
            cy={0}
            r={1}
            fill="none"
            stroke="oklch(0.85 0.005 35)"
            strokeWidth={0.006}
          />

          {/* Three labelled tier rings (strong/bridge/aspirational) */}
          {[
            NORMALISED_RADIUS.strong,
            NORMALISED_RADIUS.bridge,
            NORMALISED_RADIUS.aspirational,
          ].map((r) => (
            <circle
              key={r}
              cx={0}
              cy={0}
              r={r}
              fill="none"
              stroke="oklch(0.88 0.004 35)"
              strokeWidth={0.005}
            />
          ))}

          {/* Quadrant separator hairlines */}
          <line
            x1={-1}
            y1={0}
            x2={1}
            y2={0}
            stroke="oklch(0.88 0.004 35)"
            strokeWidth={0.004}
          />
          <line
            x1={0}
            y1={-1}
            x2={0}
            y2={1}
            stroke="oklch(0.88 0.004 35)"
            strokeWidth={0.004}
          />

          {/* Sonar ripples on loading only. Plain conditional render
              (no AnimatePresence) so when state flips to "ready" the
              component unmounts instantly. AnimatePresence + repeat:
              Infinity is a known motion gotcha — the exit transition
              never fires because the animate cycle keeps overriding it,
              which leaves the ripples spinning forever. */}
          {state === "loading" && <SonarRipples />}

          {state !== "loading" &&
            COMPASS_LANE_ORDER.map((lane) => (
              <LaneLabel
                key={`label:${lane}`}
                lane={lane}
                detailOpacity={detailOpacity}
                dim={laneLabelDim}
                animateIn={state === "ready"}
              />
            ))}

          {state === "ready" &&
            cards.map((card, i) => (
              <CardDot
                key={card.guideId as string}
                card={card}
                index={i}
                detailOpacity={detailOpacity}
                flash={
                  activeFlash &&
                  activeFlash.guideId === (card.guideId as string)
                    ? activeFlash
                    : null
                }
                prefersReducedMotion={prefersReducedMotion}
              />
            ))}

          <YouAvatar
            initials={initials}
            prefersReducedMotion={prefersReducedMotion}
            sonar={state === "loading"}
          />
        </motion.svg>

        <motion.div
          className="min-w-0 flex-1"
          style={{ opacity: stickyTextOpacity }}
          aria-hidden
        >
          <div className="font-serif text-base leading-tight text-ink">
            {COMPASS_LANE_TITLE[activeLane]}
          </div>
          <div className="mt-0.5 text-[11px] italic text-mute">
            {laneCounts[activeLane]}{" "}
            {laneCounts[activeLane] === 1 ? "option" : "options"}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ----- Sub-components ------------------------------------------------------

function QuadrantTint({
  lane,
  activeLane,
  dragProgress,
}: {
  lane: CompassLane;
  activeLane: CompassLane;
  dragProgress: MotionValue<number>;
}) {
  const adjacencyDelta = useMemo(
    () => laneDelta(activeLane, lane),
    [activeLane, lane],
  );
  const intensity = useTransform(dragProgress, (p) => {
    if (lane === activeLane) {
      return 1 - Math.min(0.7, Math.abs(p) * 0.7);
    }
    if (adjacencyDelta === 1 && p > 0) {
      return 0.3 + Math.min(0.7, p * 0.7);
    }
    if (adjacencyDelta === -1 && p < 0) {
      return 0.3 + Math.min(0.7, -p * 0.7);
    }
    return 0.3;
  });
  const fill = useTransform(intensity, (i) => laneTint(lane, i));
  return <motion.path d={quadrantClipPath(lane)} style={{ fill }} />;
}

function LaneLabel({
  lane,
  detailOpacity,
  dim,
  animateIn,
}: {
  lane: CompassLane;
  detailOpacity: MotionValue<number>;
  dim: number;
  animateIn: boolean;
}) {
  const opacity = useTransform(detailOpacity, (o) => o * dim);
  const c = useMemo(() => quadrantCenter(lane), [lane]);
  return (
    <motion.text
      x={c.x}
      y={c.y}
      textAnchor="middle"
      alignmentBaseline="middle"
      style={{
        opacity,
        fontSize: 0.075,
        fill: "oklch(0.45 0.015 35)",
      }}
      className="select-none uppercase tracking-[0.18em]"
      initial={animateIn ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.2, duration: 0.5 }}
    >
      {COMPASS_LANE_LABEL[lane]}
    </motion.text>
  );
}

function CardDot({
  card,
  index,
  detailOpacity,
  flash,
  prefersReducedMotion,
}: {
  card: CompassCard;
  index: number;
  detailOpacity: MotionValue<number>;
  flash: { kind: "save" | "dismiss"; ts: number } | null;
  prefersReducedMotion: boolean;
}) {
  const pos = useMemo(
    () =>
      dotPosition({
        lane: card.lane,
        slotKind: card.slotKind,
        guideId: card.guideId as string,
      }),
    [card.lane, card.slotKind, card.guideId],
  );
  const baseColor = laneDotColor(card.lane);
  const delay = prefersReducedMotion ? 0 : Math.min(0.9, index * 0.018);
  const flashKey = flash ? flash.ts : 0;
  const blooming = flash?.kind === "save";
  const dismissing = flash?.kind === "dismiss";

  return (
    <motion.circle
      key={flashKey}
      cx={pos.x}
      cy={pos.y}
      r={0.022}
      fill={baseColor}
      style={{ opacity: detailOpacity }}
      initial={{ scale: 0, opacity: 0 }}
      animate={
        blooming
          ? { scale: [1, 1.4, 1], opacity: [1, 1, 1] }
          : dismissing
            ? { scale: [1, 1, 1], opacity: [1, 0.5, 0.2] }
            : { scale: 1, opacity: 1 }
      }
      transition={
        blooming || dismissing
          ? { duration: 0.28, ease: "easeOut" }
          : prefersReducedMotion
            ? { duration: 0.2 }
            : { delay, duration: 0.5, ease: [0.2, 0.65, 0.3, 1] }
      }
    />
  );
}

function YouAvatar({
  initials,
  prefersReducedMotion,
  sonar,
}: {
  initials: string;
  prefersReducedMotion: boolean;
  sonar: boolean;
}) {
  return (
    <g>
      <motion.circle
        cx={0}
        cy={0}
        r={0.085}
        fill="oklch(0.25 0.015 30)"
        animate={
          prefersReducedMotion
            ? { opacity: 1, scale: 1 }
            : sonar
              ? { scale: [1, 1.06, 1], opacity: [0.92, 1, 0.92] }
              : { scale: 1, opacity: [0.95, 1, 0.95] }
        }
        transition={{
          duration: sonar ? 1.8 : 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      {/* Initials. iOS Safari renders `dominant-baseline="central"`
          inconsistently, so we use the bulletproof pattern instead:
          anchor at the geometric centre and shift the baseline down by
          0.35em, which is the standard offset for visually centring
          capital letters within their bounding box. Works identically
          across browsers and zoom levels. */}
      <text
        x={0}
        y={0}
        dy="0.35em"
        textAnchor="middle"
        fill="oklch(0.97 0.005 35)"
        style={{ fontSize: 0.07, fontWeight: 500 }}
        className="select-none"
        aria-hidden
      >
        {initials.slice(0, 2).toUpperCase()}
      </text>
    </g>
  );
}

function SonarRipples() {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={0}
          cy={0}
          r={0.1}
          fill="none"
          stroke="oklch(0.25 0.015 30)"
          strokeWidth={0.008}
          initial={{ scale: 0.4, opacity: 0.55 }}
          animate={{ scale: [0.4, 8, 8], opacity: [0.55, 0, 0] }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 2.6,
            times: [0, 0.7, 1],
            delay: i * 0.7,
            repeat: Infinity,
            ease: "easeOut",
          }}
          style={{ transformOrigin: "0 0" }}
        />
      ))}
    </g>
  );
}

function laneDelta(from: CompassLane, to: CompassLane): -1 | 0 | 1 | 2 {
  const fi = COMPASS_LANE_ORDER.indexOf(from);
  const ti = COMPASS_LANE_ORDER.indexOf(to);
  const d = ti - fi;
  if (d === 1 || d === -1) return d;
  if (d === 0) return 0;
  return 2;
}
