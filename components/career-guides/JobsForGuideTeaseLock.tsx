"use client";

import { SignInButton } from "@clerk/nextjs";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <div className="space-y-2 opacity-90" aria-hidden>
        {blurredPlaceholders.map((p) => (
          <JobsForGuideCard
            key={p.jobPostingId}
            job={p}
            viewerState="anonymous"
            locked
          />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-background/40 via-background/80 to-background">
        <div className="flex flex-col items-center gap-2 px-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-foreground/5">
            <Lock className="size-4 text-muted-foreground" aria-hidden />
          </div>
          <p className="text-sm">
            {totalRemaining > 0
              ? `Sign in to see all ${totalRemaining} jobs hiring ${guideTitle} ${geoLabel}.`
              : `Sign in to see jobs hiring ${guideTitle} ${geoLabel}.`}
          </p>
          <SignInButton mode="modal" forceRedirectUrl={signInRedirectUrl}>
            <Button size="sm">Sign in</Button>
          </SignInButton>
        </div>
      </div>
    </div>
  );
}
