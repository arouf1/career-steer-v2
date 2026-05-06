"use client";

import { SignInButton } from "@clerk/nextjs";
import { Lock } from "lucide-react";
import { JobsForGuideCard, type JobCardData } from "./JobsForGuideCard";

type Props = {
  /** Real card data rendered behind the blur. Length should be 1–2. */
  blurredPlaceholders: JobCardData[];
  totalRemaining: number;
  /** "near London" / "in the UK" / "near you" — slot label for the CTA copy. */
  geoLabel: string;
  guideTitle: string;
  signInRedirectUrl: string;
};

export function JobsForGuideTeaseLock({
  blurredPlaceholders,
  totalRemaining,
  geoLabel,
  guideTitle,
  signInRedirectUrl,
}: Props) {
  return (
    <div className="relative">
      <div className="space-y-3" aria-hidden>
        {blurredPlaceholders.map((p) => (
          <JobsForGuideCard
            key={p.jobPostingId}
            job={p}
            viewerState="anonymous"
            locked
          />
        ))}
      </div>
      <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-b from-paper/0 via-paper/85 to-paper sm:items-center">
        <div className="flex w-full max-w-md flex-col items-center gap-3 px-6 pb-6 text-center sm:pb-0">
          <div className="flex size-9 items-center justify-center rounded-pill bg-paper-raised">
            <Lock className="size-4 text-mute" aria-hidden />
          </div>
          <p className="type-body text-ink">
            {totalRemaining > 0
              ? `Sign in to see all ${totalRemaining} jobs hiring ${guideTitle} ${geoLabel}.`
              : `Sign in to see jobs hiring ${guideTitle} ${geoLabel}.`}
          </p>
          <SignInButton mode="modal" forceRedirectUrl={signInRedirectUrl}>
            <button
              type="button"
              className="type-label inline-flex items-center justify-center rounded-pill bg-ink px-6 py-2.5 text-paper transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              Sign in
            </button>
          </SignInButton>
        </div>
      </div>
    </div>
  );
}
