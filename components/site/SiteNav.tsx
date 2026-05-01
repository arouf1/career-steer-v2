"use client";

import Link from "next/link";
import { Authenticated, Unauthenticated } from "convex/react";
import { SignOutButton, UserButton } from "@clerk/nextjs";

const navLink =
  "type-label hidden sm:inline-flex items-center rounded-pill h-8 px-3 text-body transition-colors hover:text-ink";

export function SiteNav() {
  return (
    <header className="border-b border-hairline">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <Link
          href="/"
          className="font-logo text-2xl font-medium text-ink leading-none rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          Career Steer
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/career-guides" className={navLink}>
            Career guides
          </Link>

          <Authenticated>
            <Link href="/profile" className={navLink}>
              Profile
            </Link>
          </Authenticated>

          <span
            className="hidden h-5 w-px bg-hairline mx-2 sm:inline-block"
            aria-hidden="true"
          />

          <Unauthenticated>
            <Link
              href="/sign-in"
              className="type-label inline-flex items-center rounded-pill h-8 px-4 text-ink transition-colors hover:text-ink-deep"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="type-label inline-flex items-center rounded-pill h-8 px-4 bg-ink text-paper transition-colors hover:bg-ink-deep"
            >
              Sign Up
            </Link>
          </Unauthenticated>

          <Authenticated>
            <SignOutButton>
              <button
                type="button"
                className="type-label inline-flex items-center rounded-pill h-8 px-4 text-ink transition-colors hover:text-ink-deep"
              >
                Sign out
              </button>
            </SignOutButton>
            <UserButton />
          </Authenticated>
        </nav>
      </div>
    </header>
  );
}
