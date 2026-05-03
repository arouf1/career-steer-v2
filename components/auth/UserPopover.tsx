"use client";

import { useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { LogOut, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

function getInitials(
  first?: string | null,
  last?: string | null,
  email?: string | null,
): string {
  const f = (first ?? "").trim().charAt(0);
  const l = (last ?? "").trim().charAt(0);
  const initials = (f + l).toUpperCase();
  if (initials) return initials;
  return (email ?? "").trim().charAt(0).toUpperCase();
}

export function UserPopover() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);

  // Reserve the trigger's footprint so the topbar doesn't shift while Clerk
  // hydrates on the client.
  if (!isLoaded || !user) {
    return <div className="size-8 shrink-0" aria-hidden="true" />;
  }

  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const displayName =
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    email ||
    "Account";
  const initials = getInitials(user.firstName, user.lastName, email);
  const imageUrl = user.imageUrl;

  const handleSignOut = () => {
    setOpen(false);
    void signOut();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <Avatar className="size-8">
            <AvatarImage src={imageUrl} alt={displayName} />
            <AvatarFallback className="bg-ink text-paper text-xs">
              {initials || <User className="size-4" />}
            </AvatarFallback>
          </Avatar>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 border-hairline p-0"
      >
        <div className="flex items-center gap-3 p-4">
          <Avatar className="size-10">
            <AvatarImage src={imageUrl} alt={displayName} />
            <AvatarFallback className="bg-ink text-paper">
              {initials || <User className="size-4" />}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {displayName}
            </p>
            {email && (
              <p className="truncate text-xs text-body">{email}</p>
            )}
          </div>
        </div>

        <Separator className="bg-hairline" />

        <div className="p-1">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-hairline/40"
          >
            <LogOut className="size-4 text-body" />
            Sign out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
