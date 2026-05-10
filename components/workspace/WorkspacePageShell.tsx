import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Standard chrome for every workspace surface. Owns max-width, horizontal
// padding, and vertical rhythm so /jobs, /saved-guides, /conversations and
// /profile read as the same product instead of four separately-built
// screens. Tuned to match the saved-guides register (max-w-6xl, generous
// horizontal padding, calm vertical rhythm).
//
// Padding tokens:
//   mobile (default): px-6 py-8
//   sm (≥640):        px-10 py-10
//   lg (≥1024):       px-14 py-12
// Bigger screens get noticeably more breathing room, calm + generous
// whitespace per PRODUCT.md is non-negotiable, and on wide monitors the
// older px-8 sat too tight against the workspace chrome.
//
// Career Compass is a deliberate exception, it's a full-bleed canvas and
// does NOT use this shell.
export function WorkspacePageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-6xl px-6 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12",
        className,
      )}
    >
      {children}
    </div>
  );
}
