// app/workspace/career-compass/DensitySlider.tsx
"use client";
import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";

const STORAGE_KEY = "discover.density";
const STOPS = [18, 36, 60] as const;
export type Density = (typeof STOPS)[number];

const STOP_LABELS: Record<Density, string> = {
  18: "Focused",
  36: "Explore",
  60: "Wide",
};

export function DensitySlider({
  onChange,
}: {
  onChange: (density: Density) => void;
}) {
  const [value, setValue] = useState<Density>(18);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (STOPS.includes(n as Density)) {
        setValue(n as Density);
        onChange(n as Density);
      }
    }
  }, [onChange]);

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
        max={STOPS.length - 1}
        step={1}
        value={[STOPS.indexOf(value)]}
        onValueChange={([idx]) => {
          const next = STOPS[idx] as Density;
          setValue(next);
          localStorage.setItem(STORAGE_KEY, String(next));
          onChange(next);
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
