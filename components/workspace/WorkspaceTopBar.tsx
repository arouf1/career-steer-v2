"use client";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserButton, SignOutButton } from "@clerk/nextjs";

export function WorkspaceTopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-hairline px-4">
      <SidebarTrigger />
      <div className="flex items-center gap-3">
        <SignOutButton>
          <button className="type-label rounded-pill h-8 px-3 text-ink hover:text-ink-deep">
            Sign out
          </button>
        </SignOutButton>
        <UserButton />
      </div>
    </header>
  );
}
