// app/workspace/discover/CanvasNodes.tsx
"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";

const HIDDEN_HANDLE_STYLE = {
  background: "transparent", border: "none", width: 1, height: 1,
} as const;

export type GuideCardData = {
  guideId: string;
  title: string;
  slotKind: "strong" | "bridge" | "aspirational" | "extra";
  arcScore: number;
  whyMatchReason: string;
  reaction?: "saved" | "dismissed";
  onClick: (guideId: string) => void;
};

export type UserNodeData = {
  initials: string;
  currentRoleChip?: string;
  onClick: () => void;
};

export type LaneLabelData = {
  kind: "linear" | "adjacent" | "earlier" | "transformational";
  label: string;
  count: number;
};

const SLOT_BADGE_LABEL: Record<GuideCardData["slotKind"], string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "More",
};

export function GuideCardNode({ data }: NodeProps) {
  const d = data as unknown as GuideCardData;
  const isSaved = d.reaction === "saved";
  return (
    <>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE_STYLE} />
      <button
        type="button"
        data-testid="guide-card"
        onClick={() => d.onClick(d.guideId)}
        className={cn(
          "group relative flex w-[200px] flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-all",
          "hover:z-10 hover:border-ink-deep hover:shadow-md focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          isSaved
            ? "border-hairline-strong bg-paper-raised"
            : "border-hairline bg-white",
          d.slotKind === "extra" && "opacity-90",
        )}
      >
        {isSaved && (
          <Bookmark className="absolute right-2.5 top-2.5 size-3.5 fill-ink text-ink" />
        )}
        {/* Eyebrow — collapsed at rest, fades in on hover/focus. */}
        <span className="max-h-0 overflow-hidden text-[11px] italic text-mute opacity-0 transition-all duration-200 group-hover:max-h-6 group-hover:opacity-100 group-focus-visible:max-h-6 group-focus-visible:opacity-100">
          {SLOT_BADGE_LABEL[d.slotKind]}
        </span>
        {/* Title — always visible. */}
        <div className="line-clamp-2 text-sm font-medium leading-tight text-ink">
          {d.title}
        </div>
        {/* Why-match — collapsed at rest, expands on hover/focus. */}
        <div className="line-clamp-2 max-h-0 overflow-hidden text-xs italic text-ink-soft opacity-0 transition-all duration-200 group-hover:max-h-12 group-hover:opacity-100 group-focus-visible:max-h-12 group-focus-visible:opacity-100">
          {d.whyMatchReason}
        </div>
      </button>
    </>
  );
}

export function UserNodeView({ data }: NodeProps) {
  const d = data as unknown as UserNodeData;
  return (
    <button
      type="button"
      onClick={d.onClick}
      className="flex flex-col items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
    >
      <div className="flex size-20 items-center justify-center rounded-full bg-ink text-paper text-2xl font-medium ring-4 ring-paper">
        <span>{d.initials}</span>
      </div>
      {d.currentRoleChip && (
        <span className="rounded-pill border border-hairline bg-paper px-2.5 py-0.5 text-[11px] font-medium text-ink">
          {d.currentRoleChip}
        </span>
      )}
    </button>
  );
}

export function LaneLabelNode({ data }: NodeProps) {
  const d = data as unknown as LaneLabelData;
  return (
    // Sit at the geometric center of the quadrant. Cards render above on
    // hover via React Flow's z-stacking + the GuideCardNode's `hover:z-10`.
    // `pointer-events-none` keeps clicks falling through to the cards beneath.
    <div
      style={{ zIndex: 0 }}
      className="pointer-events-none flex flex-col items-center gap-1 whitespace-nowrap"
    >
      <span className="font-medium uppercase tracking-[0.2em] text-base text-ink/85">
        {d.label}
      </span>
      <span className="text-[11px] text-mute">
        {d.count} {d.count === 1 ? "guide" : "guides"}
      </span>
    </div>
  );
}

// Invisible 1px anchor used to stake out the canvas extent symmetrically
// around (0, 0). Without four of these in the corners, React Flow's fitView
// centers the bounding box of whatever cards exist — empty quadrants pull
// the user node off-center. These nodes are non-interactive and visually
// imperceptible.
export function AnchorNode() {
  return <div className="size-px" aria-hidden />;
}

export function RingsNode() {
  // 3 concentric hairlines at the user's centre. The SVG sits at the React
  // Flow node's (0,0) anchor and overflows visibly outward in every direction.
  // Each ring sits at a distance roughly aligned to the slot tiers:
  //   inner (250) ≈ strong-fit cluster radius
  //   mid (430)   ≈ bridge tier
  //   outer (610) ≈ aspirational tier (just inside the outer card edge)
  // Stroke is barely-visible cream — like graph paper. The effect is editorial,
  // not chart-y.
  return (
    <div
      className="pointer-events-none"
      style={{ position: "relative", width: 0, height: 0, overflow: "visible" }}
      aria-hidden
    >
      <svg
        width={1400}
        height={1400}
        viewBox="-700 -700 1400 1400"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          overflow: "visible",
        }}
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
    </div>
  );
}
