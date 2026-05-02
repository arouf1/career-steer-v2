// app/workspace/discover/DiscoverCanvas.tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Authenticated, useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import {
  Maximize,
  Minus,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  GuideCard,
  LaneLabel,
  UserNode,
  type GuideCardData,
} from "./CanvasNodes";
import { CardPreviewSheet, type CardPreviewData } from "./CardPreviewSheet";
import { DensitySlider, type Density } from "./DensitySlider";
import { DiscoverFailed, DiscoverGenerating } from "./DiscoverEmptyState";
import { FocusedLaneView } from "./FocusedLaneView";
import {
  positionCard,
  QUADRANT_HALF_HEIGHT,
  QUADRANT_HALF_WIDTH,
} from "./lib/positionCard";

// Logical canvas size in virtual pixels. Everything is positioned relative
// to the centre (0, 0). The actual rendered size is computed by the resize
// observer below and applied via `transform: scale(...)`. The +800 padding
// gives the outermost cards generous breathing room — at the outer extent a
// `w-[200px]` card needs ~226px clearance and we want visible whitespace
// around the cluster, not edge-to-edge cards. Bumped from +600 to +800 so
// cards never reach the canvas edge even with the wider scatter.
const CANVAS_VIRTUAL_WIDTH = QUADRANT_HALF_WIDTH * 2 + 800; // 2240
const CANVAS_VIRTUAL_HEIGHT = QUADRANT_HALF_HEIGHT * 2 + 800; // 1840

// Zoom multiplier bounds — applied on top of the auto-fit scale.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.15;

const LANE_LABEL_TEXT = {
  linear: "Next steps",
  adjacent: "Sideways moves",
  earlier: "Earlier chapters",
  transformational: "A different chapter",
} as const;

// Lane labels live OUTSIDE the scaled virtual canvas — anchored to the
// outer top/bottom edge of the wrapper and centred horizontally over each
// column. The previous placement at the visual centre of each tint cell
// (25%/75%) collided with the aspirational rim of each quadrant: cards
// scatter outward from the user node and at typical aspect ratios the
// outermost cards land almost exactly where 25%/75% sits. Pushing labels
// to the wrapper edge keeps them in empty space and out of the card cluster.
const LANE_LABEL_POS: Record<
  LaneKey,
  { left: string; top?: string; bottom?: string }
> = {
  linear: { left: "25%", top: "1.25rem" },
  adjacent: { left: "75%", top: "1.25rem" },
  earlier: { left: "25%", bottom: "1.25rem" },
  transformational: { left: "75%", bottom: "1.25rem" },
};

type LaneKey = keyof typeof LANE_LABEL_TEXT;

type PositionedCard = GuideCardData & {
  lane: LaneKey;
  x: number;
  y: number;
};

function DiscoverCanvasInner() {
  const { user } = useUser();
  const snapshot = useQuery(api.discover.getSnapshot);
  // Don't `?? []` here: a fresh `[]` literal would change reference every
  // render and bust the `reactionByGuide` memo. Handle the null case below.
  const reactions = useQuery(api.discover.querySavedGuides);
  const manualRefresh = useMutation(api.discover.manualRefresh);

  const [density, setDensity] = useState<Density>(18);
  const [previewCard, setPreviewCard] = useState<CardPreviewData | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focusedLane, setFocusedLane] = useState<LaneKey | null>(null);

  // Compute scale to fit the canvas inside the wrapper. Re-runs on resize
  // and when zoom changes. The 1.2 multiplier zooms past the strict
  // contain-fit so the card cluster fills the visible canvas — the
  // virtual canvas already includes generous padding around the cluster
  // (CANVAS_VIRTUAL_WIDTH = QUADRANT_HALF * 2 + 800), and that padding
  // would double-up if we also shrank to 0.88 of the contain-fit. The
  // user-controlled `zoom` multiplier rides on top of the auto-fit scale.
  //
  // Wrapper is held as state (callback ref pattern) rather than a useRef so
  // the resize-observer effect re-runs when the element actually mounts.
  // With a useRef, the early-return loading state would mount/unmount the
  // wrapper without triggering the observer setup — `scale` would stay at
  // its initial 1 and cards would render way too big until something else
  // changed the deps (e.g. the user zooming).
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!wrapper) return;
    const update = () => {
      const sx = wrapper.clientWidth / CANVAS_VIRTUAL_WIDTH;
      const sy = wrapper.clientHeight / CANVAS_VIRTUAL_HEIGHT;
      setScale(Math.min(sx, sy) * 1.2 * zoom);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [wrapper, zoom]);

  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP)),
    [],
  );
  const zoomReset = useCallback(() => setZoom(1), []);

  // Ctrl/Cmd + wheel to zoom. React's onWheel attaches a passive listener
  // (preventDefault is a no-op there), so we use addEventListener with
  // passive: false on the wrapper. Bare wheel still scrolls the page
  // normally; only modified wheel intercepts. macOS trackpad pinch also
  // fires wheel events with ctrlKey: true, so this handles pinch too.
  useEffect(() => {
    if (!wrapper) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // deltaY positive = scroll down = zoom out; invert so up = zoom in.
      const delta = -e.deltaY * 0.002;
      setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + delta)));
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, [wrapper]);

  // Subscribe to primitive initials and fullName, not the whole `user`
  // object — Clerk's user reference changes on unrelated session ticks and
  // would invalidate the `cards` memo unnecessarily.
  const initials =
    (user?.firstName?.[0] ?? "Y") + (user?.lastName?.[0] ?? "ou");
  const fullName = user?.fullName ?? null;

  // Auto-trigger first-time generation when the user has no snapshot row
  // yet. `scheduleSnapshotRegeneration`'s 30s debounce + per-user gate
  // collapses any accidental re-fires; if `profile_embeddings` is missing
  // the schedule mutation warns + returns and the user stays in the
  // generating skeleton (a future improvement: surface a "complete your
  // profile to build the canvas" empty state explicitly).
  useEffect(() => {
    if (snapshot === null) {
      void manualRefresh({});
    }
  }, [snapshot, manualRefresh]);

  const reactionByGuide = useMemo(() => {
    const m = new Map<string, "saved">();
    if (reactions) {
      for (const r of reactions) m.set(r.guideId as string, "saved");
    }
    return m;
  }, [reactions]);

  const cards: PositionedCard[] = useMemo(() => {
    if (!snapshot || snapshot.status !== "ready") return [];
    const perLaneCap = Math.floor(density / 3);
    return snapshot.lanes.flatMap((lane) =>
      lane.cards
        // Curated 6 always present; extras included up to per-lane cap.
        // Index-aware filter avoids the O(n²) `lane.cards.indexOf(c)` lookup.
        .filter((c, i) => c.slotKind !== "extra" || i < perLaneCap)
        .map((c) => {
          const pos = positionCard({
            lane: lane.kind as LaneKey,
            slotKind: c.slotKind,
            arcScore: c.arcScore,
            guideId: c.guideId as string,
          });
          return {
            guideId: c.guideId,
            title: c.title,
            slotKind: c.slotKind,
            arcScore: c.arcScore,
            whyMatchReason: c.whyMatchReason,
            lane: lane.kind as LaneKey,
            x: pos.x,
            y: pos.y,
            // Carried so we can hand the full card object to the preview sheet.
            _full: c,
          } as PositionedCard & { _full: unknown };
        }),
    );
  }, [snapshot, density]);

  const handleRefresh = useCallback(() => {
    void manualRefresh({});
  }, [manualRefresh]);

  if (snapshot === undefined) return <DiscoverGenerating />;
  if (snapshot === null || snapshot.status === "generating")
    return <DiscoverGenerating />;
  if (snapshot.status === "failed")
    return <DiscoverFailed onRetry={handleRefresh} />;

  return (
    <motion.div
      ref={setWrapper}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="relative h-full w-full overflow-hidden bg-white"
    >
      {/*
        Quadrant tints — barely-visible cream variants, one per canvas
        region. Always fills the wrapper and never scales (background).
        Chroma stays below 0.01 so they read as "tinted neutrals," not
        colour blocks — the brand register is editorial cream, not Memphis
        primary.
      */}
      <div className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2">
        {/* top-left = Next steps — barely-tinted warm cream */}
        <div className="bg-[oklch(0.975_0.011_70)]" />
        {/* top-right = Sideways moves — barely-tinted cool cream */}
        <div className="bg-[oklch(0.973_0.009_220)]" />
        {/* bottom-left = Earlier chapters — barely-tinted green-cream */}
        <div className="bg-[oklch(0.973_0.010_130)]" />
        {/* bottom-right = A different chapter — barely-tinted lavender-cream */}
        <div className="bg-[oklch(0.973_0.011_290)]" />
      </div>

      {/*
        Lane labels — anchored to the wrapper's outer top/bottom edge and
        centred horizontally over each column. Sits in the empty margin
        around the card cluster, so the aspirational rim of each quadrant
        no longer collides with its label.
      */}
      {(Object.keys(LANE_LABEL_TEXT) as Array<LaneKey>).map((lane) => {
        const pos = LANE_LABEL_POS[lane];
        const count =
          snapshot.lanes.find((l) => l.kind === lane)?.cards.length ?? 0;
        return (
          <div
            key={`label:${lane}`}
            className="absolute z-20"
            style={{
              ...pos,
              transform: "translateX(-50%)",
            }}
          >
            <LaneLabel
              kind={lane}
              label={LANE_LABEL_TEXT[lane]}
              count={count}
              onFocus={() => setFocusedLane(lane)}
            />
          </div>
        );
      })}

      {/*
        Inner canvas — fixed virtual size, scaled to fit via transform.
        Holds the rings, user node, and cards. Lane labels live outside
        this scaled region (above) so they don't drift with the zoom.
      */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: CANVAS_VIRTUAL_WIDTH,
          height: CANVAS_VIRTUAL_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
        }}
      >
        {/* Origin (0, 0) container — sits at the visual centre of the canvas. */}
        <div
          className="absolute"
          style={{
            left: CANVAS_VIRTUAL_WIDTH / 2,
            top: CANVAS_VIRTUAL_HEIGHT / 2,
            width: 0,
            height: 0,
          }}
        >
          {/*
            Concentric rings centered on the user node — visual scale for
            "closer = closer fit." Generated at 160px intervals out to a
            wide outer radius so zooming out reveals progressively fainter
            rings. SVG sits at the origin div with overflow:visible so the
            circles render outside the 1px viewport.
          */}
          <svg
            className="pointer-events-none absolute"
            style={{
              left: 0,
              top: 0,
              width: 1,
              height: 1,
              overflow: "visible",
            }}
            aria-hidden
          >
            {Array.from({ length: 9 }, (_, i) => {
              const r = 200 + i * 160; // 200, 360, 520, ..., 1480
              // Lightness fades from 0.88 (inner) to 0.96 (outer, clamped).
              const lightness = Math.min(0.96, 0.88 + i * 0.008);
              const stroke = `oklch(${lightness} 0.005 35)`;
              return (
                <circle
                  key={i}
                  cx={0}
                  cy={0}
                  r={r}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1}
                />
              );
            })}
          </svg>

          {/* User node at canvas centre. */}
          <div
            className="absolute"
            style={{ left: 0, top: 0, transform: "translate(-50%, -50%)" }}
          >
            <UserNode
              initials={initials}
              currentRoleChip={fullName ?? undefined}
              onClick={() => {
                /* future: open user popover */
              }}
            />
          </div>

          {/* Guide cards. */}
          {cards.map((c) => {
            const full = (c as unknown as { _full: unknown })._full;
            return (
              <div
                key={c.guideId as string}
                // Hover/focus elevation lives on the wrapper, not the
                // button. The wrapper's `transform` creates its own
                // stacking context, which would trap any z-index set on
                // the inner button.
                className="absolute hover:z-10 focus-within:z-10"
                style={{
                  left: c.x,
                  top: c.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <GuideCard
                  card={c}
                  reaction={reactionByGuide.get(c.guideId as string)}
                  onClick={() => setPreviewCard(full as CardPreviewData)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/*
        Floating control cluster — top-right corner of the canvas. Refresh
        + settings cog (popover containing the density slider). The
        previous control strip above the canvas was dropped so the canvas
        fills the entire workspace area.
      */}
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Rebuild canvas"
          className="flex size-9 items-center justify-center rounded-md bg-ink text-paper transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <RefreshCw className="size-4" />
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Canvas settings"
              className="flex size-9 items-center justify-center rounded-md bg-ink text-paper transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <SlidersHorizontal className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 rounded-md border border-hairline bg-paper p-4 text-ink shadow-md"
          >
            <DensitySlider onChange={setDensity} />
          </PopoverContent>
        </Popover>
      </div>

      {/*
        Zoom controls — bottom-right corner. Stacked vertically: in / out /
        reset. Each button is `size-8` (smaller than the top-right `size-9`)
        since these are secondary chrome. Disabled state greys out at the
        zoom limit.
      */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={zoomIn}
          aria-label="Zoom in"
          disabled={zoom >= ZOOM_MAX}
          className="flex size-8 items-center justify-center rounded-md bg-ink text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          onClick={zoomOut}
          aria-label="Zoom out"
          disabled={zoom <= ZOOM_MIN}
          className="flex size-8 items-center justify-center rounded-md bg-ink text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          onClick={zoomReset}
          aria-label="Reset zoom"
          disabled={zoom === 1}
          className="flex size-8 items-center justify-center rounded-md bg-ink text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <Maximize className="size-4" />
        </button>
      </div>

      {/* Bottom-centre legend. */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
        <p className="text-[11px] italic text-mute">
          Closer to you means closer fit · Direction means kind of move
        </p>
      </div>

      {/*
        Focus mode — full-canvas overlay for one lane. Mounts when a lane
        label is clicked; back button or Escape returns. AnimatePresence
        keeps the exit fade alive after focusedLane is cleared. Lives at
        z-30, above all in-canvas chrome but below the preview sheet.
      */}
      <AnimatePresence>
        {focusedLane && (
          <FocusedLaneView
            key={focusedLane}
            lane={focusedLane}
            label={LANE_LABEL_TEXT[focusedLane]}
            cards={cards.filter((c) => c.lane === focusedLane)}
            reactionByGuide={reactionByGuide}
            onBack={() => setFocusedLane(null)}
            onCardClick={(c) => {
              const full = (c as unknown as { _full: unknown })._full;
              setPreviewCard(full as CardPreviewData);
              setFocusedLane(null);
            }}
          />
        )}
      </AnimatePresence>

      <CardPreviewSheet
        card={previewCard}
        open={previewCard !== null}
        onOpenChange={(o) => !o && setPreviewCard(null)}
      />
    </motion.div>
  );
}

export function DiscoverCanvas() {
  return (
    <Authenticated>
      <DiscoverCanvasInner />
    </Authenticated>
  );
}
