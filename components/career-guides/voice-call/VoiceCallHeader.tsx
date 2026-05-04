"use client";

type Props = {
  guideTitle: string;
  duration: number;
  formatDuration: (seconds: number) => string;
};

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.22em] font-medium text-mute";

/**
 * Modal header — eyebrow, talking-through-X title, then a quiet timer line.
 * Matches V1's centred header but uses V2 design tokens.
 */
export function VoiceCallHeader({ guideTitle, duration, formatDuration }: Props) {
  return (
    <div className="space-y-2 text-center">
      <p className={eyebrowCls}>Deep dive</p>
      <h2
        className="line-clamp-2 px-4 text-xl leading-snug tracking-tight text-ink [font-family:var(--font-serif)] sm:text-2xl"
        title={`Talking through ${guideTitle}`}
      >
        Talking through{" "}
        <span className="text-ink/60">{guideTitle}</span>
      </h2>
      <div className="flex items-center justify-center gap-2 text-[13px] text-mute">
        <span className="font-medium tabular-nums">
          {formatDuration(duration)}
        </span>
      </div>
    </div>
  );
}
