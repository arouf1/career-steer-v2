// app/workspace/jobs/JobSearchClient.tsx
"use client";

// Editorial restoration of v2's job search. The earlier grid + debug-telemetry
// + truncated-title shape was killed in /critique. This file replaces it with
// a row-based listing that ports V1's JobCard pattern into v2's tokens, plus
// filters / sort / saved-jobs / honest fit-score ranking. See the critique
// thread on 2026-05-04 for the design-spec context.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Authenticated, AuthLoading, useAction, useQuery } from "convex/react";
import { ArrowRight, Search, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { JobCardRow } from "@/components/jobs/JobCardRow";
import { WorkspacePageHeader } from "@/components/workspace/WorkspacePageHeader";
import {
  WorkspaceLoadingHeader,
  WorkspaceLoadingRows,
} from "@/components/workspace/WorkspaceLoading";
import {
  LocationCombobox,
  type LocationSelection,
} from "@/components/profile/LocationCombobox";
import type { JobResult, SearchResult } from "@/convex/jobSearch";
import type { Id } from "@/convex/_generated/dataModel";

export type LiveContent = {
  contentStatus: "pending" | "generating" | "complete" | "failed";
  overview: string | null;
};

type Status = "idle" | "loading" | "loadingMore" | "error";
type SortKey = "relevance" | "newest";

type SearchSnapshot = {
  query: string;
  location: string | undefined;
  gl: string | undefined;
  skipCorrection?: boolean;
};

export function JobSearchClient() {
  return (
    <>
      <AuthLoading>
        <div className="flex flex-col gap-12">
          <WorkspaceLoadingHeader />
          <WorkspaceLoadingRows />
        </div>
      </AuthLoading>
      <Authenticated>
        <JobSearchClientInner />
      </Authenticated>
    </>
  );
}

function JobSearchClientInner() {
  const profile = useQuery(api.profiles.current);
  const search = useAction(api.jobSearch.search);
  const savedSet = useQuery(api.savedJobs.mySavedSet);

  const router = useRouter();
  const searchParams = useSearchParams();

  // URL is the source of truth for "what is currently being displayed".
  //
  // Two layers, with different write semantics:
  //   - Search identity (q, loc, gl): an explicit user submission. Pushed via
  //     router.push so the back button steps between distinct searches. This
  //     is the *expensive* layer, every URL with a `q` triggers a paid call.
  //   - View options (remote, sched, sort): purely client-side filtering of
  //     the in-memory result set. Replaced (not pushed) so the back button
  //     restores the view of the same search rather than a new one.
  //
  // Local state is only used for input fields-mid-edit (so typing into the
  // query box doesn't fire a paid search on every keystroke) and for results
  // / meta / pagination state derived from the action call.
  const urlQ = searchParams.get("q") ?? "";
  const urlLoc = searchParams.get("loc") ?? "";
  const urlGl = searchParams.get("gl") ?? "";
  const urlRemote = searchParams.get("remote") === "1";
  const urlSched = searchParams.get("sched");
  const urlSort: SortKey =
    searchParams.get("sort") === "newest" ? "newest" : "relevance";

  const [query, setQuery] = useState(urlQ);
  const [queryFocused, setQueryFocused] = useState(false);
  const [location, setLocation] = useState<string | null>(urlLoc || null);
  const [gl, setGl] = useState<string | null>(urlGl || null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<JobResult[] | null>(null);
  const [meta, setMeta] = useState<{
    detectedLocation: string | null;
    fromCache: boolean;
    originalQuery: string;
    correctedQuery: string | null;
  } | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [activeSearch, setActiveSearch] = useState<SearchSnapshot | null>(null);

  // Tracks the most recent runSearch invocation so a stale in-flight call
  // can't clobber a newer result if the user submits twice quickly or
  // back-navigates while a search is loading.
  const requestIdRef = useRef(0);

  // Mirror of activeSearch for use inside the URL-driven firing effect's
  // short-circuit check, without putting activeSearch in the effect deps
  // (which would re-fire on every setActiveSearch and loop).
  const activeSearchRef = useRef<SearchSnapshot | null>(null);

  // Sync inputs and clear stale results when the URL identity changes
  // externally (back-nav, deep link, or our own router.push). React's
  // "store info from previous render" pattern, setState during render is
  // explicitly recommended here over an effect, since it avoids a wasted
  // render cycle and prevents the cascading-effect anti-pattern.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevUrlIdentity, setPrevUrlIdentity] = useState({
    q: urlQ,
    loc: urlLoc,
    gl: urlGl,
  });
  if (
    prevUrlIdentity.q !== urlQ ||
    prevUrlIdentity.loc !== urlLoc ||
    prevUrlIdentity.gl !== urlGl
  ) {
    setPrevUrlIdentity({ q: urlQ, loc: urlLoc, gl: urlGl });
    setQuery(urlQ);
    setLocation(urlLoc || null);
    setGl(urlGl || null);
    if (!urlQ) {
      // URL emptied out, clear displayed results so back-nav to a bare
      // /workspace/jobs lands on the empty-state instead of stale results.
      // The matching requestId bump lives in a dedicated effect below; this
      // block can't touch a ref during render.
      setResults(null);
      setMeta(null);
      setActiveSearch(null);
      setNextPageToken(null);
      setStatus("idle");
      setErrorMessage(null);
    }
  }

  // Whenever the URL identity changes, invalidate any in-flight runSearch
  // so its post-await handler skips the setResults call. Pairs with the
  // during-render clearing block above. Refs aren't allowed during render
  // but are fine here.
  useEffect(() => {
    requestIdRef.current++;
  }, [urlQ, urlLoc, urlGl]);

  // Seed the location field from the profile, but only if the URL didn't
  // already specify one. URL wins, a shared link should land where it says.
  // Same during-render sync pattern as above.
  const [profileSeeded, setProfileSeeded] = useState(false);
  if (!profileSeeded && profile !== undefined) {
    setProfileSeeded(true);
    if (!urlLoc && profile?.location && location === null) {
      setLocation(profile.location);
    }
  }

  const onLocationSelect = (item: LocationSelection) => {
    setLocation(item.canonicalName);
    setGl(item.countryCode);
  };

  const onLocationChange = (next: string | null) => {
    setLocation(next);
    setGl(null);
  };

  const isBusy = status === "loading" || status === "loadingMore";
  const canSubmit = query.trim().length > 0 && !isBusy;

  const runSearch = useCallback(
    async (snapshot: SearchSnapshot) => {
      const myId = ++requestIdRef.current;
      activeSearchRef.current = snapshot;
      setStatus("loading");
      setErrorMessage(null);
      setNextPageToken(null);
      setActiveSearch(snapshot);

      const result: SearchResult = await search(snapshot);

      // A newer search has been kicked off, drop this result.
      if (myId !== requestIdRef.current) return;

      if (result.ok) {
        setResults(result.jobs);
        setMeta({
          detectedLocation: result.detectedLocation,
          fromCache: result.fromCache,
          originalQuery: result.originalQuery,
          correctedQuery: result.correctedQuery,
        });
        // If the corrector rewrote the query, snap the input to the corrected
        // form so subsequent edits start from there. URL keeps the original
        // (what the user actually submitted), the banner provides the
        // disambiguation and lets them re-search the original.
        if (result.correctedQuery) setQuery(result.correctedQuery);
        setNextPageToken(result.nextPageToken);
        setStatus("idle");
        return;
      }

      setStatus("error");
      setResults(null);
      setMeta(null);
      activeSearchRef.current = null;
      setActiveSearch(null);
      setErrorMessage(
        result.error === "empty_query"
          ? "Type a search query and try again."
          : (result.message ?? "Search failed. Try again."),
      );
    },
    [search],
  );

  // Drive search firing off URL changes. Handles both fresh user submissions
  // (via router.push from onSubmit) and external URL changes (back-nav,
  // direct/shared link entry). The activeSearch comparison prevents
  // re-firing when only view-option params changed. Clearing of results when
  // urlQ empties out is handled in the during-render sync block above.
  useEffect(() => {
    if (!urlQ) return;
    const snapshot: SearchSnapshot = {
      query: urlQ,
      location: urlLoc || undefined,
      gl: urlGl || undefined,
    };
    const cur = activeSearchRef.current;
    if (
      cur &&
      cur.query === snapshot.query &&
      cur.location === snapshot.location &&
      cur.gl === snapshot.gl
    ) {
      return;
    }
    void runSearch(snapshot);
  }, [urlQ, urlLoc, urlGl, runSearch]);

  const writeUrl = useCallback(
    (
      changes: Record<string, string | null>,
      mode: "push" | "replace" = "replace",
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      const url =
        params.size > 0 ? `?${params.toString()}` : "/workspace/jobs";
      if (mode === "push") {
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
    },
    [router, searchParams],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const trimmedQ = query.trim();
    const trimmedLoc = location?.trim() ?? "";
    writeUrl(
      {
        q: trimmedQ,
        loc: trimmedLoc || null,
        gl: gl ?? null,
      },
      "push",
    );
  };

  const onSearchOriginal = (originalQuery: string) => {
    if (isBusy) return;
    setQuery(originalQuery);
    // The skipCorrection flag is a one-off, we don't want to encode it in
    // the URL (it wouldn't survive a refresh sensibly), so fire the search
    // directly here. URL updates to reflect the original query so the back
    // button still works.
    writeUrl({ q: originalQuery }, "push");
    void runSearch({
      query: originalQuery,
      location: location?.trim() ? location.trim() : undefined,
      gl: gl ?? undefined,
      skipCorrection: true,
    });
  };

  // View-option setters: write to URL via replace, no paid call triggered.
  const setRemoteOnly = useCallback(
    (next: boolean) => {
      writeUrl({ remote: next ? "1" : null });
    },
    [writeUrl],
  );
  const setScheduleFilter = useCallback(
    (next: string | null) => {
      writeUrl({ sched: next });
    },
    [writeUrl],
  );
  const setSortKey = useCallback(
    (next: SortKey) => {
      writeUrl({ sort: next === "newest" ? "newest" : null });
    },
    [writeUrl],
  );
  const clearFilters = useCallback(() => {
    writeUrl({ remote: null, sched: null });
  }, [writeUrl]);

  const onLoadMore = async () => {
    if (!nextPageToken || !activeSearch || isBusy) return;
    setStatus("loadingMore");
    setErrorMessage(null);

    const result: SearchResult = await search({
      ...activeSearch,
      nextPageToken,
    });

    if (result.ok) {
      // Dedupe across pages. Prefer dedupKey when present (the cache stamps
      // it on every result); fall back to the content fingerprint otherwise.
      setResults((prev) => {
        const base = prev ?? [];
        const fingerprintOf = (j: JobResult) =>
          j.dedupKey ??
          `${j.title}::${j.companyName ?? ""}::${j.applyLink ?? ""}`;
        const seen = new Set(base.map(fingerprintOf));
        const fresh = result.jobs.filter((j) => !seen.has(fingerprintOf(j)));
        return [...base, ...fresh];
      });
      setNextPageToken(result.nextPageToken);
      setStatus("idle");
      return;
    }

    setStatus("error");
    setErrorMessage(result.message ?? "Loading more results failed.");
  };

  // Derive filter/sort applied results.
  const visibleResults = useMemo(() => {
    if (!results) return null;
    let list = results;
    if (urlRemote) list = list.filter((r) => r.workFromHome === true);
    if (urlSched) list = list.filter((r) => r.schedule === urlSched);
    if (urlSort === "newest") {
      // Stable sort by postedAt descending. SearchAPI's postedAt is a
      // human string ("3 days ago"), we sort on a normalised numeric
      // approximation so the ordering is sensible without a parser.
      const score = (s: string | null): number => {
        if (!s) return -Infinity;
        const m = s.match(/(\d+)\s*(hour|day|week|month|year)/i);
        if (!m) return 0;
        const n = Number(m[1]);
        switch (m[2].toLowerCase()) {
          case "hour":
            return -n;
          case "day":
            return -n * 24;
          case "week":
            return -n * 24 * 7;
          case "month":
            return -n * 24 * 30;
          case "year":
            return -n * 24 * 365;
          default:
            return 0;
        }
      };
      list = [...list].sort((a, b) => score(b.postedAt) - score(a.postedAt));
    }
    return list;
  }, [results, urlRemote, urlSched, urlSort]);

  const scheduleOptions = useMemo(() => {
    if (!results) return [];
    const seen = new Set<string>();
    for (const r of results) {
      if (r.schedule && r.schedule.trim().length > 0) seen.add(r.schedule);
    }
    return Array.from(seen).sort();
  }, [results]);

  // Saved-set is a Set<string> for O(1) membership; null when signed out.
  const savedSetMemo = useMemo(() => {
    if (savedSet === undefined || savedSet === null) return null;
    return new Set<string>(savedSet);
  }, [savedSet]);

  // Live content subscription. The action returns the raw SearchAPI
  // description as a placeholder; the LLM rewrite (overview, theRole, etc)
  // lands ~30s later via _markContentComplete. Subscribing to this query
  // means cards swap in the polished overview the moment it completes,
  // without a refresh.
  const liveContentIds = useMemo<Id<"job_postings">[]>(() => {
    if (!results) return [];
    return results
      .map((r) => r.jobPostingId)
      .filter((id): id is Id<"job_postings"> => id !== null);
  }, [results]);

  const liveContentArgs = useMemo(
    () =>
      liveContentIds.length > 0
        ? ({ ids: liveContentIds } as const)
        : "skip",
    [liveContentIds],
  );

  const liveContentRows = useQuery(
    api.jobPostings.liveContentByIds,
    liveContentArgs,
  );

  const liveContentMap = useMemo<ReadonlyMap<string, LiveContent>>(() => {
    const map = new Map<string, LiveContent>();
    if (!liveContentRows) return map;
    for (const row of liveContentRows) {
      map.set(row.jobPostingId, {
        contentStatus: row.contentStatus,
        overview: row.overview,
      });
    }
    return map;
  }, [liveContentRows]);

  const filtersActive = urlRemote || urlSched !== null;

  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      <WorkspacePageHeader
        eyebrow="Discover roles"
        title={
          <>
            Find what&apos;s{" "}
            <span className="text-ink-soft">out there for you.</span>
          </>
        }
        lede={
          profile?.headline
            ? "Search across the web and we'll order results by how well they fit your background. Save anything that catches your eye."
            : "Search across the web for roles that match what you're looking for. Build out your profile to get personalised ordering."
        }
      />

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div>
          <span className="type-label mb-3 block uppercase text-mute">
            Role
          </span>
          <div
            className={
              queryFocused
                ? "relative flex items-center gap-3 border-b border-ink/40 transition-colors duration-300"
                : "relative flex items-center gap-3 border-b border-hairline-strong transition-colors duration-300"
            }
          >
            <Search
              className="size-4 shrink-0 text-mute"
              strokeWidth={1.75}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setQueryFocused(true)}
              onBlur={() => setQueryFocused(false)}
              placeholder="e.g. Senior Product Designer, Data Engineer, Marketing Manager…"
              className="flex-1 bg-transparent py-3 text-[15px] text-ink placeholder:text-mute focus:outline-none"
              maxLength={200}
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="-mr-2 grid size-10 place-items-center rounded-pill text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>

        <div>
          <span className="type-label mb-3 block uppercase text-mute">
            Location
          </span>
          <LocationCombobox
            value={location}
            onChange={onLocationChange}
            onSelect={onLocationSelect}
            placeholder="City, country"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canSubmit}
            className={
              canSubmit
                ? "inline-flex items-center gap-2 rounded-pill bg-ink px-5 py-2.5 text-[13px] font-medium tracking-wide text-paper transition-colors duration-300 hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                : "inline-flex cursor-not-allowed items-center gap-2 rounded-pill px-5 py-2.5 text-[13px] font-medium tracking-wide text-mute"
            }
          >
            {status === "loading" ? "Searching…" : "Search"}
            <ArrowRight className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </form>

      <ResultsRegion
        status={status}
        errorMessage={errorMessage}
        rawResults={results}
        visibleResults={visibleResults}
        meta={meta}
        nextPageToken={nextPageToken}
        onLoadMore={onLoadMore}
        onSearchOriginal={onSearchOriginal}
        scheduleOptions={scheduleOptions}
        scheduleFilter={urlSched}
        setScheduleFilter={setScheduleFilter}
        remoteOnly={urlRemote}
        setRemoteOnly={setRemoteOnly}
        sortKey={urlSort}
        setSortKey={setSortKey}
        filtersActive={filtersActive}
        clearFilters={clearFilters}
        savedSet={savedSetMemo}
        liveContent={liveContentMap}
      />
    </div>
  );
}

function ResultsRegion(props: {
  status: Status;
  errorMessage: string | null;
  rawResults: JobResult[] | null;
  visibleResults: JobResult[] | null;
  meta: {
    detectedLocation: string | null;
    fromCache: boolean;
    originalQuery: string;
    correctedQuery: string | null;
  } | null;
  nextPageToken: string | null;
  onLoadMore: () => void;
  onSearchOriginal: (originalQuery: string) => void;
  scheduleOptions: string[];
  scheduleFilter: string | null;
  setScheduleFilter: (next: string | null) => void;
  remoteOnly: boolean;
  setRemoteOnly: (next: boolean) => void;
  sortKey: SortKey;
  setSortKey: (next: SortKey) => void;
  filtersActive: boolean;
  clearFilters: () => void;
  savedSet: ReadonlySet<string> | null;
  liveContent: ReadonlyMap<string, LiveContent>;
}) {
  const {
    status,
    errorMessage,
    rawResults,
    visibleResults,
    meta,
    nextPageToken,
    onLoadMore,
    onSearchOriginal,
    scheduleOptions,
    scheduleFilter,
    setScheduleFilter,
    remoteOnly,
    setRemoteOnly,
    sortKey,
    setSortKey,
    filtersActive,
    clearFilters,
    savedSet,
    liveContent,
  } = props;

  if (status === "loading") {
    // Honest single-stage loader, v2's search is synchronous (1-3s), so
    // V1's six-step pipeline progress would be theatre. A hairline
    // indeterminate progress bar paired with one labelled verb keeps the
    // surface restrained and truthful.
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <div className="flex items-center gap-3">
          <span className="size-2 shrink-0 animate-pulse rounded-pill bg-ink/50" />
          <span className="type-label uppercase text-mute">
            Searching live listings…
          </span>
        </div>
        <div className="h-px w-full overflow-hidden bg-hairline">
          <div className="h-px w-1/3 animate-[shimmer_1.4s_ease-in-out_infinite] bg-ink/40" />
        </div>
        <style jsx>{`
          @keyframes shimmer {
            0% {
              transform: translateX(-100%);
            }
            100% {
              transform: translateX(400%);
            }
          }
        `}</style>
      </div>
    );
  }

  if (
    status === "error" &&
    errorMessage &&
    (rawResults === null || rawResults.length === 0)
  ) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-2 size-1.5 shrink-0 rounded-pill bg-ink-deep" />
          <div>
            <p className="text-[15px] text-ink/85">That search didn&apos;t work out.</p>
            <p className="mt-1 text-[14px] text-ink/55">{errorMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  if (rawResults === null) {
    return (
      <div className="py-8 text-center">
        <p className="text-[14px] text-ink/40">
          Type a role and location above to get started.
        </p>
      </div>
    );
  }

  if (rawResults.length === 0) {
    return (
      <div className="fade-in-view py-12 text-center">
        <p className="text-[15px] text-ink/55">
          No matching roles found. Try broadening your search or changing the
          location.
        </p>
      </div>
    );
  }

  const visible = visibleResults ?? rawResults;
  const totalCount = rawResults.length;
  const visibleCount = visible.length;

  return (
    <div className="fade-in-view flex flex-col gap-6">
      {meta?.correctedQuery && (
        <p className="text-[14px] text-ink/80">
          Showing results for{" "}
          <span className="font-medium text-ink">{meta.correctedQuery}</span>.{" "}
          <button
            type="button"
            onClick={() => onSearchOriginal(meta.originalQuery)}
            className="text-ink/60 underline-offset-2 hover:text-ink hover:underline"
          >
            Search instead for {meta.originalQuery}
          </button>
        </p>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="type-label uppercase text-mute">
            {visibleCount === totalCount
              ? `${totalCount} ${totalCount === 1 ? "role" : "roles"}`
              : `${visibleCount} of ${totalCount} ${totalCount === 1 ? "role" : "roles"}`}
            {meta?.detectedLocation && (
              <span className="text-mute"> · near {meta.detectedLocation}</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <span className="type-label uppercase text-mute">Sort</span>
            <button
              type="button"
              onClick={() => setSortKey("relevance")}
              aria-pressed={sortKey === "relevance"}
              className={
                sortKey === "relevance"
                  ? "relative rounded-pill bg-paper-raised px-3 py-1 text-[12px] font-medium text-ink before:absolute before:-inset-2 before:content-['']"
                  : "relative rounded-pill px-3 py-1 text-[12px] font-medium text-mute transition-colors before:absolute before:-inset-2 before:content-[''] hover:text-ink"
              }
            >
              Relevance
            </button>
            <button
              type="button"
              onClick={() => setSortKey("newest")}
              aria-pressed={sortKey === "newest"}
              className={
                sortKey === "newest"
                  ? "relative rounded-pill bg-paper-raised px-3 py-1 text-[12px] font-medium text-ink before:absolute before:-inset-2 before:content-['']"
                  : "relative rounded-pill px-3 py-1 text-[12px] font-medium text-mute transition-colors before:absolute before:-inset-2 before:content-[''] hover:text-ink"
              }
            >
              Newest
            </button>
          </div>
        </div>

        {(scheduleOptions.length > 0 || true) && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setRemoteOnly(!remoteOnly)}
              aria-pressed={remoteOnly}
              className={
                remoteOnly
                  ? "relative rounded-pill border border-ink/30 bg-ink/5 px-3 py-1 text-[12px] font-medium text-ink before:absolute before:-inset-2 before:content-['']"
                  : "relative rounded-pill border border-hairline px-3 py-1 text-[12px] font-medium text-mute transition-colors before:absolute before:-inset-2 before:content-[''] hover:border-ink/30 hover:text-ink"
              }
            >
              Remote
            </button>
            {scheduleOptions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() =>
                  setScheduleFilter(scheduleFilter === s ? null : s)
                }
                aria-pressed={scheduleFilter === s}
                className={
                  scheduleFilter === s
                    ? "relative rounded-pill border border-ink/30 bg-ink/5 px-3 py-1 text-[12px] font-medium text-ink before:absolute before:-inset-2 before:content-['']"
                    : "relative rounded-pill border border-hairline px-3 py-1 text-[12px] font-medium text-mute transition-colors before:absolute before:-inset-2 before:content-[''] hover:border-ink/30 hover:text-ink"
                }
              >
                {s}
              </button>
            ))}
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="relative ml-1 inline-flex items-center gap-1 px-2 py-1 text-[12px] text-mute transition-colors before:absolute before:-inset-2 before:content-[''] hover:text-ink"
              >
                <X className="size-3" strokeWidth={1.75} />
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-[14px] text-ink/55">
            None of the {totalCount} results match those filters.
          </p>
        </div>
      ) : (
        <div className="border-t border-hairline">
          {visible.map((job, i) => (
            <JobCardRow
              key={
                job.dedupKey ??
                `${job.title}::${job.companyName ?? ""}::${job.applyLink ?? i}`
              }
              job={job}
              index={i}
              isSavedSet={savedSet}
              isSignedIn={savedSet !== null}
              liveContent={
                job.jobPostingId ? liveContent.get(job.jobPostingId) : undefined
              }
            />
          ))}
        </div>
      )}

      <div className="flex justify-center pt-2">
        {nextPageToken ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={status === "loadingMore"}
            className="rounded-pill border border-hairline-strong px-4 py-2 text-[13px] font-medium text-ink/70 transition-colors hover:border-ink/30 hover:text-ink disabled:opacity-60"
          >
            {status === "loadingMore" ? "Loading…" : "Load more"}
          </button>
        ) : (
          <p className="type-label uppercase text-mute">No more results</p>
        )}
      </div>

      {status === "error" && errorMessage && (
        <div className="flex items-start gap-3">
          <span className="mt-2 size-1.5 shrink-0 rounded-pill bg-ink-deep" />
          <p className="text-[14px] text-ink/70">{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
