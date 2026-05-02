// app/workspace/discover/CanvasNodes.tsx
"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bookmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  currentRoleChip: string;
  onClick: () => void;
};

export type LaneLabelData = {
  kind: "linear" | "adjacent" | "transformational";
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
        onClick={() => d.onClick(d.guideId)}
        className={cn(
          "group flex w-[200px] flex-col gap-1.5 rounded-lg border bg-background px-3 py-2.5 text-left shadow-sm transition-all",
          "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
          isSaved && "border-amber-400 bg-gradient-to-br from-amber-50 to-background",
          d.slotKind === "extra" && "opacity-90",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary" className="type-label text-[10px]">
            {SLOT_BADGE_LABEL[d.slotKind]}
          </Badge>
          {isSaved && <Bookmark className="size-3.5 fill-amber-500 text-amber-500" />}
        </div>
        <div className="line-clamp-2 text-sm font-medium leading-tight text-ink">
          {d.title}
        </div>
        <div className="line-clamp-2 text-xs italic text-ink/60">
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
      className="flex flex-col items-center gap-2 focus-visible:outline-none"
    >
      <div className="flex size-20 items-center justify-center rounded-full bg-ink text-paper text-2xl font-medium shadow-md ring-4 ring-paper">
        <span>{d.initials}</span>
      </div>
      <span className="rounded-pill border border-hairline bg-paper px-2.5 py-0.5 text-[11px] font-medium text-ink">
        {d.currentRoleChip}
      </span>
    </button>
  );
}

export function LaneLabelNode({ data }: NodeProps) {
  const d = data as unknown as LaneLabelData;
  return (
    <div className="pointer-events-none flex items-center gap-2 whitespace-nowrap">
      <span className="type-label text-[11px] tracking-wider text-ink/60">
        {d.label.toUpperCase()}
      </span>
      <span className="type-label text-[11px] text-ink/40">· {d.count}</span>
    </div>
  );
}
