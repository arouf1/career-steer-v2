"use client";

import { SignInButton } from "@clerk/nextjs";
import { Search } from "lucide-react";

type Props = {
  guideTitle: string;
  variant: "anonymous" | "signed-in";
  onSearchLive?: () => void;
  searchLivePending?: boolean;
  signInRedirectUrl: string;
};

export function JobsForGuideEmpty({
  guideTitle,
  variant,
  onSearchLive,
  searchLivePending,
  signInRedirectUrl,
}: Props) {
  return (
    <div className="rounded-card border border-dashed border-hairline-strong bg-paper-raised px-6 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-md space-y-1">
          <p className="type-title text-ink">
            No cached postings for {guideTitle} yet
          </p>
          <p className="type-caption text-mute">
            {variant === "anonymous"
              ? "Sign in and we'll search live for jobs near you."
              : "Search live to pull fresh postings into the cache."}
          </p>
        </div>
        {variant === "anonymous" ? (
          <SignInButton mode="modal" forceRedirectUrl={signInRedirectUrl}>
            <button
              type="button"
              className="type-label inline-flex shrink-0 items-center justify-center rounded-pill bg-ink px-6 py-2.5 text-paper transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              Sign in to search
            </button>
          </SignInButton>
        ) : (
          <button
            type="button"
            onClick={onSearchLive}
            disabled={searchLivePending}
            className="type-label inline-flex shrink-0 items-center justify-center gap-2 rounded-pill bg-ink px-6 py-2.5 text-paper transition-colors hover:bg-ink-deep disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <Search className="size-4" aria-hidden />
            {searchLivePending ? "Searching…" : "Search live"}
          </button>
        )}
      </div>
    </div>
  );
}
