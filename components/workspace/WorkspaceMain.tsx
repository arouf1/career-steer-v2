"use client";

import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function WorkspaceMain({ children }: { children: React.ReactNode }) {
  const { state } = useSidebar();
  // The rounded-tl seam only reads against the sidebar+topbar L-shape when
  // expanded. Once collapsed, the topbar is hidden and the rounded corner
  // would curve against nothing, so drop it for a flat top edge.
  return (
    <main
      className={cn(
        "flex-1 overflow-hidden bg-paper",
        state === "expanded" && "md:rounded-tl-xl",
      )}
    >
      {children}
    </main>
  );
}
