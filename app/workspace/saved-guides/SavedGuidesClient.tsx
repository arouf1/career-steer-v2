// app/workspace/saved-guides/SavedGuidesClient.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Authenticated, AuthLoading, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SavedGuideCard, type SavedGuide } from "./SavedGuideCard";
import { WorkspacePageHeader } from "@/components/workspace/WorkspacePageHeader";
import {
  WorkspaceLoadingHeader,
  WorkspaceLoadingRows,
} from "@/components/workspace/WorkspaceLoading";

const SORT_KEY = "savedGuides.sort";

const ease = [0.2, 0.65, 0.3, 1] as const;

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

// Sort within each lane section. Lane is the natural editorial grouping -
// no separate lane filter needed, the user's eye tracks lane via the
// section eyebrow.
type Sort = "recent" | "score";
const SORT_VALUES: ReadonlyArray<Sort> = ["recent", "score"];
function isSort(s: string | null): s is Sort {
  return s !== null && SORT_VALUES.includes(s as Sort);
}

const SORT_OPTIONS: ReadonlyArray<{ value: Sort; label: string }> = [
  { value: "recent", label: "Recently saved" },
  { value: "score", label: "Strongest first" },
];

type Lane = NonNullable<SavedGuide["lane"]>;

// Display order matches the discover canvas: linear (next steps) reads
// first, transformational (different) last. Lanes with no saves are
// dropped at render time.
const LANE_ORDER: ReadonlyArray<Lane> = [
  "linear",
  "adjacent",
  "earlier",
  "transformational",
];

const LANE_NAME: Record<Lane, string> = {
  linear: "Next steps",
  adjacent: "Sideways",
  earlier: "Earlier",
  transformational: "Different",
};

const LANE_LEDE: Record<Lane, string> = {
  linear: "Roles that build directly on what you've done.",
  adjacent: "Adjacent fields where your experience translates well.",
  earlier: "Paths you considered before, still worth keeping in view.",
  transformational: "Bigger jumps. Different shape, same person.",
};

const byRecent = (a: SavedGuide, b: SavedGuide) => b.reactedAt - a.reactedAt;
const byScore = (a: SavedGuide, b: SavedGuide) =>
  (b.arcScore ?? 0) - (a.arcScore ?? 0);

export function SavedGuidesClient() {
  return (
    <>
      <AuthLoading>
        <div className="mb-12">
          <WorkspaceLoadingHeader />
        </div>
        <WorkspaceLoadingRows />
      </AuthLoading>
      <Authenticated>
        <SavedGuidesClientInner />
      </Authenticated>
    </>
  );
}

function SavedGuidesClientInner() {
  // Cast through the locally-narrowed `SavedGuide` shape: the Convex query
  // returns `lane: string | null` because the canvas snapshot's lane map is
  // built with `string` keys, but the runtime values are constrained to the
  // `"linear" | "adjacent" | "earlier" | "transformational"` union by the
  // snapshot schema.
  const raw = useQuery(api.discover.querySavedGuides);
  const saved = raw as SavedGuide[] | undefined;

  const [sort, setSort] = useState<Sort>(() => {
    if (typeof window === "undefined") return "recent";
    const s = window.localStorage.getItem(SORT_KEY);
    return isSort(s) ? s : "recent";
  });
  useEffect(() => {
    window.localStorage.setItem(SORT_KEY, sort);
  }, [sort]);

  // Group + sort. Unlaned saves (lane === null) collect into a trailing
  // "Unsorted" section so nothing falls off the page.
  const grouped = useMemo(() => {
    if (!saved) return null;
    const buckets = new Map<Lane | "none", SavedGuide[]>();
    for (const s of saved) {
      const key = (s.lane ?? "none") as Lane | "none";
      const bucket = buckets.get(key);
      if (bucket) bucket.push(s);
      else buckets.set(key, [s]);
    }
    const cmp = sort === "recent" ? byRecent : byScore;
    for (const bucket of buckets.values()) bucket.sort(cmp);
    return buckets;
  }, [saved, sort]);

  if (saved === undefined) {
    return (
      <>
        <div className="mb-12">
          <WorkspaceLoadingHeader />
        </div>
        <WorkspaceLoadingRows />
      </>
    );
  }

  if (saved.length === 0) {
    // One header, not two: the empty-state copy IS the page header. The
    // eyebrow keeps page identity ("SAVED GUIDES") while the headline owns
    // the moment ("Nothing saved yet."). Action lives in the slot.
    return (
      <div className="fade-in-view">
        <WorkspacePageHeader
          eyebrow="Saved guides"
          title="Nothing saved yet."
          lede="When a guide on Career Compass earns a second look, save it. Bookmarks land here so you can come back without searching."
          actions={
            <Link
              href="/workspace/career-compass"
              className="type-label inline-flex w-fit items-center gap-2 rounded-pill bg-ink px-5 py-2.5 uppercase text-paper transition-colors duration-300 hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              Open Career Compass
            </Link>
          }
        />
      </div>
    );
  }

  const sections: Array<{ key: Lane | "none"; rows: SavedGuide[] }> = [];
  for (const lane of LANE_ORDER) {
    const rows = grouped?.get(lane);
    if (rows && rows.length > 0) sections.push({ key: lane, rows });
  }
  const unlaned = grouped?.get("none");
  if (unlaned && unlaned.length > 0) {
    sections.push({ key: "none", rows: unlaned });
  }

  return (
    <div className="fade-in-view">
      <div className="mb-12">
        <WorkspacePageHeader
          eyebrow="Saved guides"
          title={
            <>
              The guides{" "}
              <span className="text-ink-soft">you came back to.</span>
            </>
          }
          lede={`${saved.length} ${saved.length === 1 ? "guide" : "guides"} you've bookmarked from Career Compass.`}
        />
      </div>

      {/* Controls row - mirrors /career-guides: eyebrow + pill buttons on
          the left, count on the right. Replaces v1's Select dropdown so
          the workspace catalogue reads with the same vocabulary as the
          public catalogue. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.15, ease }}
        className="flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <p className={eyebrowCls}>Sort</p>
          <div className="flex gap-1.5">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSort(opt.value)}
                className={`rounded-pill border px-3 py-1.5 text-[12px] tracking-wide transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10 focus-visible:ring-offset-2 ${
                  sort === opt.value
                    ? "border-ink bg-ink text-paper"
                    : "border-hairline text-body hover:border-hairline-strong hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <span className="text-[12px] text-mute">
          {saved.length} {saved.length === 1 ? "guide" : "guides"}
        </span>
      </motion.div>

      {/* List - each lane owns its own hairline so the lane change reads
          as a chapter break, but the eyebrow stays quiet (10px / 0.18em)
          so it doesn't compete with the row titles. The full type-headline
          heading style works on /career-guides because each section has a
          dense card grid; here rows are themselves headline-weight, so a
          big lane heading would read as a wall. */}
      <div className="mt-10 space-y-12 sm:space-y-16">
        {sections.map(({ key, rows }, idx) => (
          <motion.section
            key={key}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{
              duration: 0.45,
              delay: Math.min(idx * 0.04, 0.16),
              ease,
            }}
          >
            <header className="mb-2 max-w-xl border-t border-hairline pt-8">
              <p className={eyebrowCls}>
                {key === "none" ? "Unsorted" : LANE_NAME[key]}
                <span aria-hidden className="mx-2 text-mute/50">
                  ·
                </span>
                <span className="text-mute/80">
                  {rows.length} {rows.length === 1 ? "guide" : "guides"}
                </span>
              </p>
              {key !== "none" && (
                <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink/55">
                  {LANE_LEDE[key]}
                </p>
              )}
            </header>
            <div>
              {rows.map((s) => (
                <SavedGuideCard key={s.guideId} saved={s} />
              ))}
            </div>
          </motion.section>
        ))}
      </div>
    </div>
  );
}
