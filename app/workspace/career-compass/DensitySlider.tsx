// app/workspace/career-compass/DensitySlider.tsx
"use client";
import { Slider } from "@/components/ui/slider";

export const DENSITY_STOPS = [18, 36, 60] as const;
export type Density = (typeof DENSITY_STOPS)[number];

export const DENSITY_STORAGE_KEY = "discover.density";

export type DensityLevel = "focused" | "explore" | "wide";

const STOP_LABELS: Record<Density, string> = {
  18: "Focused",
  36: "Explore",
  60: "Wide",
};

export const DENSITY_LEVEL_TO_VALUE: Record<DensityLevel, Density> = {
  focused: 18,
  explore: 36,
  wide: 60,
};

export const DENSITY_VALUE_TO_LEVEL: Record<Density, DensityLevel> = {
  18: "focused",
  36: "explore",
  60: "wide",
};

/**
 * Controlled, the parent owns density state (and persistence), the slider
 * is purely presentational. Lets voice and pointer share one source of
 * truth: when voice flips density, the slider visual follows and vice
 * versa.
 */
export function DensitySlider({
  value,
  onChange,
}: {
  value: Density;
  onChange: (density: Density) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] font-medium text-mute">
          Density
        </span>
        <span className="text-sm font-medium text-ink">
          {STOP_LABELS[value]}
        </span>
      </div>
      <Slider
        min={0}
        max={DENSITY_STOPS.length - 1}
        step={1}
        value={[DENSITY_STOPS.indexOf(value)]}
        onValueChange={([idx]) => {
          onChange(DENSITY_STOPS[idx] as Density);
        }}
        className="w-full"
      />
      <div className="flex justify-between text-[10px] text-mute">
        <span>{STOP_LABELS[18]}</span>
        <span>{STOP_LABELS[36]}</span>
        <span>{STOP_LABELS[60]}</span>
      </div>
    </div>
  );
}
