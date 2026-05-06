"use client";

// Filter bar for /jobs. Holds free-text query + city, drives the URL directly
// so the page stays server-rendered and crawlable. Free-text typing debounces
// (cheap-but-not-free Convex query); city selection is discrete so it applies
// immediately. URL is updated via router.replace to avoid polluting history
// with intermediate keystroke states — back-button restores the last
// deliberately-navigated state (e.g. clicking pagination), not every typed char.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { LocationCombobox } from "@/components/profile/LocationCombobox";

type Props = {
  initialQ: string;
  initialCity: string;
};

const fieldCls =
  "w-full rounded-control border border-hairline bg-paper px-4 py-3 text-[14px] text-ink placeholder:text-mute focus:border-ink focus:outline-none";

const QUERY_DEBOUNCE_MS = 250;

export function JobsFiltersBar({ initialQ, initialCity }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(initialQ);
  const [city, setCity] = useState<string | null>(initialCity || null);

  // Tracks the last URL we applied so the debounced effect doesn't fire a
  // redundant replace when re-rendering with identical state (e.g. on initial
  // mount, or when the city change handler has already pushed the same value).
  const lastAppliedRef = useRef<{ q: string; city: string }>({
    q: initialQ,
    city: initialCity,
  });

  const apply = useCallback(
    (nextQ: string, nextCity: string) => {
      if (
        lastAppliedRef.current.q === nextQ &&
        lastAppliedRef.current.city === nextCity
      ) {
        return;
      }
      lastAppliedRef.current = { q: nextQ, city: nextCity };

      const params = new URLSearchParams();
      if (nextQ) params.set("q", nextQ);
      if (nextCity) params.set("city", nextCity);
      const url = params.size > 0 ? `/jobs?${params.toString()}` : "/jobs";
      startTransition(() => {
        router.replace(url, { scroll: false });
      });
    },
    [router],
  );

  // Debounce free-text query changes. City is included in deps so the
  // captured closure stays fresh — when both q and city change in quick
  // succession, the timer fires with the latest values rather than reverting
  // to a stale snapshot. Redundant firings no-op via lastAppliedRef.
  useEffect(() => {
    const t = setTimeout(() => {
      apply(q.trim(), city?.trim() ?? "");
    }, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, city, apply]);

  const handleCityChange = (next: string | null) => {
    setCity(next);
    // Combobox selection is a discrete event — apply without waiting for the
    // debounce so the result update feels instant.
    apply(q.trim(), next?.trim() ?? "");
  };

  const handleSubmit = (e: React.FormEvent) => {
    // Enter bypasses any pending debounce and applies immediately.
    e.preventDefault();
    apply(q.trim(), city?.trim() ?? "");
  };

  const handleClear = () => {
    setQ("");
    setCity(null);
    apply("", "");
  };

  const hasFilters = !!q.trim() || !!city?.trim();

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <div className="relative flex-1">
        <Search
          className={
            pending
              ? "pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 animate-pulse text-ink/60 transition-colors"
              : "pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-mute transition-colors"
          }
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or company"
          aria-label="Search title or company"
          className={`${fieldCls} appearance-none pl-10 pr-10 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none`}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-pill text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="sm:w-72">
        <LocationCombobox
          value={city}
          onChange={handleCityChange}
          placeholder="Anywhere"
          className={fieldCls}
        />
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={handleClear}
          className="-mx-2 -my-2 inline-flex items-center px-2 py-2 text-[13px] text-mute underline-offset-2 transition-colors hover:text-ink hover:underline focus-visible:outline-none focus-visible:underline sm:shrink-0"
        >
          Clear
        </button>
      )}
    </form>
  );
}
