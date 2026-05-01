"use client";

import { useEffect, useRef } from "react";
import {
  BrainIcon,
  type BrainIconHandle,
} from "@/components/icons/animated-brain";

type Props = {
  size?: number;
  className?: string;
};

/**
 * BrainIcon driven on a loop. Unlike LoopingFeather, the brain's variants
 * already include `repeat: Infinity` with `repeatType: "mirror"`, so we only
 * need to start the animation once and Motion handles the rest.
 */
export function LoopingBrain({ size = 12, className }: Props) {
  const ref = useRef<BrainIconHandle | null>(null);

  useEffect(() => {
    ref.current?.startAnimation();
  }, []);

  return <BrainIcon ref={ref} size={size} className={className} />;
}
