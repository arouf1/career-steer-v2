"use client";

import Link from "next/link";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import {
  SignInButton,
  SignOutButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";

export function SiteNav() {
  return (
    <header className="border-b border-hairline">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-6 px-6">
        <Link
          href="/"
          className="font-serif text-2xl italic text-ink leading-none rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          Career Steer
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/career-guides"
            className="type-label hidden sm:inline-flex rounded-pill px-4 py-2 text-body transition-colors hover:text-ink"
          >
            Career guides
          </Link>
          <Link
            href="/profile"
            className="type-label hidden sm:inline-flex rounded-pill px-4 py-2 text-body transition-colors hover:text-ink"
          >
            Profile
          </Link>

          <span
            className="hidden h-6 w-px bg-hairline mx-2 sm:inline-block"
            aria-hidden="true"
          />

          <AuthLoading>
            <span className="type-caption text-mute px-3">Loading…</span>
          </AuthLoading>

          <Unauthenticated>
            <SignInButton
              mode="modal"
              fallbackRedirectUrl="/profile"
              signUpFallbackRedirectUrl="/profile"
            >
              <button
                type="button"
                className="type-label rounded-pill px-4 py-2 text-ink transition-colors hover:text-ink-deep"
              >
                Sign In
              </button>
            </SignInButton>
            <SignUpButton
              mode="modal"
              fallbackRedirectUrl="/profile"
              signInFallbackRedirectUrl="/profile"
            >
              <button
                type="button"
                className="type-label rounded-pill bg-ink px-5 py-2.5 text-paper transition-colors hover:bg-ink-deep"
              >
                Sign Up
              </button>
            </SignUpButton>
          </Unauthenticated>

          <Authenticated>
            <SignOutButton>
              <button
                type="button"
                className="type-label rounded-pill px-4 py-2 text-ink transition-colors hover:text-ink-deep"
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
