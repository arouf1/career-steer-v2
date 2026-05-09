import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Standard chrome for every workspace surface. Owns max-width, horizontal
// padding, and vertical rhythm so /jobs, /saved-guides, /conversations and
// /profile read as the same product instead of four separately-built
// screens. Tuned to match the saved-guides register (max-w-6xl, generous
// horizontal padding, calm vertical rhythm).
//
// Career Compass is a deliberate exception — it's a full-bleed canvas and
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
        "mx-auto w-full max-w-6xl px-6 py-8 sm:px-8 sm:py-10",
        className,
      )}
    >
      {children}
    </div>
  );
}
