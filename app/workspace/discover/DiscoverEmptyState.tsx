// app/workspace/discover/DiscoverEmptyState.tsx
"use client";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

/**
 * Loading state that previews the live canvas: pulsing avatar at centre,
 * radial rings rippling outward like a sonar pulse, and skeleton cards
 * flashing in the four quadrants. When the snapshot lands, the parent
 * crossfades to the real canvas.
 */
export function DiscoverGenerating() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      {/* Quadrant tints — matches the live canvas exactly so the loader's
          geometry is the canvas's geometry. */}
      <div className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2">
        <div className="bg-[oklch(0.985_0.008_70)]" />
        <div className="bg-[oklch(0.98_0.005_220)]" />
        <div className="bg-[oklch(0.978_0.007_120)]" />
        <div className="bg-[oklch(0.978_0.008_290)]" />
      </div>

      {/* Skeleton cards — distributed across all four quadrants at fixed
          positions, each fading in/out with its own staggered timing. */}
      {SKELETON_CARDS.map((s, i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute h-[58px] w-[180px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-hairline bg-paper-raised"
          style={{ left: `${s.left}%`, top: `${s.top}%` }}
          animate={{ opacity: [0, 0.7, 0.7, 0] }}
          transition={{
            duration: 2.4,
            times: [0, 0.25, 0.75, 1],
            delay: s.delay,
            repeat: Infinity,
            repeatDelay: 0.4,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Rippling rings — three SVG circles that scale outward and fade,
          staggered to read as a continuous pulse. The container sits at
          the canvas centre. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2">
        <svg
          width={1}
          height={1}
          viewBox="-1 -1 2 2"
          style={{ overflow: "visible" }}
          aria-hidden
        >
          {[0, 1, 2].map((i) => (
            <motion.circle
              key={i}
              cx={0}
              cy={0}
              r={50}
              fill="none"
              stroke="oklch(0.25 0.015 30)"
              strokeWidth={1}
              initial={{ scale: 0.4, opacity: 0.55 }}
              animate={{ scale: [0.4, 8, 8], opacity: [0.55, 0, 0] }}
              transition={{
                duration: 2.6,
                times: [0, 0.7, 1],
                delay: i * 0.7,
                repeat: Infinity,
                ease: "easeOut",
              }}
              style={{ transformOrigin: "center" }}
            />
          ))}
        </svg>
      </div>

      {/* Pulsing avatar at canvas centre */}
      <motion.div
        className="absolute left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
        animate={{ scale: [1, 1.06, 1], opacity: [0.92, 1, 0.92] }}
        transition={{
          duration: 1.8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Subtitle — editorial, italic, anchored bottom-centre */}
      <p className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm italic text-mute">
        Reading your profile · Mapping your canvas
      </p>
    </div>
  );
}

// Skeleton card positions across the four quadrants, in viewport % coords
// (matching the lane label positioning convention). Spread is intentional —
// 3 cards per quadrant with varied positions to give the loader life.
const SKELETON_CARDS = [
  // Top-left (Next steps)
  { left: 18, top: 18, delay: 0.0 },
  { left: 32, top: 32, delay: 0.6 },
  { left: 14, top: 38, delay: 1.2 },

  // Top-right (Sideways)
  { left: 78, top: 18, delay: 0.3 },
  { left: 88, top: 32, delay: 0.9 },
  { left: 70, top: 40, delay: 1.5 },

  // Bottom-left (Earlier)
  { left: 18, top: 72, delay: 0.2 },
  { left: 32, top: 82, delay: 0.8 },
  { left: 12, top: 60, delay: 1.4 },

  // Bottom-right (Different)
  { left: 78, top: 70, delay: 0.5 },
  { left: 88, top: 82, delay: 1.1 },
  { left: 68, top: 62, delay: 1.7 },
] as const;

export function DiscoverFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-medium text-ink">
        We couldn&apos;t build your canvas
      </h2>
      <p className="max-w-sm text-sm text-ink/60">
        Something went wrong while matching you to guides. Try again. If it
        keeps failing, head to your profile and make sure it&apos;s complete.
      </p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}
