"use client";

import { ArrowRight, PanelLeft } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Inline editorial callout that prompts the user to open the workspace
 * sidebar when it's collapsed. Renders as a sibling above the profile
 * masthead — NOT as a fixed-position overlay (the previous treatment
 * collided visually with the system sidebar-collapse toggle in the
 * top-left of the workspace inset). Self-hides when the sidebar is
 * open, on mobile, or in any other state where the affordance would
 * be redundant.
 */
export function GetStartedSidebarPill() {
  const { state, setOpen, isMobile } = useSidebar();

  // Mobile sidebar has its own toggle in the header — the pill adds no value
  // and would overlap the mobile layout.
  if (isMobile) return null;

  // Sidebar already open — nothing to offer.
  if (state === "expanded") return null;

  return (
    <div className="mb-8">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-3 rounded-pill border border-hairline bg-paper-raised py-2 pl-3 pr-4 text-[13px] font-medium text-ink transition-colors hover:bg-paper hover:border-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
      >
        <span
          aria-hidden
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-paper"
        >
          <PanelLeft className="h-3 w-3" strokeWidth={2} />
        </span>
        <span>Open the menu to get started</span>
        <ArrowRight
          className="h-3.5 w-3.5 text-mute transition-transform group-hover:translate-x-0.5"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
    </div>
  );
}
