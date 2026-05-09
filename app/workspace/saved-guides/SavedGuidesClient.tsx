// app/workspace/saved-guides/SavedGuidesClient.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Authenticated, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SavedGuideCard, type SavedGuide } from "./SavedGuideCard";
import { WorkspacePageHeader } from "@/components/workspace/WorkspacePageHeader";
import {
  WorkspaceLoadingHeader,
  WorkspaceLoadingRows,
} from "@/components/workspace/WorkspaceLoading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SORT_KEY = "savedGuides.sort";

// Sort within each lane section. Lane is the natural editorial grouping —
// no separate lane filter needed, the user's eye tracks lane via the
// section eyebrow. Removed v1's `lane` sort: with sections it was a
// no-op. Kept `recent` and `score` (the meaningful ranks within a lane).
type Sort = "recent" | "score";
const SORT_VALUES: ReadonlyArray<Sort> = ["recent", "score"];
function isSort(s: string | null): s is Sort {
  return s !== null && SORT_VALUES.includes(s as Sort);
}

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

const LANE_EYEBROW: Record<Lane, string> = {
  linear: "Next steps",
  adjacent: "Sideways",
  earlier: "Earlier",
  transformational: "Different",
};

const LANE_LEDE: Record<Lane, string> = {
  linear: "Roles that build directly on what you've done.",
  adjacent: "Adjacent fields where your experience translates well.",
  earlier: "Paths you considered before — still worth keeping in view.",
  transformational: "Bigger jumps. Different shape, same person.",
};

const byRecent = (a: SavedGuide, b: SavedGuide) => b.reactedAt - a.reactedAt;
const byScore = (a: SavedGuide, b: SavedGuide) =>
  (b.arcScore ?? 0) - (a.arcScore ?? 0);

export function SavedGuidesClient() {
  return (
    <Authenticated>
      <SavedGuidesClientInner />
    </Authenticated>
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
      <SavedGuidesShell
        saved={saved}
        sort={sort}
        onSortChange={(v) => setSort(v as Sort)}
      >
        <div className="flex flex-col gap-16">
        {sections.map(({ key, rows }) => (
          <section key={key} className="flex flex-col">
            <div className="mb-2 flex flex-col gap-1.5 border-t border-hairline pt-8">
              <p className="type-label uppercase text-mute">
                {key === "none" ? "Unsorted" : LANE_EYEBROW[key]}
                <span className="ml-2 text-mute/60">·</span>
                <span className="ml-2 text-mute/80">
                  {rows.length} {rows.length === 1 ? "guide" : "guides"}
                </span>
              </p>
              {key !== "none" && (
                <p className="max-w-xl text-[14px] leading-relaxed text-ink/55">
                  {LANE_LEDE[key]}
                </p>
              )}
            </div>
            <div>
              {rows.map((s) => (
                <SavedGuideCard key={s.guideId} saved={s} />
              ))}
            </div>
          </section>
        ))}
        </div>
      </SavedGuidesShell>
    </div>
  );
}

// Shell wraps the populated state — header + sort + content. Loading and
// empty states render their own headers inline (so the empty headline can
// own the moment instead of competing with a second title).
function SavedGuidesShell({
  saved,
  sort,
  onSortChange,
  children,
}: {
  saved: SavedGuide[];
  sort: Sort;
  onSortChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <>
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
          actions={
            <Select value={sort} onValueChange={onSortChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recently saved</SelectItem>
                <SelectItem value="score">Strongest match first</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </div>
      {children}
    </>
  );
}
