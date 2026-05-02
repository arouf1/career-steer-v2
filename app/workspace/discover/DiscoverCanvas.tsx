// app/workspace/discover/DiscoverCanvas.tsx
"use client";
import { useMemo, useState, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
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
  linear: "Linear · Next steps",
  adjacent: "Adjacent · Lateral moves",
  transformational: "Transformational · New directions",
} as const;

const LANE_LABEL_POSITION = {
  // Outer-edge label positions, ~MAX_RADIUS + 24 along each wedge centre.
  // Wedge centres in screen coords (Y down): linear=top (270°),
  // adjacent=lower-right (30°), transformational=lower-left (150°).
  linear: { angleDeg: 270, offset: MAX_RADIUS + 24 },
  adjacent: { angleDeg: 30, offset: MAX_RADIUS + 24 },
  transformational: { angleDeg: 150, offset: MAX_RADIUS + 24 },
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

  // Subscribe to primitive initials, not the whole `user` object — Clerk's
  // user reference changes on unrelated session ticks and would invalidate
  // the `nodes` memo unnecessarily.
  const initials =
    (user?.firstName?.[0] ?? "Y") + (user?.lastName?.[0] ?? "ou");

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
        currentRoleChip: "You", // TODO: pull current role from profile via a query in a follow-up
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
  }, [snapshot, density, reactionByGuide, initials]);

  const handleRefresh = useCallback(() => {
    void manualRefresh({});
  }, [manualRefresh]);

  if (snapshot === undefined) return <DiscoverGenerating />;
  if (snapshot === null || snapshot.status === "generating")
    return <DiscoverGenerating />;
  if (snapshot.status === "failed")
    return <DiscoverFailed onRetry={handleRefresh} />;

  return (
    <div className="relative h-full w-full bg-paper">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.5}
        maxZoom={1.6}
        nodesDraggable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="var(--color-hairline)" />
        <Controls showInteractive={false} showFitView />
        <Panel position="top-right" className="!m-3 flex gap-2">
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
    <ReactFlowProvider>
      <DiscoverCanvasInner />
    </ReactFlowProvider>
  );
}
