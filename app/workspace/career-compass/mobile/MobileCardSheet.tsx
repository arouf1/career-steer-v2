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

  // Actively measure the visible viewport height. CSS height units
  // (`vh`/`dvh`/`svh` and even `inset-y-0` via fixed positioning) all
  // rely on the browser's layout-time viewport resolution, which iOS
  // Safari does inconsistently across sheet mounts in the same session
  // — exactly the symptom of "the same card sometimes shows the footer
  // and sometimes doesn't." `window.visualViewport.height` is the
  // value iOS *actually* uses for paint regardless of toolbar state,
  // so applying it as an inline pixel height is deterministic.
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      if (h > 0) setViewportHeight(h);
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [open]);

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
            // Inline pixel height from `window.visualViewport` is the
            // authoritative way to size to the visible area on iOS
            // Safari. CSS-only approaches (`h-[100dvh]`, `inset-y-0`)
            // were giving inconsistent results between sheet mounts in
            // the same session. `inset-y-0` stays as a fallback for
            // browsers without visualViewport support.
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-hairline bg-paper sm:max-w-lg"
            style={
              viewportHeight
                ? { height: `${viewportHeight}px` }
                : undefined
            }
            role="dialog"
            aria-label={`Preview of ${card.title}`}
            aria-modal="true"
          >
            {/* Header — slot label + title + why-match + close. Stays
                anchored at the top via flex-shrink-0 (default for
                non-flex-1 children). */}
            <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
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
            </header>

            {/* Body — flex-1 takes remaining height between header and
                footer; min-h-0 lets it shrink so overflow-y-auto engages
                when content exceeds the available space. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
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
            </div>

            {/* Footer CTA — anchored at the bottom of the panel.
                Safe-area-inset-bottom keeps it clear of the iOS home
                indicator. */}
            <footer
              className="border-t border-hairline px-5 pt-3"
              style={{
                paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
              }}
            >
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
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
