"use client";
import Link from "next/link";
import { ShipWheel } from "lucide-react";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { UserPopover } from "@/components/auth/UserPopover";

export function WorkspaceTopBar() {
  const { state } = useSidebar();
  // When the sidebar is collapsed to icon mode, hide the topbar entirely.
  // The collapsed sidebar carries its own SidebarTrigger so the nav stays
  // reachable, and the rounded-tl seam still works against the sidebar.
  if (state === "collapsed") return null;

  return (
    <header className="grid h-14 grid-cols-[1fr_auto_1fr] items-center px-4">
      <div className="justify-self-start">
        <SidebarTrigger />
      </div>
      <Link
        href="/"
        className="flex items-center gap-2 justify-self-center"
      >
        <ShipWheel className="size-5 text-ink" />
        <span className="font-logo text-lg font-medium text-ink">
          Career Steer
        </span>
      </Link>
      <div className="flex items-center gap-3 justify-self-end">
        <UserPopover />
      </div>
    </header>
  );
}
