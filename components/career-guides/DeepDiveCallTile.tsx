"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Phone } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import { DeepDiveCallDialog } from "./DeepDiveCallDialog";

type Variant = "aside" | "byline-inline";

type Props = {
  guideId: Id<"career_guides">;
  guideTitle: string;
  guideSlug: string;
  region: "us" | "uk";
  variant: Variant;
  className?: string;
};

/**
 * Discrete CTA for the realtime deep-dive call.
 *
 * Two variants:
 *   - aside         — compact card placed at the top of the article's right
 *                     column on desktop. Visually anchors next to the
 *                     publish-date row in the article column. On mobile the
 *                     entire right aside reflows below the article body.
 *   - byline-inline — small text-link chip rendered inside <Byline> next to
 *                     the publish date. lg:hidden — only shows on mobile so
 *                     it doesn't compete with the desktop aside variant.
 *
 * Anonymous branch (both variants): the slot still renders, but it's a Link
 * to /sign-in?redirect_url=<guidePath> instead of a button that opens the
 * call. Same visual density — only the label and target change.
 */
export function DeepDiveCallTile({
  guideId,
  guideTitle,
  guideSlug,
  region,
  variant,
  className,
}: Props) {
  const { isLoaded, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);

  const signInHref = useMemo(() => {
    const redirect = `/career-guides/${guideSlug}`;
    // Clerk's catch-all sign-in supports redirect_url; fallback path lands
    // the user back exactly where they were so they can press the CTA again.
    const qs = new URLSearchParams({ redirect_url: redirect });
    return `/sign-in?${qs.toString()}`;
  }, [guideSlug]);

  // Pre-load state: don't flash an anonymous CTA into a logged-in user's
  // face during the brief Clerk-loading window.
  const showAnonymous = isLoaded && !isSignedIn;
  const showSignedIn = isLoaded && isSignedIn;

  if (variant === "byline-inline") {
    if (!isLoaded) {
      return null;
    }
    if (showAnonymous) {
      return (
        <Link
          href={signInHref}
          className={cn(
            "lg:hidden inline-flex items-center gap-1 text-[13px] font-medium text-ink/85 underline-offset-4 transition-colors hover:text-ink hover:underline",
            className,
          )}
        >
          <Phone aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          Sign in to talk it through
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
          <Phone aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          Talk it through
          <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        </button>
        {showSignedIn && (
          <DeepDiveCallDialog
            guideId={guideId}
            guideTitle={guideTitle}
            region={region}
            open={open}
            onOpenChange={setOpen}
          />
        )}
      </>
    );
  }

  // ── aside variant ─────────────────────────────────────────────────────
  // Render shell even while Clerk is loading so the right column doesn't
  // jump in height when user state resolves.
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
          className="bg-ink/5 mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        >
          <Phone className="h-3.5 w-3.5 text-ink" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">Talk it through</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-mute">
            Live 1-on-1 with an AI career adviser, tailored to you. ~5–10
            minutes.
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

        {showAnonymous && (
          <Link
            href={signInHref}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-pill border border-hairline bg-paper px-3 text-[12px] font-medium text-ink transition-colors hover:bg-paper-raised"
          >
            Sign in to start
            <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
          </Link>
        )}

        {showSignedIn && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-pill bg-ink px-3 text-[12px] font-medium text-paper transition-colors hover:bg-ink-deep"
          >
            Start call
            <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {showSignedIn && (
        <DeepDiveCallDialog
          guideId={guideId}
          guideTitle={guideTitle}
          region={region}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}
