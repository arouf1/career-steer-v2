// app/workspace/calls/CallsListClient.tsx
//
// Client component for the /workspace/calls history page.
// Owns: surface filter pills, archive toggle, debounced semantic search,
// paginated browse query, archive/unarchive mutations, and all empty/loading/error states.
//
// Browse mode:  usePaginatedQuery(api.voiceCalls.listForUser, …) — live subscription
// Search mode:  useAction(api.voiceCallsSearch.searchByText) — snapshot per debounce tick
//               The paginated query is "skip"-ped while in search mode.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, usePaginatedQuery, useMutation } from "convex/react";
import { History, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CallSearchInput } from "@/components/workspace/calls/CallSearchInput";
import { InterviewRow } from "@/components/workspace/calls/InterviewRow";
import { DeepDiveRow } from "@/components/workspace/calls/DeepDiveRow";
import { CallSection } from "@/components/workspace/calls/CallSection";
import { groupCallsByDate } from "@/components/workspace/calls/groupCallsByDate";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants + types
// ---------------------------------------------------------------------------

type Surface = "guide" | "compass" | "job" | "interview_job";

const ALL_SURFACES: Surface[] = ["guide", "compass", "job", "interview_job"];

const SURFACE_LABEL: Record<Surface, string> = {
  guide: "Deep dives",
  compass: "Compass",
  job: "Job deep dives",
  interview_job: "Mock interviews",
};

const SEARCH_DEBOUNCE_MS = 350;
const STORAGE_FILTER_KEY = "calls.surfaces.v1";
const STORAGE_ARCHIVED_KEY = "calls.includeArchived.v1";

// Matches the trimmed list-row shape returned by voiceCalls.listForUser and
// voiceCallsSearch.searchByText. The client never sees raw Doc<"voice_calls">.
type ListRow = {
  _id: Id<"voice_calls">;
  surface?: Surface;
  title: string;
  totalDurationSeconds: number;
  createdAt: number;
  archivedAt?: number;
  aiSummary?: unknown;
  messagesCount: number;
  searchScore?: number;
  companyName?: string;
  companyLogoUrl?: string;
};

// ---------------------------------------------------------------------------
// localStorage helpers (safe for SSR — typeof window guard)
// ---------------------------------------------------------------------------

function readSurfaces(): Set<Surface> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_FILTER_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(
      parsed.filter((s): s is Surface => ALL_SURFACES.includes(s as Surface)),
    );
  } catch {
    return new Set();
  }
}

function readIncludeArchived(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_ARCHIVED_KEY) === "true";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CallsListClient() {
  // ── Filter state ──────────────────────────────────────────────────────────
  const [surfaces, setSurfaces] = useState<Set<Surface>>(readSurfaces);
  const [includeArchived, setIncludeArchived] = useState<boolean>(readIncludeArchived);

  // Persist to localStorage whenever they change.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_FILTER_KEY,
        JSON.stringify([...surfaces]),
      );
    } catch {}
  }, [surfaces]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_ARCHIVED_KEY, String(includeArchived));
    } catch {}
  }, [includeArchived]);

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"off" | "text">("off");
  const [searchResults, setSearchResults] = useState<ListRow[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Browse query args (memoised to keep Convex subscription stable) ───────
  const listArgs = useMemo(
    () => ({
      surfaces: surfaces.size > 0 ? ([...surfaces] as Surface[]) : undefined,
      includeArchived: includeArchived || undefined,
    }),
    [surfaces, includeArchived],
  );

  // "skip" sentinel tells usePaginatedQuery not to subscribe while we're in
  // semantic-search mode — avoids a wasted subscription running in parallel.
  const paginated = usePaginatedQuery(
    api.voiceCalls.listForUser,
    searchMode === "off" ? listArgs : "skip",
    { initialNumItems: 20 },
  );

  // ── Semantic search ───────────────────────────────────────────────────────
  const search = useAction(api.voiceCallsSearch.searchByText);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length === 0) {
        setSearchResults(null);
        setSearchError(null);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      setSearchError(null);
      try {
        const result = await search({
          query: trimmed,
          surfaces: surfaces.size > 0 ? ([...surfaces] as Surface[]) : undefined,
          includeArchived,
        });
        setSearchResults(result as ListRow[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSearchError(message);
        setSearchResults(null);
      } finally {
        setSearchLoading(false);
      }
    },
    [search, surfaces, includeArchived],
  );

  // Debounce: re-run search 350ms after query / filter / mode changes.
  // Switching mode off clears results immediately (no debounce needed).
  useEffect(() => {
    if (searchMode !== "text") {
      setSearchResults(null);
      setSearchError(null);
      setSearchLoading(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchMode, surfaces, includeArchived]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const archiveMutation = useMutation(api.voiceCalls.archive);
  const unarchiveMutation = useMutation(api.voiceCalls.unarchive);

  const handleArchive = useCallback(
    async (id: Id<"voice_calls">) => {
      await archiveMutation({ callId: id });
    },
    [archiveMutation],
  );

  const handleUnarchive = useCallback(
    async (id: Id<"voice_calls">) => {
      await unarchiveMutation({ callId: id });
    },
    [unarchiveMutation],
  );

  const toggleSurface = useCallback((s: Surface) => {
    setSurfaces((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  // ── Derived render values ─────────────────────────────────────────────────
  const usingSearch = searchMode === "text" && searchQuery.trim().length > 0;
  const rows: ListRow[] = usingSearch
    ? (searchResults ?? [])
    : (paginated.results as ListRow[]);
  const isLoading = usingSearch
    ? searchLoading
    : paginated.status === "LoadingFirstPage";
  const isLoadingMore = paginated.status === "LoadingMore";
  const canLoadMore = !usingSearch && paginated.status === "CanLoadMore";

  // Browse mode: bucket rows into Today / Yesterday / This week / Earlier so
  // the editorial section headers can render between them. Search mode skips
  // the grouping — vector-search results are ranked by relevance, not time.
  const grouped = useMemo(
    () => (usingSearch ? null : groupCallsByDate(rows)),
    [rows, usingSearch],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-mute" strokeWidth={1.75} aria-hidden />
          <h1 className="text-[24px] font-medium text-ink [font-family:var(--font-serif)]">
            Calls
          </h1>
        </div>
        <p className="text-[13px] text-mute">
          Every mock interview and deep-dive call you&apos;ve had. Search by topic or filter by type.
        </p>
      </header>

      {/* Search input */}
      <CallSearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        mode={searchMode}
        onModeChange={setSearchMode}
        placeholder="Search by topic, role, company…"
      />

      {/* Surface filter pills + archived toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          label="All"
          active={surfaces.size === 0}
          onClick={() => setSurfaces(new Set())}
        />
        {ALL_SURFACES.map((s) => (
          <FilterPill
            key={s}
            label={SURFACE_LABEL[s]}
            active={surfaces.has(s)}
            onClick={() => toggleSurface(s)}
          />
        ))}
        {/* Push archived toggle to the far right */}
        <span className="ml-auto" />
        <button
          type="button"
          onClick={() => setIncludeArchived((v) => !v)}
          aria-pressed={includeArchived}
          className={cn(
            "rounded-pill border px-3 py-1.5 text-[12px] font-medium transition-colors",
            includeArchived
              ? "border-ink bg-ink text-paper"
              : "border-hairline bg-paper text-mute hover:bg-paper-raised",
          )}
        >
          {includeArchived ? "Showing archived" : "Show archived"}
        </button>
      </div>

      {/* Search error */}
      {usingSearch && searchError && (
        <p className="text-[12px] text-rose-700" role="alert">
          Search failed: {searchError}
        </p>
      )}

      {/* List / loading / empty */}
      {isLoading ? (
        <div className="flex items-center gap-2 p-8 text-[13px] text-mute">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          usingSearch={usingSearch}
          hasFilters={surfaces.size > 0 || includeArchived}
        />
      ) : usingSearch ? (
        // Search mode: flat list, no date sections (results are ranked by
        // semantic relevance — chronological grouping would scramble the rank).
        <div className="flex flex-col divide-y divide-hairline">
          {rows.map((call) => (
            <RowDispatch
              key={call._id}
              call={call}
              onArchive={() => void handleArchive(call._id)}
              onUnarchive={() => void handleUnarchive(call._id)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col">
          {grouped?.map(({ key, rows: groupRows }) => (
            <div key={key}>
              <CallSection groupKey={key} />
              <div className="flex flex-col divide-y divide-hairline">
                {groupRows.map((call) => (
                  <RowDispatch
                    key={call._id}
                    call={call}
                    onArchive={() => void handleArchive(call._id)}
                    onUnarchive={() => void handleUnarchive(call._id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load more (browse mode only) */}
      {canLoadMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => paginated.loadMore(20)}
            disabled={isLoadingMore}
            className={cn(
              "rounded-pill border border-hairline bg-paper px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-paper-raised",
              isLoadingMore && "opacity-50",
            )}
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {/* Semantic search hint footer */}
      {usingSearch && !searchLoading && (
        <p className="text-center text-[11px] text-mute">
          <Sparkles className="inline h-3 w-3 text-mute" strokeWidth={1.75} aria-hidden />{" "}
          Semantic search — results ranked by topic similarity
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RowDispatch — picks InterviewRow vs DeepDiveRow based on surface
// ---------------------------------------------------------------------------

function RowDispatch({
  call,
  onArchive,
  onUnarchive,
}: {
  call: ListRow;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  if (call.surface === "interview_job") {
    return (
      <InterviewRow
        call={call}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
      />
    );
  }
  return (
    <DeepDiveRow
      call={call}
      onArchive={onArchive}
      onUnarchive={onUnarchive}
    />
  );
}

// ---------------------------------------------------------------------------
// FilterPill
// ---------------------------------------------------------------------------

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-pill border px-3 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "border-ink bg-ink text-paper"
          : "border-hairline bg-paper text-mute hover:bg-paper-raised",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — three branches: cold, filter-narrowed, search-narrowed
// ---------------------------------------------------------------------------

function EmptyState({
  usingSearch,
  hasFilters,
}: {
  usingSearch: boolean;
  hasFilters: boolean;
}) {
  if (usingSearch) {
    return (
      <div className="flex flex-col items-center gap-2 p-12 text-center">
        <p className="text-[14px] text-ink">No calls match your search.</p>
        <p className="text-[12px] text-mute">
          Try a different topic or clear the search.
        </p>
      </div>
    );
  }

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center gap-2 p-12 text-center">
        <p className="text-[14px] text-ink">No calls match these filters.</p>
        <p className="text-[12px] text-mute">
          Try clearing the surface filter or the archived toggle.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center">
      <p className="text-[14px] text-ink">No calls yet.</p>
      <p className="max-w-sm text-[12px] text-mute">
        Start a deep dive from any career guide, or run a mock interview from a
        saved job.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/workspace/saved-guides"
          className="rounded-pill border border-hairline bg-paper px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-paper-raised"
        >
          Browse career guides
        </Link>
        <Link
          href="/workspace/jobs"
          className="rounded-pill border border-hairline bg-paper px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-paper-raised"
        >
          Browse jobs
        </Link>
      </div>
    </div>
  );
}
