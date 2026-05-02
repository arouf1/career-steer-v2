// app/workspace/discover/DiscoverCanvas.tsx
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Authenticated, useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import {
  GuideCard,
  LaneLabel,
  UserNode,
  type GuideCardData,
} from "./CanvasNodes";
import { CardPreviewSheet, type CardPreviewData } from "./CardPreviewSheet";
import { DensitySlider, type Density } from "./DensitySlider";
import { DiscoverFailed, DiscoverGenerating } from "./DiscoverEmptyState";
import {
  positionCard,
  QUADRANT_CENTER,
  QUADRANT_HALF_HEIGHT,
  QUADRANT_HALF_WIDTH,
} from "./lib/positionCard";

// Logical canvas size in virtual pixels. Everything is positioned relative
// to the centre (0, 0). The actual rendered size is computed by the resize
// observer below and applied via `transform: scale(...)`. The +200 padding
// gives the outermost cards room to sit fully inside the canvas without
// being clipped at the edge.
const CANVAS_VIRTUAL_WIDTH = QUADRANT_HALF_WIDTH * 2 + 200; // 1640
const CANVAS_VIRTUAL_HEIGHT = QUADRANT_HALF_HEIGHT * 2 + 200; // 1240

const LANE_LABEL_TEXT = {
  linear: "Next steps",
  adjacent: "Sideways moves",
  earlier: "Earlier chapters",
  transformational: "A different chapter",
} as const;

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

  // Compute scale to fit the canvas inside the wrapper. Re-runs on resize.
  // 0.95 leaves a small visual margin around the canvas so card edges and
  // ring strokes never touch the wrapper bounds.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      const sx = el.clientWidth / CANVAS_VIRTUAL_WIDTH;
      const sy = el.clientHeight / CANVAS_VIRTUAL_HEIGHT;
      setScale(Math.min(sx, sy) * 0.95);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    <div className="relative flex h-full w-full flex-col bg-white">
      {/*
        Control strip — fixed above the canvas. Lives between the workspace
        topbar and the canvas itself. Previously the density slider + refresh
        button were a `top-right` Panel inside React Flow, which collided
        visually with the "Sideways moves" lane label that sits at the centre
        of the top-right quadrant.
      */}
      <div className="flex items-center justify-end gap-2 border-b border-hairline bg-paper px-4 py-2">
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Rebuild canvas"
          className="flex items-center justify-center rounded-md border border-hairline bg-paper-raised px-3 py-2 text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <RefreshCw className="size-4" />
        </button>
        <DensitySlider onChange={setDensity} />
      </div>

      {/* Canvas wrapper — fills remaining space, scales the inner canvas to fit. */}
      <div ref={wrapperRef} className="relative flex-1 overflow-hidden">
        {/*
          Quadrant tints — barely-visible cream variants, one per canvas
          region. Always fills the wrapper and never scales (background).
          Chroma stays below 0.01 so they read as "tinted neutrals," not
          colour blocks — the brand register is editorial cream, not Memphis
          primary.
        */}
        <div className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2">
          {/* top-left = Next steps — warm-yellow cream (most aspirational, draws eye) */}
          <div className="bg-[oklch(0.985_0.008_70)]" />
          {/* top-right = Sideways moves — cool-neutral cream */}
          <div className="bg-[oklch(0.98_0.005_220)]" />
          {/* bottom-left = Earlier chapters — slight green-cream (foundational, calm) */}
          <div className="bg-[oklch(0.978_0.007_120)]" />
          {/* bottom-right = A different chapter — lavender (alternative direction) */}
          <div className="bg-[oklch(0.978_0.008_290)]" />
        </div>

        {/*
          Inner canvas — fixed virtual size, scaled to fit via transform.
          The wrapper around the origin div is a flex container that centres
          the origin in its own bounds — this is what places (0, 0) at the
          centre of the canvas. All cards/rings/labels are positioned in
          canvas coords (relative to that origin) via absolute children.
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
              "closer = closer fit." 3 hairlines at 250 / 430 / 610 align
              roughly with the strong / bridge / aspirational tiers. SVG sits
              at the origin div with overflow:visible so the circles render
              outside the 1px viewport.
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
              <circle
                cx={0}
                cy={0}
                r={250}
                fill="none"
                stroke="oklch(0.9 0.005 35)"
                strokeWidth={1}
              />
              <circle
                cx={0}
                cy={0}
                r={430}
                fill="none"
                stroke="oklch(0.92 0.005 35)"
                strokeWidth={1}
              />
              <circle
                cx={0}
                cy={0}
                r={610}
                fill="none"
                stroke="oklch(0.93 0.005 35)"
                strokeWidth={1}
              />
            </svg>

            {/* Lane labels at the visual centre of each quadrant. */}
            {(Object.keys(LANE_LABEL_TEXT) as Array<LaneKey>).map((lane) => {
              const pos = QUADRANT_CENTER[lane];
              const count =
                snapshot.lanes.find((l) => l.kind === lane)?.cards.length ?? 0;
              return (
                <div
                  key={`label:${lane}`}
                  className="absolute"
                  style={{
                    left: pos.x,
                    top: pos.y,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <LaneLabel
                    kind={lane}
                    label={LANE_LABEL_TEXT[lane]}
                    count={count}
                  />
                </div>
              );
            })}

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
                  className="absolute"
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

        {/* Bottom-centre legend — outside the scaled canvas so type stays crisp. */}
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
          <p className="text-[11px] italic text-mute">
            Closer to you means closer fit · Direction means kind of move
          </p>
        </div>
      </div>

      <CardPreviewSheet
        card={previewCard}
        open={previewCard !== null}
        onOpenChange={(o) => !o && setPreviewCard(null)}
      />
    </div>
  );
}

export function DiscoverCanvas() {
  return (
    <Authenticated>
      <DiscoverCanvasInner />
    </Authenticated>
  );
}
