"use client";
import Link from "next/link";
import { ShipWheel } from "lucide-react";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import {
  ClerkLoaded,
  ClerkLoading,
  SignOutButton,
  UserButton,
} from "@clerk/nextjs";

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
        <SignOutButton>
          <button className="type-label rounded-pill h-8 px-3 text-ink hover:text-ink-deep">
            Sign out
          </button>
        </SignOutButton>
        {/* Deferred mount: Clerk renders nothing on the server and injects a
            div on hydration, which causes a mismatch warning when SSR'd
            directly. ClerkLoading reserves the same 32px slot to avoid layout
            shift while the client-side instance comes online. */}
        <ClerkLoading>
          <div className="size-8 shrink-0" aria-hidden="true" />
        </ClerkLoading>
        <ClerkLoaded>
          <UserButton />
        </ClerkLoaded>
      </div>
    </header>
  );
}
