"use client";

import { ChevronRight, PanelLeft } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";

export function GetStartedSidebarPill() {
  const { state, setOpen, isMobile } = useSidebar();

  // Mobile sidebar has its own toggle in the header — the pill adds no value
  // and would overlap the mobile layout.
  if (isMobile) return null;

  // Sidebar already open — nothing to offer.
  if (state === "expanded") return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open sidebar"
      className="fixed left-6 top-6 z-30 inline-flex items-center gap-2 rounded-pill border border-hairline bg-paper px-4 py-2 text-[12px] font-medium text-ink shadow-[0_4px_24px_-12px_rgba(0,0,0,0.15)] transition-colors hover:bg-paper-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
    >
      <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      Get started
      <ChevronRight className="h-3.5 w-3.5 text-mute" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
