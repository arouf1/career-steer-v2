"use client";

import { SignInButton } from "@clerk/nextjs";
import { Lock } from "lucide-react";

type Props = {
  /** Real card rows rendered behind the blur (passed as children so callers control the markup). */
  children: React.ReactNode;
  totalRemaining: number;
  /** "near London" / "in the UK" / "near you" — slot label for the CTA copy. */
  geoLabel: string;
  guideTitle: string;
  signInRedirectUrl: string;
};

export function JobsForGuideTeaseLock({
  children,
  totalRemaining,
  geoLabel,
  guideTitle,
  signInRedirectUrl,
}: Props) {
  return (
    <div className="relative overflow-hidden">
      <div
        className="pointer-events-none select-none blur-[3px] [mask-image:linear-gradient(to_bottom,black_0%,black_50%,transparent_100%)]"
        aria-hidden
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-paper/0 via-paper/85 to-paper">
        <div className="flex w-full max-w-md flex-col items-center gap-3 px-6 text-center">
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
