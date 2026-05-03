"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Bookmark, Check, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { CompassCard } from "../lib/mobileCompassTypes";

const SLOT_LABEL: Record<CompassCard["slotKind"], string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "More to explore",
};

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

type Props = {
  card: CompassCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing reaction so we can show "Saved" on the save button. */
  reaction?: "saved";
  /** Fired after a successful save so the compass can play a dot bloom. */
  onSaved?: (guideId: string) => void;
  /** Fired after a successful dismiss so the compass can play a fade. */
  onDismissed?: (guideId: string) => void;
};

/**
 * Mobile-side card detail panel. Mirrors the OutreachDraftDrawer +
 * desktop CardPreviewSheet pattern (motion.aside + backdrop) instead of
 * vaul's bottom drawer. We tried vaul; the elastic bounce and drag-to-
 * dismiss heuristics fought with the inner overflow on long content,
 * leaving the "Read full guide" CTA intermittently unreachable. The
 * motion.aside approach has none of those issues — explicit h-screen
 * gives flex-1 a definite parent height for overflow-y-auto to engage,
 * and there's no drag handler trying to interpret downward scrolls as
 * dismiss gestures.
 *
 * Slides in from the right (consistent with desktop and the LinkedIn
 * Drafts panel). On mobile this is full-screen because of `w-full`.
 */
export function MobileCardSheet({
  card,
  open,
  onOpenChange,
  reaction,
  onSaved,
  onDismissed,
}: Props) {
  const save = useMutation(api.discover.saveGuide);
  const dismiss = useMutation(api.discover.dismissGuide);
  const image = useQuery(
    api.careerGuides.getCardImage,
    card ? { guideId: card.guideId } : "skip",
  );

  // Overview starts collapsed (3 lines) and expands on tap. Reset whenever
  // the sheet opens with a new card so we don't leak the previous card's
  // expanded state.
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  useEffect(() => {
    if (!open) setOverviewExpanded(false);
  }, [open, card?.guideId]);

  // Sheet height uses `100svh` (smallest viewport height). On iOS
  // Safari, the URL bar transitions cause every "live" viewport unit
  // (vh/dvh) and visualViewport-measured height to be subtly wrong
  // mid-transition — content was rendering past the visible area
  // even when measurements said it fit. `svh` is the *smallest*
  // viewport (URL bar fully visible) and never changes, so the sheet
  // is always smaller-or-equal-to the visible area regardless of
  // URL bar state. Trade-off: a small strip of cream may be visible
  // below the sheet when the URL bar is collapsed, but the Read full
  // guide CTA is reliably reachable on every card.

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open && card && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />
          <motion.aside
            key="aside"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.35, ease: [0.2, 0.65, 0.3, 1] }}
            // Single scroll container architecture, sized via `100svh`
            // (smallest viewport — URL bar fully visible). Always fits
            // within the visible area on iOS Safari regardless of URL
            // bar state.
            className="fixed right-0 top-0 z-50 w-full overflow-hidden border-l border-hairline bg-paper sm:max-w-lg"
            style={{ height: "100svh", maxHeight: "100svh" }}
            role="dialog"
            aria-label={`Preview of ${card.title}`}
            aria-modal="true"
          >
            <div
              className="h-full overflow-y-auto overscroll-contain px-5 pt-4"
              style={{
                // Generous bottom buffer: safe-area inset alone (the iOS
                // home indicator height, ~34px on Pro Max) doesn't give
                // enough daylight below the CTA when content totals
                // close to the visible viewport — the CTA ends up
                // half-occluded by the indicator area without enough
                // overflow to actually engage scroll. +40px on top of
                // the safe-area inset always leaves a clear gap.
                paddingBottom:
                  "calc(env(safe-area-inset-bottom, 0px) + 40px)",
              }}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 pb-4">
                <div className="min-w-0">
                  <p className={eyebrowCls}>{SLOT_LABEL[card.slotKind]}</p>
                  <h2 className="mt-1 font-serif text-[20px] leading-tight text-ink">
                    {card.title}
                  </h2>
                  <p className="mt-2 text-[14px] italic leading-snug text-mute">
                    {card.whyMatchReason}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="-mr-1 shrink-0 rounded-pill p-2 text-mute transition-colors hover:bg-paper-raised hover:text-ink"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" aria-hidden strokeWidth={1.75} />
                </button>
              </div>

              {/* Hero image */}
              {image && (
                <div className="relative mb-5 aspect-[16/10] overflow-hidden rounded-md border border-hairline bg-paper-raised">
                  <Image
                    src={image.url}
                    alt={image.alt}
                    fill
                    sizes="(min-width: 640px) 32rem, 100vw"
                    className="object-cover"
                  />
                </div>
              )}

              {/* Overview — three lines collapsed, full text on tap. */}
              <section>
                <p className={eyebrowCls}>Overview</p>
                <p
                  className={
                    "mt-2 text-[14px] leading-relaxed text-ink-soft" +
                    (overviewExpanded ? "" : " line-clamp-3")
                  }
                >
                  {card.overview}
                </p>
                {card.overview.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOverviewExpanded((v) => !v)}
                    className="mt-1.5 text-[12px] font-medium italic text-ink underline-offset-2 hover:underline"
                  >
                    {overviewExpanded ? "Read less" : "Read more"}
                  </button>
                )}
              </section>

              {/* Typical skills */}
              {card.typicalSkills.length > 0 && (
                <section className="mt-6">
                  <p className={eyebrowCls}>Typical skills</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {card.typicalSkills.slice(0, 6).map((s) => (
                      <span
                        key={s}
                        className="rounded-pill border border-hairline px-2.5 py-0.5 text-[12px] text-ink"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Reactions */}
              <section className="mt-6 flex items-center gap-2">
                <button
                  type="button"
                  disabled={reaction === "saved"}
                  onClick={async () => {
                    await save({ guideId: card.guideId });
                    onSaved?.(card.guideId as string);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-ink-deep hover:bg-paper-raised disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {reaction === "saved" ? (
                    <>
                      <Check
                        className="h-3.5 w-3.5"
                        aria-hidden
                        strokeWidth={1.75}
                      />
                      Saved
                    </>
                  ) : (
                    <>
                      <Bookmark
                        className="h-3.5 w-3.5"
                        aria-hidden
                        strokeWidth={1.75}
                      />
                      Save
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await dismiss({ guideId: card.guideId });
                    onDismissed?.(card.guideId as string);
                    onOpenChange(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-3 py-1.5 text-[12px] font-medium text-mute transition-colors hover:border-ink-deep hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
                  Not for me
                </button>
              </section>

              {/* Read full guide CTA — sits at the natural end of scroll
                  content. Always present, always reachable via scroll. */}
              <div className="mt-6 border-t border-hairline pt-5">
                <Link
                  href={`/career-guides/${card.slug}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-pill bg-ink px-5 py-3 text-[14px] font-medium text-paper transition-colors hover:bg-ink-deep"
                >
                  Read full guide
                  <ArrowUpRight
                    className="h-3.5 w-3.5"
                    aria-hidden
                    strokeWidth={1.75}
                  />
                </Link>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
