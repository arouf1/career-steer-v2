// app/workspace/saved-guides/SavedGuidesClient.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Bookmark } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { SavedGuideCard, type SavedGuide } from "./SavedGuideCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SORT_KEY = "savedGuides.sort";
const FILTER_KEY = "savedGuides.filter";

type Sort = "recent" | "lane" | "score";
type Filter = "all" | "linear" | "adjacent" | "transformational";

const SORT_VALUES: ReadonlyArray<Sort> = ["recent", "lane", "score"];
const FILTER_VALUES: ReadonlyArray<Filter> = [
  "all",
  "linear",
  "adjacent",
  "transformational",
];

function isSort(s: string | null): s is Sort {
  return s !== null && SORT_VALUES.includes(s as Sort);
}
function isFilter(f: string | null): f is Filter {
  return f !== null && FILTER_VALUES.includes(f as Filter);
}

const byRecent = (a: SavedGuide, b: SavedGuide) => b.reactedAt - a.reactedAt;
const byLane = (a: SavedGuide, b: SavedGuide) =>
  (a.lane ?? "").localeCompare(b.lane ?? "");
const byScore = (a: SavedGuide, b: SavedGuide) =>
  (b.arcScore ?? 0) - (a.arcScore ?? 0);

export function SavedGuidesClient() {
  // Cast through the locally-narrowed `SavedGuide` shape: the Convex query
  // returns `lane: string | null` because the canvas snapshot's lane map is
  // built with `string` keys, but the runtime values are constrained to the
  // `"linear" | "adjacent" | "transformational"` union by the snapshot schema.
  const raw = useQuery(api.discover.querySavedGuides);
  const saved = raw as SavedGuide[] | undefined;

  const [sort, setSort] = useState<Sort>("recent");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const s = localStorage.getItem(SORT_KEY);
    const f = localStorage.getItem(FILTER_KEY);
    if (isSort(s)) setSort(s);
    if (isFilter(f)) setFilter(f);
  }, []);
  useEffect(() => {
    localStorage.setItem(SORT_KEY, sort);
  }, [sort]);
  useEffect(() => {
    localStorage.setItem(FILTER_KEY, filter);
  }, [filter]);

  const visible = useMemo<SavedGuide[]>(() => {
    if (!saved) return [];
    const base =
      filter === "all" ? saved : saved.filter((s) => s.lane === filter);
    const sorted = [...base];
    if (sort === "recent") sorted.sort(byRecent);
    else if (sort === "lane") sorted.sort(byLane);
    else if (sort === "score") sorted.sort(byScore);
    return sorted;
  }, [saved, sort, filter]);

  // Loading state — `saved` is undefined while the Convex subscription warms up.
  if (saved === undefined) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Bookmark className="size-12 animate-pulse text-ink/30" />
        <p className="text-sm text-ink/60">Loading your saved guides…</p>
      </div>
    );
  }

  if (saved.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Bookmark className="size-12 text-ink/30" />
        <h2 className="text-lg font-medium text-ink">No saved guides yet</h2>
        <p className="text-sm text-ink/60">
          Bookmark guides from Discover and they&apos;ll appear here.
        </p>
        <Link href="/workspace/discover" className="text-sm underline">
          Open Discover →
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-medium text-ink">Saved guides</h1>
          <p className="text-sm text-ink/60">
            {saved.length} guides you&apos;ve bookmarked from Discover
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lanes</SelectItem>
              <SelectItem value="linear">Linear</SelectItem>
              <SelectItem value="adjacent">Adjacent</SelectItem>
              <SelectItem value="transformational">Transformational</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recently saved</SelectItem>
              <SelectItem value="lane">By lane</SelectItem>
              <SelectItem value="score">Match score</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <SavedGuideCard key={s.guideId} saved={s} />
        ))}
      </div>
    </>
  );
}
