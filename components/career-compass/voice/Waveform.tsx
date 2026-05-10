"use client";

import { useEffect, useRef } from "react";

type Props = {
  /** AnalyserNode wired to the mic. Null while idle. */
  analyser: AnalyserNode | null;
  /** Whether the waveform should animate from real audio or sit at rest. */
  active: boolean;
  /** Pixel height of the waveform area. Bars centre vertically inside it. */
  height?: number;
  /** Bar width in CSS pixels. */
  barWidth?: number;
  /** Gap between bars in CSS pixels. */
  barGap?: number;
  /** Multiplier on raw frequency [0,1] before clamping; >1 boosts soft input. */
  sensitivity?: number;
  /**
   * Bar color theme.
   *  - "dark" (default): bars rendered with --color-ink, for use on light
   *    surfaces (bg-paper).
   *  - "light": bars rendered with --color-paper, for use on dark surfaces
   *    (bg-ink), e.g. the active compass dock.
   */
  tone?: "dark" | "light";
  className?: string;
};

/**
 * Canvas-rendered frequency-bar visualiser ported from V1's
 * MicrophoneWaveform. Reads bytes from an AnalyserNode the consumer wired
 * to the mic source, mirrors them around the centre for a symmetric pattern,
 * and draws rounded bars that fade out at the edges.
 *
 * The component does NOT own the AudioContext or AnalyserNode, the
 * CompassVoiceDock attaches an analyser to the existing PCMCaptureHandle's
 * sourceNode and passes it down here. That keeps the audio graph single-
 * source and lets the waveform stay purely presentational.
 */
export function Waveform({
  analyser,
  active,
  height = 40,
  barWidth = 2,
  barGap = 1,
  sensitivity = 0.6,
  tone = "dark",
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const idleAnimTimeRef = useRef(0);

  // Resize observer keeps the canvas's backing store in sync with its CSS
  // box at the current device pixel ratio. Without this the bars would
  // appear blurry on retina screens.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Read the right design-token colour for the tone we're rendering on.
    // "dark" tone (bars on a paper-coloured surface) reads --color-ink;
    // "light" tone (bars on an ink-coloured surface) reads --color-paper.
    const root = getComputedStyle(document.documentElement);
    const tokenName = tone === "light" ? "--color-paper" : "--color-ink";
    const fallback = tone === "light" ? "#fdf8f1" : "#1a1a1a";
    const tokenValue = root.getPropertyValue(tokenName).trim();
    const fillColor = tokenValue.length > 0 ? tokenValue : fallback;

    const buffer = analyser
      ? new Uint8Array(analyser.frequencyBinCount)
      : null;

    const render = () => {
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const totalBars = Math.max(1, Math.floor(w / (barWidth + barGap)));
      const centreY = h / 2;

      // Compute per-bar amplitude, either real frequency data + a soft
      // procedural underbreath when the user is silent, or pure procedural
      // when active is false.
      let amplitudes: number[];
      idleAnimTimeRef.current += 0.04;
      const t = idleAnimTimeRef.current;
      const breath = (i: number, base: number): number => {
        const phase = (i / totalBars) * Math.PI * 2;
        const a = Math.sin(phase * 1.3 + t) * 0.08;
        const b = Math.sin(phase * 0.7 - t * 0.7) * 0.05;
        return Math.max(0, base + a + b);
      };

      if (active && analyser && buffer) {
        analyser.getByteFrequencyData(buffer);
        // Use only the lower 5%-40% of the FFT bins, that's where speech
        // energy concentrates. Mirror the left half across the centre for
        // a symmetric pattern.
        const start = Math.floor(buffer.length * 0.05);
        const end = Math.floor(buffer.length * 0.4);
        const usable = buffer.slice(start, end);
        const half = Math.ceil(totalBars / 2);
        amplitudes = new Array<number>(totalBars);
        for (let i = 0; i < half; i++) {
          const idx = Math.floor((i / half) * usable.length);
          const v = (usable[idx] ?? 0) / 255;
          const scaled = Math.min(1, v * sensitivity * 2);
          amplitudes[half - 1 - i] = scaled;
          amplitudes[totalBars - half + i] = scaled;
        }
        // Floor each bar to a breathing baseline so silent moments still
        // read as "the call is live, mic is open" instead of a near-flat
        // dotted line.
        for (let i = 0; i < totalBars; i++) {
          amplitudes[i] = Math.max(amplitudes[i] ?? 0, breath(i, 0.18));
        }
      } else {
        // Idle / pre-call resting animation, gentler baseline.
        amplitudes = Array.from({ length: totalBars }, (_, i) =>
          breath(i, 0.1),
        );
      }

      // Draw bars, fading the edges for a softer envelope.
      ctx.fillStyle = fillColor;
      const maxBarHeight = h * 0.8;
      // Min bar height at silence, large enough to read clearly on a 28px
      // dock without dominating when the user actually starts speaking.
      const MIN_BAR_HEIGHT = 5;
      for (let i = 0; i < totalBars; i++) {
        const x = i * (barWidth + barGap);
        const amp = amplitudes[i] ?? 0;
        const barH = Math.max(MIN_BAR_HEIGHT, amp * maxBarHeight);
        // Linear fade from edges → centre → edges so the strip looks like a
        // breath instead of a hard rectangle. Less aggressive than before so
        // the edge bars stay legible against the dock background.
        const distanceFromCentre = Math.abs(i - totalBars / 2) / (totalBars / 2);
        const edgeFade = 1 - Math.pow(distanceFromCentre, 1.4) * 0.4;
        // Minimum alpha 0.6 so even silent bars on the dark dock have
        // genuine visual weight; speaking bars hit full opacity.
        ctx.globalAlpha = Math.max(0.6, Math.min(1, amp * 1.4 + 0.6)) * edgeFade;
        const y = centreY - barH / 2;
        if (typeof ctx.roundRect === "function") {
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barH, barWidth / 2);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, barWidth, barH);
        }
      }
      ctx.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [analyser, active, barWidth, barGap, sensitivity, tone]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height, width: "100%", pointerEvents: "none" }}
      aria-hidden
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
