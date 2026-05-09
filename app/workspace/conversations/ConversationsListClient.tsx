// app/workspace/conversations/ConversationsListClient.tsx
//
// Client component for the /workspace/conversations history page.
// Owns: surface filter pills, archive toggle, debounced semantic search,
// paginated browse query, archive/unarchive mutations, and all empty/loading/error states.
//
// Browse mode:  usePaginatedQuery(api.voiceCalls.listForUser, …) — live subscription
// Search mode:  useAction(api.voiceCallsSearch.searchByText) — snapshot per debounce tick
//               The paginated query is "skip"-ped while in search mode.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, usePaginatedQuery, useMutation } from "convex/react";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InterviewRow } from "@/components/workspace/conversations/InterviewRow";
import { DeepDiveRow } from "@/components/workspace/conversations/DeepDiveRow";
import { ConversationSection } from "@/components/workspace/conversations/ConversationSection";
import { groupConversationsByDate } from "@/components/workspace/conversations/groupConversationsByDate";
import { WorkspacePageHeader } from "@/components/workspace/WorkspacePageHeader";
import { WorkspaceLoadingRows } from "@/components/workspace/WorkspaceLoading";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants + types
// ---------------------------------------------------------------------------

type Surface = "guide" | "compass" | "job" | "interview_job";

const ALL_SURFACES: Surface[] = ["guide", "compass", "job", "interview_job"];

const SURFACE_LABEL: Record<Surface, string> = {
  guide: "Career deep dives",
  compass: "Compass",
  job: "Job deep dives",
  interview_job: "Mock interviews",
};

const SEARCH_DEBOUNCE_MS = 350;
// LocalStorage keys intentionally unchanged — changing them would silently
// reset users' filter preferences with no benefit.
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

export function ConversationsListClient() {
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
  // Simplified to a single searchQuery — a non-empty value always runs semantic
  // search; empty falls back to the paginated browse. No mode toggle needed.
  const [searchQuery, setSearchQuery] = useState("");
  const [queryFocused, setQueryFocused] = useState(false);
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

  // Derived: whether we're currently in search mode.
  const usingSearch = searchQuery.trim().length > 0;

  // "skip" sentinel tells usePaginatedQuery not to subscribe while we're in
  // semantic-search mode — avoids a wasted subscription running in parallel.
  const paginated = usePaginatedQuery(
    api.voiceCalls.listForUser,
    usingSearch ? "skip" : listArgs,
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

  // Debounce: re-run search 350ms after query / filter changes.
  // When query is cleared, results are wiped immediately (no debounce needed).
  useEffect(() => {
    if (!usingSearch) {
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
  }, [searchQuery, surfaces, includeArchived]);

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
    () => (usingSearch ? null : groupConversationsByDate(rows)),
    [rows, usingSearch],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-8">
      <WorkspacePageHeader
        eyebrow="Conversations"
        title="Every back-and-forth, kept."
        lede="Mock interviews and deep-dive conversations you've had. Search by topic or filter by type."
      />

      {/* Search input — editorial underline pattern (matches jobs page) */}
      <div>
        <span className="type-label mb-3 block uppercase text-mute">Search</span>
        <div
          className={
            queryFocused
              ? "relative flex items-center gap-3 border-b border-ink/40 transition-colors duration-300"
              : "relative flex items-center gap-3 border-b border-hairline-strong transition-colors duration-300"
          }
        >
          <Search className="size-4 shrink-0 text-mute" strokeWidth={1.75} aria-hidden />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setQueryFocused(true)}
            onBlur={() => setQueryFocused(false)}
            placeholder="Search by topic, role, company…"
            aria-label="Search conversations"
            className="flex-1 bg-transparent py-3 text-[15px] text-ink placeholder:text-mute focus:outline-none"
            maxLength={200}
            autoComplete="off"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="-mr-2 grid size-10 place-items-center rounded-pill text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

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
        <WorkspaceLoadingRows />
      ) : rows.length === 0 ? (
        <div className="fade-in-view">
          <EmptyState
            usingSearch={usingSearch}
            hasFilters={surfaces.size > 0 || includeArchived}
          />
        </div>
      ) : usingSearch ? (
        // Search mode: flat list, no date sections (results are ranked by
        // semantic relevance — chronological grouping would scramble the rank).
        <div className="fade-in-view flex flex-col divide-y divide-hairline">
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
        <div className="fade-in-view flex flex-col">
          {grouped?.map(({ key, rows: groupRows }) => (
            <div key={key}>
              <ConversationSection groupKey={key} />
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
          Showing matches by topic similarity.
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
        <p className="text-[14px] text-ink">No conversations match your search.</p>
        <p className="text-[12px] text-mute">
          Try a different topic or clear the search.
        </p>
      </div>
    );
  }

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center gap-2 p-12 text-center">
        <p className="text-[14px] text-ink">No conversations match these filters.</p>
        <p className="text-[12px] text-mute">
          Try clearing the surface filter or the archived toggle.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center">
      <p className="text-[14px] text-ink">No conversations yet.</p>
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
