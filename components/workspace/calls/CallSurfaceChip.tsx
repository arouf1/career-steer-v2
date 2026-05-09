// components/workspace/calls/CallSurfaceChip.tsx
//
// Small left-bordered pill that identifies which product surface a voice call
// originated from. The left-border accent is the only colour signal — body
// uses ink shades only to stay within the warm-sunset palette.

import { cn } from "@/lib/utils";

type Surface = "guide" | "compass" | "job" | "interview_job";

type Props = {
  surface: Surface | undefined;
  size?: "sm" | "md";
  className?: string;
};

type SurfaceMeta = {
  label: string;
  accent: string; // Tailwind border-l-* class
};

const SURFACE_META: Record<Surface, SurfaceMeta> & { __undefined: SurfaceMeta } = {
  guide:          { label: "Deep dive",      accent: "border-l-ink/40" },
  compass:        { label: "Compass",         accent: "border-l-amber-500/60" },
  job:            { label: "Job deep dive",   accent: "border-l-emerald-500/60" },
  interview_job:  { label: "Mock interview",  accent: "border-l-ink" },
  __undefined:    { label: "Voice call",      accent: "border-l-ink/20" },
};

function getMeta(surface: Surface | undefined): SurfaceMeta {
  if (surface === undefined) return SURFACE_META.__undefined;
  return SURFACE_META[surface] ?? SURFACE_META.__undefined;
}

export function CallSurfaceChip({ surface, size = "md", className }: Props) {
  const meta = getMeta(surface);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border border-hairline border-l-2 bg-paper-raised px-2 py-0.5",
        meta.accent,
        size === "sm" ? "text-[10px]" : "text-[11px]",
        "font-medium text-ink/70 leading-none",
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
