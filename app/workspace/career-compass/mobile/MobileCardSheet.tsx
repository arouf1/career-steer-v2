"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Bookmark, Check, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
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
 * Mobile-side card detail sheet — vaul bottom drawer.
 *
 * `dismissible={false}` disables vaul's drag-to-dismiss gesture, which
 * was the root cause of the elastic-bounce-back behaviour on long
 * content (vaul interpreted downward scrolls inside the body as
 * dismiss attempts). Without that gesture, the inner overflow-y-auto
 * runs cleanly. User closes via backdrop tap or the X button.
 *
 * Layout follows the iOS-sheet pattern (see memory entry
 * `feedback_ios_sheet_pattern.md`):
 *   - DrawerContent has explicit pixel height via inline style
 *   - Body content scrolls with reserved bottom padding for the CTA
 *   - CTA is absolutely positioned at `bottom-0` with safe-area-inset
 *     padding so it always clears whatever Safari chrome is overlaying
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

  const [overviewExpanded, setOverviewExpanded] = useState(false);
  useEffect(() => {
    if (!open) setOverviewExpanded(false);
  }, [open, card?.guideId]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
      <DrawerContent
        className="bg-paper"
        // Inline pixel height. vaul's default `h-auto max-h-[80vh]`
        // doesn't give the inner overflow-y-auto a definite parent
        // height to engage against. `92dvh` leaves a small strip of
        // page peeking above the drawer so the user remembers the
        // page is still there.
        style={{ height: "92dvh", maxHeight: "92dvh" }}
      >
        {card && (
          <>
            <DrawerTitle className="sr-only">{card.title}</DrawerTitle>
            <DrawerDescription className="sr-only">
              {SLOT_LABEL[card.slotKind]} · {card.whyMatchReason}
            </DrawerDescription>

            {/* Scrollable body. paddingBottom reserves room for the
                absolute-positioned CTA below — content scrolls under
                the CTA's space without ever hiding behind it. */}
            <div
              className="h-full overflow-y-auto overscroll-contain px-5 pt-2"
              style={{
                paddingBottom:
                  "calc(env(safe-area-inset-bottom, 0px) + 96px)",
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
            </div>

            {/* CTA pinned to the drawer's bottom edge. */}
            <div
              className="absolute inset-x-0 bottom-0 z-10 border-t border-hairline bg-paper px-5 pt-3"
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
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
