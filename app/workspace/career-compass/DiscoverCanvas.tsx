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
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  GuideCard,
  UserNode,
  WatermarkLabel,
  type GuideCardData,
} from "./CanvasNodes";
import { CardPreviewSheet, type CardPreviewData } from "./CardPreviewSheet";
import {
  DensitySlider,
  DENSITY_LEVEL_TO_VALUE,
  DENSITY_STORAGE_KEY,
  DENSITY_VALUE_TO_LEVEL,
  type Density,
  type DensityLevel,
} from "./DensitySlider";
import { DiscoverFailed, DiscoverGenerating } from "./DiscoverEmptyState";
import { FocusedLaneView } from "./FocusedLaneView";
import {
  positionCard,
  QUADRANT_HALF_HEIGHT,
  QUADRANT_HALF_WIDTH,
} from "./lib/positionCard";
import { CompassVoiceDock } from "@/components/career-compass/voice/CompassVoiceDock";
import type { CompassToolCallbacks } from "@/components/career-compass/voice/useCompassVoiceCall";

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

const LANE_META = {
  linear: {
    title: "Linear Lanes",
    description: "The natural next step from here",
  },
  adjacent: {
    title: "Adjacent Avenues",
    description: "Sideways moves into nearby fields",
  },
  earlier: {
    title: "Foundational Footprints",
    description: "Earlier-stage roles that share your foundation",
  },
  transformational: {
    title: "Transformational Tracks",
    description: "Bigger pivots that reshape your trajectory",
  },
} as const;

// Quadrant tint backgrounds — barely-visible cream variants on the editorial
// hue range. Each quadrant becomes a button (or div for empty lanes) and
// the watermark label sits centered inside.
const LANE_TINT_BG = {
  linear: "bg-[oklch(0.975_0.011_70)]",
  adjacent: "bg-[oklch(0.973_0.009_220)]",
  earlier: "bg-[oklch(0.973_0.010_130)]",
  transformational: "bg-[oklch(0.973_0.011_290)]",
} as const;

type LaneKey = keyof typeof LANE_META;

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
  const saveGuide = useMutation(api.discover.saveGuide);
  const removeSave = useMutation(api.discover.removeSave);
  const dismissGuide = useMutation(api.discover.dismissGuide);
  const undismissGuide = useMutation(api.discover.undismissGuide);
  const dismissedGuides = useQuery(api.discover.queryDismissedGuides);

  const [density, setDensityState] = useState<Density>(18);
  // Hydrate density from localStorage on mount and write through on every
  // change. The slider used to own this; lifted here so voice tool calls
  // share the same source of truth and the slider visual follows them.
  useEffect(() => {
    const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (!stored) return;
    const n = Number(stored);
    if (n === 18 || n === 36 || n === 60) setDensityState(n);
  }, []);
  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, String(next));
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, []);

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

  // ── Voice tool callbacks ────────────────────────────────────────────────
  // The compass voice adviser can act on the canvas — open a card, save /
  // unsave, dismiss, refresh — through these callbacks. Each returns
  // { ok, message } so the model can speak the result. We resolve guideId
  // back to a card via the snapshot so we can use the title in the message
  // and reject ids that aren't on the user's current canvas.
  const findCardByGuideId = useCallback(
    (guideId: string) => {
      if (!snapshot || snapshot.status !== "ready") return null;
      for (const lane of snapshot.lanes) {
        for (const c of lane.cards) {
          if ((c.guideId as string) === guideId) return c;
        }
      }
      return null;
    },
    [snapshot],
  );

  const onOpenCard = useCallback(
    async (guideId: string) => {
      const card = findCardByGuideId(guideId);
      if (!card) {
        return {
          ok: false as const,
          message: "That card isn't on your current canvas.",
        };
      }
      setPreviewCard(card as unknown as CardPreviewData);
      return { ok: true as const, message: `Opened ${card.title}.` };
    },
    [findCardByGuideId],
  );

  const onCloseCard = useCallback(async () => {
    setPreviewCard(null);
    return { ok: true as const, message: "Closed the card." };
  }, []);

  const onSaveCard = useCallback(
    async (guideId: string) => {
      const card = findCardByGuideId(guideId);
      if (!card) {
        return {
          ok: false as const,
          message: "That card isn't on your current canvas.",
        };
      }
      await saveGuide({ guideId: guideId as Id<"career_guides"> });
      return { ok: true as const, message: `Saved ${card.title}.` };
    },
    [findCardByGuideId, saveGuide],
  );

  const onUnsaveCard = useCallback(
    async (guideId: string) => {
      const card = findCardByGuideId(guideId);
      if (!card) {
        return {
          ok: false as const,
          message: "That card isn't on your current canvas.",
        };
      }
      await removeSave({ guideId: guideId as Id<"career_guides"> });
      return {
        ok: true as const,
        message: `Removed ${card.title} from your saved list.`,
      };
    },
    [findCardByGuideId, removeSave],
  );

  const onDismissCard = useCallback(
    async (guideId: string) => {
      const card = findCardByGuideId(guideId);
      if (!card) {
        return {
          ok: false as const,
          message: "That card isn't on your current canvas.",
        };
      }
      await dismissGuide({ guideId: guideId as Id<"career_guides"> });
      return {
        ok: true as const,
        message: `Dismissed ${card.title}. A replacement will slot in shortly.`,
      };
    },
    [findCardByGuideId, dismissGuide],
  );

  const onUndismissCard = useCallback(
    async (guideId: string) => {
      const dismissed = dismissedGuides?.find(
        (d) => (d.guideId as string) === guideId,
      );
      if (!dismissed) {
        return {
          ok: false as const,
          message: "That guide isn't in the recently-dismissed list.",
        };
      }
      await undismissGuide({ guideId: guideId as Id<"career_guides"> });
      return {
        ok: true as const,
        message: `Restored ${dismissed.title}. It'll reappear after the canvas regenerates.`,
      };
    },
    [dismissedGuides, undismissGuide],
  );

  const onRefreshCanvas = useCallback(async () => {
    await manualRefresh({});
    return {
      ok: true as const,
      message: "Refresh queued — give it about thirty seconds.",
    };
  }, [manualRefresh]);

  const onSetDensity = useCallback(
    async (level: string) => {
      if (level !== "focused" && level !== "explore" && level !== "wide") {
        return {
          ok: false as const,
          message: `Density must be focused, explore, or wide (got ${level}).`,
        };
      }
      const target = DENSITY_LEVEL_TO_VALUE[level as DensityLevel];
      if (target === density) {
        return {
          ok: true as const,
          message: `Already at ${level} — no change.`,
        };
      }
      setDensity(target);
      return {
        ok: true as const,
        message: `Density set to ${level}.`,
      };
    },
    [density, setDensity],
  );

  // Memoise the bundle so the dock's tools-ref effect only fires when one of
  // the callback identities actually changes (i.e. when snapshot tick alters
  // findCardByGuideId).
  const voiceTools = useMemo<CompassToolCallbacks>(
    () => ({
      onOpenCard,
      onCloseCard,
      onSaveCard,
      onUnsaveCard,
      onDismissCard,
      onUndismissCard,
      onRefreshCanvas,
      onSetDensity,
    }),
    [
      onOpenCard,
      onCloseCard,
      onSaveCard,
      onUnsaveCard,
      onDismissCard,
      onUndismissCard,
      onRefreshCanvas,
      onSetDensity,
    ],
  );

  if (snapshot === undefined) return <DiscoverGenerating initials={initials} />;
  if (snapshot === null || snapshot.status === "generating")
    return <DiscoverGenerating initials={initials} />;
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
        Quadrants — each tint cell is a button (or non-interactive div for
        empty lanes) with the lane watermark sitting low-opacity in the
        center. Cards in the inner-canvas div paint above and intercept
        their own clicks; only clicks on the visible tint area between
        cards trigger the quadrant's view-all action. Hover/focus on the
        empty space brightens the watermark and reveals the description.
      */}
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
        {(Object.keys(LANE_META) as Array<LaneKey>).map((lane) => {
          const count =
            snapshot.lanes.find((l) => l.kind === lane)?.cards.length ?? 0;
          const interactive = count > 0;
          if (!interactive) {
            return (
              <div
                key={`quadrant:${lane}`}
                className={cn("relative", LANE_TINT_BG[lane])}
              >
                <WatermarkLabel
                  label={LANE_META[lane].title}
                  interactive={false}
                />
              </div>
            );
          }
          return (
            <button
              key={`quadrant:${lane}`}
              type="button"
              onClick={() => setFocusedLane(lane)}
              aria-label={`View all ${count} ${count === 1 ? "guide" : "guides"} in ${LANE_META[lane].title}`}
              className={cn(
                "group relative cursor-pointer focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink",
                LANE_TINT_BG[lane],
              )}
            >
              <WatermarkLabel label={LANE_META[lane].title} interactive />
            </button>
          );
        })}
      </div>

      {/*
        Inner canvas — fixed virtual size, scaled to fit via transform.
        Holds the rings, user node, and cards. Lane labels live outside
        this scaled region (above) so they don't drift with the zoom.
      */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{
          width: CANVAS_VIRTUAL_WIDTH,
          height: CANVAS_VIRTUAL_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
        }}
      >
        {/* Origin (0, 0) container — sits at the visual centre of the canvas.
            The wrapper is pointer-events-none so clicks on empty space pass
            through to the quadrant buttons below; individual interactive
            children (UserNode wrapper, card wrappers) re-enable events. */}
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
            Concentric rings centered on the user node — fit-strength scale
            for "closer = closer fit." Three named rings at 360 / 520 / 680
            mark the slot-tier boundaries (strong / bridge / aspirational)
            from positionCard.ts; the unnamed rings between/beyond them are
            visual rhythm. Labels arc along the top of each named ring.
            SVG sits at the origin div with overflow:visible so the circles
            render outside the 1px viewport.
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
            {/* Ring band labels. Path traces the upper semicircle of each
                named ring so the text rides along its top, centered at
                12 o'clock via startOffset=50%. dy lifts the baseline above
                the ring stroke so they don't sit on the line. */}
            {[
              { r: 360, label: "Strong fit" },
              { r: 520, label: "Skill bridge" },
              { r: 680, label: "Aspirational" },
            ].map(({ r, label }) => {
              const pathId = `ring-label-${r}`;
              return (
                <g key={r}>
                  <defs>
                    <path
                      id={pathId}
                      d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`}
                      fill="none"
                    />
                  </defs>
                  <text
                    className="fill-current text-[11px] font-medium uppercase tracking-[0.22em] text-mute"
                    dy={-6}
                  >
                    <textPath
                      href={`#${pathId}`}
                      startOffset="50%"
                      textAnchor="middle"
                    >
                      {label}
                    </textPath>
                  </text>
                </g>
              );
            })}
          </svg>

          {/* User node at canvas centre. */}
          <div
            className="pointer-events-auto absolute"
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
                // the inner button. `pointer-events-auto` re-enables clicks
                // (the inner-canvas wrapper sets `pointer-events-none` so
                // empty-space clicks reach the quadrant buttons below).
                className="pointer-events-auto absolute hover:z-10 focus-within:z-10"
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
        Floating control cluster — bottom-left corner of the canvas.
        Refresh + settings stacked above the zoom controls (in / out /
        reset), with a hairline divider separating the two groups. Sizes
        stay differentiated (size-9 for primary actions, size-8 for zoom
        chrome) and items-center keeps the column visually aligned.
        Settings popover opens up-and-to-the-right (side="right",
        align="end") so it doesn't clip against the canvas bottom.
      */}
      <div className="absolute bottom-4 left-4 flex flex-col items-center gap-2">
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
            side="right"
            align="end"
            className="w-72 rounded-md border border-hairline bg-paper p-4 text-ink shadow-md"
          >
            <div className="flex flex-col gap-4">
              <DensitySlider value={density} onChange={setDensity} />
              {dismissedGuides && dismissedGuides.length > 0 && (
                <>
                  <div aria-hidden="true" className="h-px w-full bg-hairline" />
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
                      Recently dismissed
                    </span>
                    <ul className="-mx-1 max-h-56 overflow-y-auto">
                      {dismissedGuides.map((g) => (
                        <li
                          key={g.guideId}
                          className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-paper-raised"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                            {g.title}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void undismissGuide({ guideId: g.guideId })
                            }
                            aria-label={`Restore ${g.title}`}
                            title="Restore to canvas"
                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-ink hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                          >
                            <RotateCcw
                              className="size-3.5"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <div aria-hidden="true" className="my-1 h-px w-5 bg-hairline" />
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
        Voice assistant dock. Idle state is a small pill bottom-right
        (paired-but-opposite from the zoom controls cluster bottom-left);
        active state expands inline into a 480px dock with a frequency
        waveform + status line + mute / end controls. Caption-free by
        design — the canvas should remain the focal point. Snapshot is
        guaranteed status="ready" at this point in the render tree, so we
        always pass canvasReady={true}.
      */}
      <CompassVoiceDock
        canvasReady
        tools={voiceTools}
        sheetOpen={previewCard !== null}
        densityLevel={DENSITY_VALUE_TO_LEVEL[density]}
        surface="desktop"
      />


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
            label={LANE_META[focusedLane].title}
            description={LANE_META[focusedLane].description}
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
