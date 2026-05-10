"use client";

import { useEffect, useRef } from "react";
import {
  FeatherIcon,
  type FeatherIconHandle,
} from "@/components/icons/animated-feather";

type Props = {
  size?: number;
  className?: string;
  /** Milliseconds between animation cycles. Animation itself is ~1.6s. */
  intervalMs?: number;
};

/**
 * FeatherIcon driven on a loop via its imperative handle. The icon's
 * animate variant ends at rest (rotate/x/y all return to 0), so restarting
 * mid-cycle would be jarring, we wait the full 2s breathing window before
 * triggering the next cycle.
 */
export function LoopingFeather({
  size = 14,
  className,
  intervalMs = 2000,
}: Props) {
  const ref = useRef<FeatherIconHandle | null>(null);

  useEffect(() => {
    const tick = () => ref.current?.startAnimation();
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return <FeatherIcon ref={ref} size={size} className={className} />;
}
