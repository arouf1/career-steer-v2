// app/workspace/discover/DiscoverCanvas.tsx
"use client";
import { useMemo, useState, useCallback, useEffect } from "react";
import { Authenticated, useQuery, useMutation } from "convex/react";
import { useUser } from "@clerk/nextjs";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Panel,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { GuideCardNode, UserNodeView, LaneLabelNode } from "./CanvasNodes";
import { CardPreviewSheet, type CardPreviewData } from "./CardPreviewSheet";
import { DensitySlider, type Density } from "./DensitySlider";
import { DiscoverGenerating, DiscoverFailed } from "./DiscoverEmptyState";
import { positionCard, MAX_RADIUS } from "./lib/positionCard";

const nodeTypes = {
  guide: GuideCardNode,
  user: UserNodeView,
  laneLabel: LaneLabelNode,
};

const LANE_LABEL_TEXT = {
  linear: "Next steps",
  adjacent: "Sideways moves",
  earlier: "Earlier chapters",
  transformational: "A different chapter",
} as const;

const LANE_LABEL_POSITION = {
  // Outer-edge label positions, ~MAX_RADIUS + 24 along each wedge centre.
  // 4-wedge cardinal-compass layout (matches `positionCard` WEDGE).
  // Screen coords (Y down):
  //   linear            top    (270°)
  //   adjacent          right    (0°)
  //   earlier           bottom  (90°)
  //   transformational  left   (180°)
  linear: { angleDeg: 270, offset: MAX_RADIUS + 24 },
  adjacent: { angleDeg: 0, offset: MAX_RADIUS + 24 },
  earlier: { angleDeg: 90, offset: MAX_RADIUS + 24 },
  transformational: { angleDeg: 180, offset: MAX_RADIUS + 24 },
};

function laneLabelPos(lane: keyof typeof LANE_LABEL_POSITION) {
  const p = LANE_LABEL_POSITION[lane];
  const rad = (p.angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad) * p.offset, y: Math.sin(rad) * p.offset };
}

function DiscoverCanvasInner() {
  const { user } = useUser();
  const snapshot = useQuery(api.discover.getSnapshot);
  // Don't `?? []` here: a fresh `[]` literal would change reference every
  // render and bust the `reactionByGuide` memo. Handle the null case below.
  const reactions = useQuery(api.discover.querySavedGuides);
  const manualRefresh = useMutation(api.discover.manualRefresh);

  const [density, setDensity] = useState<Density>(18);
  const [previewCard, setPreviewCard] = useState<CardPreviewData | null>(null);

  // Subscribe to primitive initials and fullName, not the whole `user`
  // object — Clerk's user reference changes on unrelated session ticks and
  // would invalidate the `nodes` memo unnecessarily.
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

  const { nodes, edges } = useMemo(() => {
    if (!snapshot || snapshot.status !== "ready")
      return { nodes: [] as Node[], edges: [] as Edge[] };

    const perLaneCap = Math.floor(density / 3);
    const cards = snapshot.lanes.flatMap((lane) =>
      lane.cards
        // Curated 6 always present; extras included up to per-lane cap.
        // Index-aware filter avoids the O(n²) `lane.cards.indexOf(c)` lookup.
        .filter((c, i) => c.slotKind !== "extra" || i < perLaneCap)
        .map((c) => ({ ...c, lane: lane.kind })),
    );

    const guideNodes: Node[] = cards.map((c) => ({
      id: `guide:${c.guideId}`,
      type: "guide",
      position: positionCard({
        lane: c.lane,
        slotKind: c.slotKind,
        arcScore: c.arcScore,
        guideId: c.guideId as string,
      }),
      data: {
        ...c,
        reaction: reactionByGuide.get(c.guideId as string),
        onClick: () => setPreviewCard(c as unknown as CardPreviewData),
      },
    }));

    const userNode: Node = {
      id: "user",
      type: "user",
      position: { x: -40, y: -40 }, // approximate centring with the 80px avatar
      data: {
        initials,
        currentRoleChip: fullName ?? undefined,
        onClick: () => {
          /* future: open user popover */
        },
      },
    };

    const labelNodes: Node[] = (
      Object.keys(LANE_LABEL_TEXT) as Array<keyof typeof LANE_LABEL_TEXT>
    ).map((lane) => ({
      id: `label:${lane}`,
      type: "laneLabel",
      position: laneLabelPos(lane),
      data: {
        kind: lane,
        label: LANE_LABEL_TEXT[lane],
        count: snapshot.lanes.find((l) => l.kind === lane)?.cards.length ?? 0,
      },
    }));

    return {
      nodes: [userNode, ...labelNodes, ...guideNodes],
      edges: [] as Edge[],
    };
  }, [snapshot, density, reactionByGuide, initials, fullName]);

  const handleRefresh = useCallback(() => {
    void manualRefresh({});
  }, [manualRefresh]);

  if (snapshot === undefined) return <DiscoverGenerating />;
  if (snapshot === null || snapshot.status === "generating")
    return <DiscoverGenerating />;
  if (snapshot.status === "failed")
    return <DiscoverFailed onRetry={handleRefresh} />;

  return (
    <div className="relative h-full w-full bg-white">
      {/*
        Quadrant tints — barely-visible cream variants, one per canvas
        region. Sit BEHIND React Flow's nodes via DOM order. Chroma stays
        below 0.01 so they read as "tinted neutrals," not color blocks —
        the brand register is editorial cream, not Memphis primary.
      */}
      <div className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2">
        {/* top-left: shared between linear (top) and different (left) — cool neutral */}
        <div className="bg-[oklch(0.98_0.006_220)]" />
        {/* top-right: linear + adjacent — barely-warmer cream */}
        <div className="bg-[oklch(0.985_0.007_70)]" />
        {/* bottom-left: earlier + different — subtle lavender */}
        <div className="bg-[oklch(0.975_0.006_290)]" />
        {/* bottom-right: earlier + adjacent — slightly cooler cream */}
        <div className="bg-[oklch(0.98_0.005_100)]" />
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.5}
        maxZoom={1.6}
        nodesDraggable={false}
        proOptions={{ hideAttribution: true }}
        className="!bg-transparent"
      >
        <Background gap={24} size={1} color="oklch(0.92 0.005 35)" />
        <Controls showInteractive={false} showFitView />
        <Panel position="bottom-center" className="!m-3">
          <p className="text-[11px] italic text-mute">
            Closer to you means closer fit · Direction means kind of move
          </p>
        </Panel>
        <Panel position="top-right" className="!m-3 flex items-stretch gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            aria-label="Rebuild canvas"
            className="flex items-center justify-center rounded-md border border-hairline bg-paper-raised px-3 text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <RefreshCw className="size-4" />
          </button>
          <DensitySlider onChange={setDensity} />
        </Panel>
      </ReactFlow>
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
      <ReactFlowProvider>
        <DiscoverCanvasInner />
      </ReactFlowProvider>
    </Authenticated>
  );
}
