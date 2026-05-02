// app/workspace/discover/DensitySlider.tsx
"use client";
import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";

const STORAGE_KEY = "discover.density";
const STOPS = [18, 36, 60] as const;
export type Density = (typeof STOPS)[number];

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
    <div className="flex flex-col gap-1 rounded-md border border-hairline bg-paper/95 p-3 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-ink/60">
        <span>Density</span>
        <span className="font-medium">{value}</span>
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
        className="w-32"
      />
      <div className="flex justify-between text-[9px] text-ink/40">
        <span>18</span><span>36</span><span>60</span>
      </div>
    </div>
  );
}
