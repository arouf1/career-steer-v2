"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp } from "lucide-react";
import type { GuideWithUrl } from "@/convex/careerGuides";
import { type Tier, TIER_RANK } from "@/convex/lib/ladders";
import { CareerGuideCard } from "./CareerGuideCard";

const ease = [0.2, 0.65, 0.3, 1] as const;

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

export type LadderMeta = {
  slug: string;
  name: string;
  family: string;
  description: string;
};

export type PrimaryPosition = {
  guideSlug: string;
  ladderSlug: string;
  ladderName: string;
  rung: number;
  tier: Tier;
};

type LadderSection = {
  ladder: LadderMeta;
  guides: { guide: GuideWithUrl; tier: Tier; rung: number }[];
};

const SLUG_ORPHAN = "__orphan__";

const ORPHAN_LADDER: LadderMeta = {
  slug: SLUG_ORPHAN,
  name: "Other paths",
  family: "other",
  description:
    "Guides that have not yet been placed on a career ladder. We will sort these into ladders as the catalogue grows.",
};

function buildSections(
  guides: GuideWithUrl[],
  ladders: LadderMeta[],
  primaryPositions: PrimaryPosition[],
): LadderSection[] {
  const positionByGuideSlug = new Map(
    primaryPositions.map((p) => [p.guideSlug, p]),
  );
  const ladderBySlug = new Map(ladders.map((l) => [l.slug, l]));

  const grouped = new Map<string, LadderSection>();

  for (const g of guides) {
    const pos = positionByGuideSlug.get(g.slug);
    const ladder = pos ? ladderBySlug.get(pos.ladderSlug) : undefined;
    const key = ladder?.slug ?? SLUG_ORPHAN;
    const section =
      grouped.get(key) ??
      ({
        ladder: ladder ?? ORPHAN_LADDER,
        guides: [],
      } satisfies LadderSection);
    section.guides.push({
      guide: g,
      tier: pos?.tier ?? "ic-mid",
      rung: pos?.rung ?? 0,
    });
    grouped.set(key, section);
  }

  // Order guides within each section by rung asc, then by title for
  // deterministic ties.
  for (const section of grouped.values()) {
    section.guides.sort((a, b) => {
      if (a.rung !== b.rung) return a.rung - b.rung;
      return a.guide.title.localeCompare(b.guide.title);
    });
  }

  // Alphabetical by ladder name. Orphan section ("Other paths") always
  // tails the list — it's a catch-all, not a peer ladder.
  return Array.from(grouped.values())
    .filter((s) => s.guides.length > 0)
    .sort((a, b) => {
      if (a.ladder.slug === SLUG_ORPHAN) return 1;
      if (b.ladder.slug === SLUG_ORPHAN) return -1;
      return a.ladder.name.localeCompare(b.ladder.name);
    });
}

export function CareerGuidesByLadder({
  guides,
  ladders,
  primaryPositions,
}: {
  guides: GuideWithUrl[];
  ladders: LadderMeta[];
  primaryPositions: PrimaryPosition[];
}) {
  const sections = useMemo(
    () => buildSections(guides, ladders, primaryPositions),
    [guides, ladders, primaryPositions],
  );

  const [activeSlug, setActiveSlug] = useState<string>(
    sections[0]?.ladder.slug ?? "",
  );
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const anchorRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const stripScrollRef = useRef<HTMLUListElement>(null);
  // While a click-driven smooth scroll is in flight, the IntersectionObserver
  // would otherwise see intermediate sections crossing the rootMargin and
  // flip activeSlug back and forth. The lock suppresses observer updates
  // until the scroll settles, then auto-releases.
  const scrollLockRef = useRef<number | null>(null);
  // Edge-fade visibility: shown only when there's hidden content in that
  // direction inside the anchor strip. Soft "more pills →" affordance.
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // Mouse drag-to-scroll on the strip. Touch / trackpad / wheel all work
  // natively on overflow-x:auto, but plain-mouse-pointer drag doesn't —
  // these refs track the drag state so we can update scrollLeft directly
  // and suppress the trailing click when a drag actually moved.
  const dragStateRef = useRef<{
    isDragging: boolean;
    startX: number;
    startScroll: number;
    moved: boolean;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Back-to-top button visibility — toggled on whenever the page is
  // scrolled meaningfully below the fold. Click smooth-scrolls to top.
  const [showBackToTop, setShowBackToTop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setShowBackToTop(window.scrollY > 400);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  // Scroll-spy: mark a section "active" when the top of its header
  // crosses ~30% of the viewport. IntersectionObserver with rootMargin
  // does this efficiently — no scroll-event listener needed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollLockRef.current !== null) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const slug = visible[0].target.getAttribute("data-ladder-slug");
          if (slug) setActiveSlug(slug);
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [sections]);

  // Keep the active anchor in view inside the horizontal strip. Use a
  // direct scrollLeft on the strip container instead of scrollIntoView —
  // scrollIntoView propagates to ancestors and can shift the entire page
  // horizontally when the inline offset can't be satisfied within the
  // strip alone.
  useEffect(() => {
    const link = anchorRefs.current.get(activeSlug);
    const strip = stripScrollRef.current;
    if (!link || !strip) return;
    const targetLeft =
      link.offsetLeft - strip.clientWidth / 2 + link.offsetWidth / 2;
    strip.scrollTo({ left: targetLeft, behavior: "smooth" });
  }, [activeSlug]);

  // Track strip scroll position to toggle the edge-fade indicators. Fades
  // visually communicate "more pills hidden in this direction" — the
  // strip is scroll-snappable but without an indicator it reads as a
  // truncated list, not a swipe-able rail.
  useEffect(() => {
    const strip = stripScrollRef.current;
    if (!strip) return;
    const update = () => {
      setCanScrollLeft(strip.scrollLeft > 1);
      setCanScrollRight(
        strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1,
      );
    };
    update();
    strip.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      strip.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sections]);

  // Mouse drag-to-scroll. Pointer events handle both mouse and pen; touch
  // is left to the browser's native overflow-x scrolling so we don't
  // double-handle and break momentum scroll on iOS / trackpads.
  useEffect(() => {
    const strip = stripScrollRef.current;
    if (!strip) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return; // touch handled natively
      dragStateRef.current = {
        isDragging: true,
        startX: e.clientX,
        startScroll: strip.scrollLeft,
        moved: false,
      };
      setIsDragging(true);
    };
    const onPointerMove = (e: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state || !state.isDragging) return;
      const dx = e.clientX - state.startX;
      if (Math.abs(dx) > 4) state.moved = true;
      strip.scrollLeft = state.startScroll - dx;
    };
    const endDrag = () => {
      const state = dragStateRef.current;
      if (!state) return;
      state.isDragging = false;
      setIsDragging(false);
      // Keep `moved` set briefly so the trailing click on a pill can be
      // suppressed by the click-capture handler below.
      window.setTimeout(() => {
        dragStateRef.current = null;
      }, 0);
    };

    // Suppress the click that follows a drag — without this, releasing
    // the mouse on top of a pill would fire that pill's onClick.
    const onClickCapture = (e: MouseEvent) => {
      if (dragStateRef.current?.moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    strip.addEventListener("pointerdown", onPointerDown);
    strip.addEventListener("pointermove", onPointerMove);
    strip.addEventListener("pointerup", endDrag);
    strip.addEventListener("pointercancel", endDrag);
    strip.addEventListener("pointerleave", endDrag);
    strip.addEventListener("click", onClickCapture, { capture: true });

    return () => {
      strip.removeEventListener("pointerdown", onPointerDown);
      strip.removeEventListener("pointermove", onPointerMove);
      strip.removeEventListener("pointerup", endDrag);
      strip.removeEventListener("pointercancel", endDrag);
      strip.removeEventListener("pointerleave", endDrag);
      strip.removeEventListener("click", onClickCapture, { capture: true });
    };
  }, [sections]);

  const jumpToSection = (slug: string) => {
    const target = sectionRefs.current.get(slug);
    if (!target) return;
    // Optimistic: set active immediately so the pill style updates
    // without waiting for the scroll-spy.
    setActiveSlug(slug);
    // Lock the observer while the smooth-scroll is in flight.
    if (scrollLockRef.current !== null) {
      window.clearTimeout(scrollLockRef.current);
    }
    scrollLockRef.current = window.setTimeout(() => {
      scrollLockRef.current = null;
    }, 800);
    // Manual window.scrollTo instead of element.scrollIntoView — the
    // latter defaults inline:"nearest" which still scrolls horizontally
    // when an element is even 1px wider than the viewport. window.scrollTo
    // is vertical-only and cannot shift the page sideways. We deliberately
    // do NOT set the URL hash — anchor pills are purely a navigational
    // affordance, not a deep-linkable state, and the `#ladder-<slug>` in
    // the address bar reads as junk for the user.
    const rect = target.getBoundingClientRect();
    const SCROLL_MARGIN_TOP = 96;
    window.scrollTo({
      top: window.scrollY + rect.top - SCROLL_MARGIN_TOP,
      behavior: "smooth",
    });
  };

  if (sections.length === 0) return null;

  return (
    <div className="w-full max-w-full overflow-x-clip">
      {/* Anchor strip — sticky inside the section column, no negative
          margins (those caused horizontal page overflow in some workspace
          layouts). Strip itself owns its own horizontal scroll, with
          edge-fade indicators when content extends beyond the visible
          rail. */}
      <nav
        aria-label="Career ladders"
        className="sticky top-0 z-20 mb-10 w-full max-w-full border-b border-hairline bg-paper/95 backdrop-blur-[2px]"
      >
        <div className="relative">
          <ul
            ref={stripScrollRef}
            className={`hide-scrollbar flex w-full max-w-full snap-x snap-mandatory gap-1.5 overflow-x-auto py-3 select-none ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            style={isDragging ? { scrollSnapType: "none" } : undefined}
          >
          {sections.map((s) => {
            const isActive = s.ladder.slug === activeSlug;
            return (
              <li key={s.ladder.slug} className="snap-start">
                <button
                  ref={(el) => {
                    if (el) anchorRefs.current.set(s.ladder.slug, el);
                    else anchorRefs.current.delete(s.ladder.slug);
                  }}
                  type="button"
                  onClick={() => jumpToSection(s.ladder.slug)}
                  className={`inline-block whitespace-nowrap rounded-pill px-3 py-1.5 text-[12px] tracking-wide transition-colors ${
                    isActive
                      ? "bg-ink text-paper"
                      : "text-mute hover:text-ink"
                  }`}
                  aria-current={isActive ? "true" : undefined}
                >
                  {s.ladder.name}
                </button>
              </li>
            );
          })}
          </ul>

          {/* Edge-fade indicators — soft paper-to-transparent fade on
              either edge when more pills are hidden in that direction.
              pointer-events-none so they never block taps. */}
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-paper to-transparent transition-opacity duration-200 ${
              canScrollLeft ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-paper to-transparent transition-opacity duration-200 ${
              canScrollRight ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
      </nav>

      {/* Sections */}
      <div className="space-y-16 sm:space-y-20">
        {sections.map((s, idx) => (
          <motion.section
            key={s.ladder.slug}
            id={`ladder-${s.ladder.slug}`}
            ref={(el) => {
              if (el) sectionRefs.current.set(s.ladder.slug, el);
              else sectionRefs.current.delete(s.ladder.slug);
            }}
            data-ladder-slug={s.ladder.slug}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{
              duration: 0.45,
              delay: Math.min(idx * 0.04, 0.16),
              ease,
            }}
            aria-labelledby={`ladder-heading-${s.ladder.slug}`}
            className="scroll-mt-24"
          >
            <header className="mb-8 max-w-2xl">
              <p className={eyebrowCls}>
                Ladder · {s.guides.length} guide{s.guides.length === 1 ? "" : "s"}
              </p>
              <h2
                id={`ladder-heading-${s.ladder.slug}`}
                className="type-headline mt-3 text-balance text-ink"
              >
                {s.ladder.name}
              </h2>
              <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-body">
                {s.ladder.description}
              </p>
            </header>

            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {s.guides.map(({ guide, tier }) => (
                <li key={guide.slug}>
                  <CareerGuideCard guide={guide} variant="medium" tier={tier} />
                </li>
              ))}
            </ul>
          </motion.section>
        ))}
      </div>

      <style jsx>{`
        .hide-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {/* Back-to-top floater — appears when the page is scrolled below
          the fold, click to smoothly scroll back to the top. Fixed
          bottom-right, paper background + 1px hairline border (no
          shadows at rest per DESIGN.md), ink ArrowUp icon. */}
      <AnimatePresence>
        {showBackToTop && (
          <motion.button
            key="back-to-top"
            type="button"
            onClick={() =>
              window.scrollTo({ top: 0, behavior: "smooth" })
            }
            aria-label="Back to top"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease }}
            className="fixed bottom-6 right-6 z-30 grid h-11 w-11 place-items-center rounded-full bg-ink text-paper transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10 focus-visible:ring-offset-2 sm:bottom-8 sm:right-8"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2} aria-hidden />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
