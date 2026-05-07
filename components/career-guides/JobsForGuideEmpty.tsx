"use client";

import { forwardRef } from "react";
import { SignInButton } from "@clerk/nextjs";
import { Search, Loader2 } from "lucide-react";

type Props = {
  guideTitle: string;
  /**
   * - anonymous: signed-out user. Render the sign-in CTA.
   * - signed-in-idle: signed-in, never auto-searched. Render the manual
   *   "Search live" button (used when auto-fire's quota is exhausted).
   * - signed-in-searching: signed-in, auto-fire (or manual click) in
   *   flight. Replace the CTA with a quiet loading marker.
   * - signed-in-empty-after-search: signed-in, search completed and
   *   still nothing. Show a softer copy + manual retry.
   */
  variant:
    | "anonymous"
    | "signed-in-idle"
    | "signed-in-searching"
    | "signed-in-empty-after-search";
  onSearchLive?: () => void;
  signInRedirectUrl: string;
};

export const JobsForGuideEmpty = forwardRef<HTMLDivElement, Props>(
  function JobsForGuideEmpty(
    { guideTitle, variant, onSearchLive, signInRedirectUrl },
    ref,
  ) {
    const heading =
      variant === "signed-in-searching"
        ? `Searching live for ${guideTitle} near you…`
        : variant === "signed-in-empty-after-search"
          ? `No live postings found for ${guideTitle} near you`
          : `No cached postings for ${guideTitle} yet`;

    const subhead =
      variant === "anonymous"
        ? "Sign in and we'll search live for jobs near you."
        : variant === "signed-in-searching"
          ? "Pulling fresh postings from the wire. This usually takes a few seconds."
          : variant === "signed-in-empty-after-search"
            ? "Try again later — postings refresh continuously."
            : "Search live to pull fresh postings into the cache.";

    return (
      <div
        ref={ref}
        className="rounded-card border border-dashed border-hairline-strong bg-paper-raised px-6 py-8"
        aria-busy={variant === "signed-in-searching" || undefined}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-md space-y-1">
            <p className="type-title text-ink">{heading}</p>
            <p className="type-caption text-mute">{subhead}</p>
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
          ) : variant === "signed-in-searching" ? (
            <span
              className="type-label inline-flex shrink-0 items-center gap-2 rounded-pill border border-hairline px-5 py-2.5 text-mute"
              role="status"
            >
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              Searching…
            </span>
          ) : (
            <button
              type="button"
              onClick={onSearchLive}
              className="type-label inline-flex shrink-0 items-center justify-center gap-2 rounded-pill bg-ink px-6 py-2.5 text-paper transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              <Search className="size-4" aria-hidden />
              {variant === "signed-in-empty-after-search"
                ? "Search again"
                : "Search live"}
            </button>
          )}
        </div>
      </div>
    );
  },
);

