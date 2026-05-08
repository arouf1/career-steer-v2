"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Mic } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import { InterviewSimDialog } from "./InterviewSimDialog";

type Variant = "aside" | "byline-inline";

type Props = {
  jobPostingId: Id<"job_postings">;
  callTitle: string;
  companyName: string;
  listingPath: string;
  variant: Variant;
  className?: string;
};

/**
 * Discrete CTA for the mock-interview simulation. Sibling of JobVoiceCallTile
 * and mirrors its two-variant structure.
 *
 * Two variants:
 *   - aside         — compact card placed in the right column of the
 *                     posting article. Visible on desktop.
 *   - byline-inline — small text-link near the apply CTA. lg:hidden — only
 *                     shows on mobile so it doesn't compete with the desktop
 *                     aside variant.
 *
 * Anonymous branch (both variants): the slot still renders, but it's a Link
 * to /sign-in?redirect_url=<listingPath> instead of a button that opens the
 * dialog. Same visual density — only the label and target change.
 *
 * Uses Mic icon (not Phone, which belongs to the discuss tile) to distinguish
 * the mock-interview surface from the discuss-this-role deep-dive.
 */
export function InterviewSimCallTile({
  jobPostingId,
  callTitle,
  companyName,
  listingPath,
  variant,
  className,
}: Props) {
  const { isLoaded, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);

  const signInHref = useMemo(() => {
    const qs = new URLSearchParams({ redirect_url: listingPath });
    return `/sign-in?${qs.toString()}`;
  }, [listingPath]);

  if (variant === "byline-inline") {
    if (!isLoaded) return null;
    if (!isSignedIn) {
      return (
        <Link
          href={signInHref}
          className={cn(
            "lg:hidden inline-flex items-center gap-1 text-[13px] font-medium text-ink/85 underline-offset-4 transition-colors hover:text-ink hover:underline",
            className,
          )}
        >
          <Mic aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          Sign in to mock interview
          <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        </Link>
      );
    }
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "lg:hidden inline-flex items-center gap-1 text-[13px] font-medium text-ink/85 underline-offset-4 transition-colors hover:text-ink hover:underline",
            className,
          )}
        >
          <Mic aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          Mock interview
          <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        </button>
        <InterviewSimDialog
          jobPostingId={jobPostingId}
          callTitle={callTitle}
          companyName={companyName}
          open={open}
          onOpenChange={setOpen}
        />
      </>
    );
  }

  // ── aside variant ─────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "border-hairline bg-paper-raised rounded-card border p-4",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="bg-ink mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        >
          <Mic className="h-3.5 w-3.5 text-paper" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">Mock interview</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-mute">
            Realistic 10–15 minute simulation, calibrated to how {companyName} actually interviews for this role.
          </p>
        </div>
      </div>

      <div className="mt-3.5">
        {!isLoaded && (
          <button
            type="button"
            disabled
            className="inline-flex h-8 w-full items-center justify-center rounded-pill border border-hairline bg-paper px-3 text-[12px] font-medium text-mute"
            aria-hidden
          >
            Loading…
          </button>
        )}
        {isLoaded && !isSignedIn && (
          <Link
            href={signInHref}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-pill border border-hairline bg-paper px-3 text-[12px] font-medium text-ink transition-colors hover:bg-paper-raised"
          >
            Sign in to start
            <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
          </Link>
        )}
        {isLoaded && isSignedIn && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-pill bg-ink px-3 text-[12px] font-medium text-paper transition-colors hover:bg-ink-deep"
          >
            Start mock interview
            <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {isLoaded && isSignedIn && (
        <InterviewSimDialog
          jobPostingId={jobPostingId}
          callTitle={callTitle}
          companyName={companyName}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}
