"use client";
import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Bookmark, Check, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

export type CardPreviewData = {
  guideId: Id<"career_guides">;
  title: string;
  slug: string;
  slotKind: "strong" | "bridge" | "aspirational" | "extra";
  whyMatchReason: string;
  overview: string;
  typicalSkills: string[];
  reaction?: "saved" | "dismissed";
};

const SLOT_LABEL: Record<CardPreviewData["slotKind"], string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "More to explore",
};

export function CardPreviewSheet({
  card,
  open,
  onOpenChange,
}: {
  card: CardPreviewData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useMutation(api.discover.saveGuide);
  const dismiss = useMutation(api.discover.dismissGuide);
  // Lazy hero-image lookup. Pass "skip" when there's no card so the query
  // doesn't subscribe — kept off the snapshot hot path on purpose.
  const image = useQuery(
    api.careerGuides.getCardImage,
    card ? { guideId: card.guideId } : "skip",
  );

  // Lock body scroll while the drawer is open.
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
            className="fixed right-0 top-0 z-50 flex h-screen w-full flex-col border-l border-hairline bg-paper sm:max-w-lg"
            role="dialog"
            aria-label={`Preview of ${card.title}`}
            aria-modal="true"
          >
            <header className="flex items-start justify-between gap-3 border-b border-hairline px-6 py-5">
              <div className="min-w-0">
                <p className={eyebrowCls}>{SLOT_LABEL[card.slotKind]}</p>
                <h2 className="mt-1 text-[18px] font-medium leading-tight text-ink">
                  {card.title}
                </h2>
                <p className="mt-2 text-[14px] italic leading-snug text-mute">
                  {card.whyMatchReason}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="-mr-1 rounded-pill p-2 text-mute transition-colors hover:bg-paper-raised hover:text-ink"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden strokeWidth={1.75} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {image && (
                <div className="relative mb-6 aspect-[16/10] overflow-hidden rounded-md border border-hairline bg-paper-raised">
                  <Image
                    src={image.url}
                    alt={image.alt}
                    fill
                    sizes="(min-width: 640px) 32rem, 100vw"
                    className="object-cover"
                  />
                </div>
              )}
              <section>
                <p className={eyebrowCls}>Overview</p>
                <p className="mt-3 text-[14px] leading-relaxed text-ink-soft line-clamp-6">
                  {card.overview}
                </p>
              </section>

              {card.typicalSkills.length > 0 && (
                <section className="mt-6">
                  <p className={eyebrowCls}>Typical skills</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
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

              <section className="mt-6 flex items-center gap-2">
                <button
                  type="button"
                  disabled={card.reaction === "saved"}
                  onClick={async () => {
                    await save({ guideId: card.guideId });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-ink-deep hover:bg-paper-raised disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {card.reaction === "saved" ? (
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
                    onOpenChange(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-3 py-1.5 text-[12px] font-medium text-mute transition-colors hover:border-ink-deep hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
                  Not for me
                </button>
              </section>
            </div>

            <footer className="border-t border-hairline px-6 py-4">
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
