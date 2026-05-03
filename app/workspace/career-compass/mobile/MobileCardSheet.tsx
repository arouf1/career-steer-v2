"use client";
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
 * Mobile-native bottom sheet for card detail. shadcn `Drawer` (vaul) under
 * the hood — drag-handle, drag-down to dismiss, backdrop tap to close.
 *
 * Two-tier disclosure: this sheet shows enough to make a quick decision
 * (Save / Not for me) without committing to a full read. "Read full guide"
 * routes to /career-guides/{slug} via Next router so the reading commitment
 * gets its own page.
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

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      shouldScaleBackground={false}
    >
      <DrawerContent
        className={
          // Override vaul's default 80vh cap so the sheet has more breathing
          // room — ~92vh leaves only the compass header peeking above. The
          // `h-[92vh]` (rather than just max-h) gives the inner flex column
          // an explicit height, which is required for `flex-1` +
          // `overflow-y-auto` on the content area to actually scroll.
          "bg-paper data-[vaul-drawer-direction=bottom]:!h-[92vh] data-[vaul-drawer-direction=bottom]:!max-h-[92vh]"
        }
      >
        {/* Visually-hidden title/description satisfy vaul's a11y
            requirements without taking layout space. */}
        {card && (
          <>
            <DrawerTitle className="sr-only">{card.title}</DrawerTitle>
            <DrawerDescription className="sr-only">
              {SLOT_LABEL[card.slotKind]} · {card.whyMatchReason}
            </DrawerDescription>
          </>
        )}

        {card && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-2">
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
                    sizes="100vw"
                    className="object-cover"
                  />
                </div>
              )}

              {/* Overview */}
              <section>
                <p className={eyebrowCls}>Overview</p>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-soft line-clamp-6">
                  {card.overview}
                </p>
              </section>

              {/* Typical skills */}
              {card.typicalSkills.length > 0 && (
                <section className="mt-5">
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
              <section className="mt-5 flex items-center gap-2">
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

            {/* Footer CTA */}
            <div className="border-t border-hairline px-5 py-3">
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
        )}
      </DrawerContent>
    </Drawer>
  );
}
