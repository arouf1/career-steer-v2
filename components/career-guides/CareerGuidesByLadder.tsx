"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
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

  // Order sections by family priority (product/eng/design/data first), then
  // alphabetically by ladder name. Orphan section always last.
  const FAMILY_ORDER: string[] = [
    "product",
    "engineering",
    "design",
    "data",
    "marketing",
    "sales",
    "finance",
    "legal",
    "operations",
    "people",
    "customer-success",
    "research",
    "healthcare",
    "education",
    "trades",
    "creative",
    "other",
  ];
  const familyRank = (family: string): number => {
    const i = FAMILY_ORDER.indexOf(family);
    return i === -1 ? FAMILY_ORDER.length : i;
  };

  return Array.from(grouped.values())
    .filter((s) => s.guides.length > 0)
    .sort((a, b) => {
      if (a.ladder.slug === SLUG_ORPHAN) return 1;
      if (b.ladder.slug === SLUG_ORPHAN) return -1;
      const aRank = familyRank(a.ladder.family);
      const bRank = familyRank(b.ladder.family);
      if (aRank !== bRank) return aRank - bRank;
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
  const anchorRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  // While a click-driven smooth scroll is in flight, the IntersectionObserver
  // would otherwise see intermediate sections crossing the rootMargin and
  // flip activeSlug back and forth. The lock suppresses observer updates
  // until the scroll settles, then auto-releases.
  const scrollLockRef = useRef<number | null>(null);

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

  // Keep the active anchor in view inside the horizontal strip.
  useEffect(() => {
    const el = anchorRefs.current.get(activeSlug);
    if (!el) return;
    el.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeSlug]);

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
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#ladder-${slug}`);
  };

  if (sections.length === 0) return null;

  return (
    <div>
      {/* Anchor strip */}
      <nav
        aria-label="Career ladders"
        className="sticky top-0 z-20 -mx-4 mb-10 border-b border-hairline bg-paper/95 px-4 backdrop-blur-[2px] sm:-mx-6 sm:px-6"
      >
        <ul className="hide-scrollbar flex snap-x snap-mandatory gap-1.5 overflow-x-auto py-3">
          {sections.map((s) => {
            const isActive = s.ladder.slug === activeSlug;
            return (
              <li key={s.ladder.slug} className="snap-start">
                <a
                  ref={(el) => {
                    if (el) anchorRefs.current.set(s.ladder.slug, el);
                    else anchorRefs.current.delete(s.ladder.slug);
                  }}
                  href={`#ladder-${s.ladder.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    jumpToSection(s.ladder.slug);
                  }}
                  className={`inline-block whitespace-nowrap rounded-pill px-3 py-1.5 text-[12px] tracking-wide transition-colors ${
                    isActive
                      ? "bg-ink text-paper"
                      : "text-mute hover:text-ink"
                  }`}
                  aria-current={isActive ? "true" : undefined}
                >
                  {s.ladder.name}
                </a>
              </li>
            );
          })}
        </ul>
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
    </div>
  );
}
