"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { GuideWithUrl } from "@/convex/careerGuides";
import type { Tier } from "@/convex/lib/ladders";
import { CareerGuideCard } from "./CareerGuideCard";
import { CareerGuidesByLadder } from "./CareerGuidesByLadder";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

const convexHttpOrigin = (() => {
  if (!CONVEX_URL) return null;
  return CONVEX_URL.replace(".convex.cloud", ".convex.site");
})();

const ease = [0.2, 0.65, 0.3, 1] as const;

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

type SortOption = "newest" | "alphabetical" | "ladder";

const SORT_STORAGE_KEY = "career-guides-sort-v1";

type ValidationState =
  | { phase: "idle" }
  | { phase: "checking"; careerNormalized: string }
  | {
      phase: "valid";
      careerNormalized: string;
      normalizedTitle: string;
      slug: string;
    }
  | { phase: "invalid"; reason: string }
  | { phase: "rate-limited" }
  | { phase: "error"; message: string };

const normalize = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, " ").trim();

const slugify = (s: string): string =>
  normalize(s)
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export function CareerGuidesIndexClient({
  guides,
}: {
  guides: GuideWithUrl[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  // Sort starts as "ladder" on SSR + first client render to avoid the
  // hydration mismatch that would happen if useState initialised from
  // localStorage (server has no localStorage; client read produces a
  // different value on hydration). The first effect after mount reads
  // localStorage and applies any stored preference, then later changes
  // are persisted on every change.
  // "ladder" is the editorial default, it's the framing the rest of
  // the product (Career Compass, guide pages) builds on, so the
  // catalogue lands you in the same mental model.
  const [sort, setSort] = useState<SortOption>("ladder");
  const sortHydratedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!sortHydratedRef.current) {
      sortHydratedRef.current = true;
      const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
      if (
        saved === "newest" ||
        saved === "alphabetical" ||
        saved === "ladder"
      ) {
        setSort(saved);
      }
      return;
    }
    window.localStorage.setItem(SORT_STORAGE_KEY, sort);
  }, [sort]);

  // Catalog-wide ladder context. Loaded reactively; the listing renders
  // immediately with the legacy flat grid and re-flows when this lands.
  const ladderContext = useQuery(
    api.careerLadders.listLadderContextForCatalog,
    {},
  );
  const tierByGuideSlug = useMemo(() => {
    const map = new Map<string, Tier>();
    if (!ladderContext) return map;
    for (const p of ladderContext.primaryPositions) {
      map.set(p.guideSlug, p.tier);
    }
    return map;
  }, [ladderContext]);

  const [validation, setValidation] = useState<ValidationState>({
    phase: "idle",
  });
  const [generating, setGenerating] = useState(false);
  const lastValidatedRef = useRef<string>("");

  // Reset validation synchronously when search changes, adjust-during-render.
  const [lastSearch, setLastSearch] = useState(search);
  if (search !== lastSearch) {
    setLastSearch(search);
    setValidation({ phase: "idle" });
    lastValidatedRef.current = "";
  }

  const filtered = useMemo(() => {
    let result = guides;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          (g.content?.overview ?? "").toLowerCase().includes(q),
      );
    }
    if (sort === "alphabetical") {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
    }
    return result;
  }, [guides, search, sort]);

  const count = guides.length;
  const hasSearch = search.trim().length > 0;
  const noResults = hasSearch && filtered.length === 0;
  const debouncedQuery = search.trim();
  const careerNormalized = normalize(debouncedQuery);
  const shouldQueryValidation = noResults && careerNormalized.length >= 2;

  const validationDoc = useQuery(
    api.careerGuides.getValidation,
    shouldQueryValidation ? { careerNormalized } : "skip",
  );

  // Kick off the validation request (debounced) when we don't have a doc.
  useEffect(() => {
    if (!shouldQueryValidation) return;
    if (!convexHttpOrigin) {
      setValidation({
        phase: "error",
        message: "Validation service unavailable.",
      });
      return;
    }
    if (validationDoc === undefined) return; // subscription still loading

    const id = setTimeout(() => {
      if (
        validationDoc &&
        validationDoc.status !== "pending" &&
        lastValidatedRef.current !== careerNormalized
      ) {
        lastValidatedRef.current = careerNormalized;
        return;
      }
      if (validationDoc !== null) return;
      if (lastValidatedRef.current === careerNormalized) return;
      lastValidatedRef.current = careerNormalized;
      setValidation({ phase: "checking", careerNormalized });
      fetch(`${convexHttpOrigin}/career-guides/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ career: debouncedQuery }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            setValidation({
              phase: "error",
              message: data.error ?? "Could not check that career.",
            });
            return;
          }
          const data = (await res.json().catch(() => null)) as
            | { status?: string }
            | null;
          if (data?.status === "rate-limited") {
            setValidation({ phase: "rate-limited" });
          }
        })
        .catch(() => {
          setValidation({
            phase: "error",
            message: "Could not reach the server. Please try again.",
          });
        });
    }, 500);

    return () => clearTimeout(id);
  }, [
    shouldQueryValidation,
    validationDoc,
    careerNormalized,
    debouncedQuery,
  ]);

  // Mirror reactive validation result into local state.
  useEffect(() => {
    if (!shouldQueryValidation || !validationDoc) return;
    if (validationDoc.status === "valid") {
      setValidation({
        phase: "valid",
        careerNormalized,
        normalizedTitle: validationDoc.normalizedTitle ?? debouncedQuery,
        slug: validationDoc.slug ?? slugify(debouncedQuery),
      });
    } else if (validationDoc.status === "invalid") {
      setValidation({
        phase: "invalid",
        reason:
          validationDoc.reason ??
          "We do not recognise that as a career.",
      });
    } else if (validationDoc.status === "pending") {
      setValidation({ phase: "checking", careerNormalized });
    }
  }, [validationDoc, shouldQueryValidation, careerNormalized, debouncedQuery]);

  const handleGenerate = async () => {
    if (validation.phase !== "valid" || !convexHttpOrigin) return;
    setGenerating(true);
    try {
      const res = await fetch(`${convexHttpOrigin}/career-guides/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: validation.normalizedTitle }),
      });
      const data = (await res.json()) as
        | { slug: string }
        | { error: string };
      if ("error" in data) {
        setValidation({ phase: "error", message: data.error });
        setGenerating(false);
        return;
      }
      router.push(`/career-guides/${data.slug}`);
    } catch {
      setValidation({
        phase: "error",
        message: "Could not generate guide. Please try again.",
      });
      setGenerating(false);
    }
  };

  if (count === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease }}
        className="py-16 text-center sm:py-20"
      >
        <p className={eyebrowCls}>Coming soon</p>
        <h2 className="type-headline mt-3 text-balance text-ink">
          Guides are on their way.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-balance text-[15px] leading-relaxed text-mute">
          Search a career on the home page and we will write the first one for
          you.
        </p>
        <Link
          href="/"
          className="type-label mt-8 inline-flex items-center gap-2 border-b border-ink/40 pb-0.5 text-ink transition-colors hover:border-ink"
        >
          Search a career
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </motion.div>
    );
  }

  return (
    <>
      {/* Controls */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.15, ease }}
        className="space-y-5"
      >
        <div
          className={`flex items-center gap-3 border-b transition-colors duration-300 ${
            search ? "border-hairline-strong" : "border-hairline"
          }`}
        >
          <Search
            className="h-4 w-4 shrink-0 text-mute"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && validation.phase === "valid") {
                e.preventDefault();
                void handleGenerate();
              }
            }}
            placeholder="Search guides..."
            className="flex-1 bg-transparent py-3 text-[15px] text-ink placeholder:text-mute/70 outline-none"
          />
          {hasSearch && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="p-1 text-mute transition-colors hover:text-ink"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className={eyebrowCls}>Sort</p>
            <div className="flex gap-1.5">
              {(
                [
                  { value: "ladder", label: "By ladder" },
                  { value: "newest", label: "Newest" },
                  { value: "alphabetical", label: "A - Z" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSort(opt.value)}
                  disabled={opt.value === "ladder" && !ladderContext}
                  className={`rounded-pill border px-3 py-1.5 text-[12px] tracking-wide transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10 focus-visible:ring-offset-2 disabled:opacity-50 ${
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

          <div className="flex items-center gap-3 text-[12px] text-mute">
            <span>
              {hasSearch
                ? `${filtered.length} of ${count}`
                : `${count} guide${count !== 1 ? "s" : ""}`}
            </span>
            {hasSearch && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-body underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* List */}
      <div className="border-t border-hairline pt-10">
        <AnimatePresence mode="popLayout">
          {filtered.length === 0 ? (
            <NoResultsBlock
              key="no-results"
              search={search}
              setSearch={setSearch}
              validation={validation}
              generating={generating}
              onGenerate={handleGenerate}
            />
          ) : sort === "ladder" && ladderContext ? (
            <motion.div
              key="ladder"
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.4, ease }}
            >
              <CareerGuidesByLadder
                guides={filtered}
                ladders={ladderContext.ladders}
                primaryPositions={ladderContext.primaryPositions}
              />
            </motion.div>
          ) : (
            <motion.ul
              key="grid"
              layout
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              {filtered.map((g, i) => (
                <motion.li
                  key={g.slug}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{
                    duration: 0.4,
                    delay: Math.min(i * 0.04, 0.24),
                    ease,
                  }}
                >
                  <CareerGuideCard
                    guide={g}
                    variant="medium"
                    tier={tierByGuideSlug.get(g.slug)}
                  />
                </motion.li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

const stateTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.35, ease },
};

function CheckingDots() {
  return (
    <span className="ml-0.5 inline-flex gap-[3px]">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-[3px] w-[3px] rounded-pill bg-current"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

function NoResultsBlock({
  search,
  setSearch,
  validation,
  generating,
  onGenerate,
}: {
  search: string;
  setSearch: (s: string) => void;
  validation: ValidationState;
  generating: boolean;
  onGenerate: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="py-10 text-center sm:py-14"
    >
      <AnimatePresence mode="wait">
        {(validation.phase === "idle" || search.trim().length < 2) && (
          <motion.div key="idle" {...stateTransition}>
            <p className={eyebrowCls}>No matches</p>
            <p className="type-headline mt-3 text-balance text-ink">
              Nothing matched &ldquo;{search}&rdquo;
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-mute">
              Try a different search term, or{" "}
              <button
                type="button"
                onClick={() => setSearch("")}
                className="border-b border-ink/40 text-body transition-colors hover:border-ink hover:text-ink"
              >
                clear the search
              </button>{" "}
              to see all guides.
            </p>
          </motion.div>
        )}

        {validation.phase === "checking" && (
          <motion.div key="checking" {...stateTransition}>
            <p className="text-[15px] leading-relaxed text-mute">
              Checking if &ldquo;
              <span className="font-medium text-ink">{search}</span>
              &rdquo; is a recognised career
              <CheckingDots />
            </p>
          </motion.div>
        )}

        {validation.phase === "valid" && (
          <motion.div
            key="valid"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.4, ease }}
          >
            <p className={eyebrowCls}>We know this one</p>
            <p className="type-headline mt-3 text-balance text-ink">
              {validation.normalizedTitle}
            </p>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-mute">
              We don&rsquo;t have a guide for this career yet, but we can
              create one for you right now.
            </p>
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="mt-6 inline-flex items-center gap-2 rounded-pill border border-ink bg-ink px-5 py-2.5 text-[14px] font-medium text-paper transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {generating ? "Generating…" : "Generate career guide"}
              {!generating && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
            {!generating && (
              <p className="mt-3 text-[12px] text-mute/80">or press Enter</p>
            )}
          </motion.div>
        )}

        {validation.phase === "invalid" && (
          <motion.div key="invalid" {...stateTransition}>
            <p className={eyebrowCls}>Not a career we recognise</p>
            <p className="type-headline mt-3 text-balance text-ink">
              &ldquo;{search}&rdquo;
            </p>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-mute">
              {validation.reason}
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-mute">
              Try a different search term, or{" "}
              <button
                type="button"
                onClick={() => setSearch("")}
                className="border-b border-ink/40 text-body transition-colors hover:border-ink hover:text-ink"
              >
                clear the search
              </button>{" "}
              to see all guides.
            </p>
          </motion.div>
        )}

        {validation.phase === "rate-limited" && (
          <motion.div key="rate" {...stateTransition}>
            <p className={eyebrowCls}>Slow down</p>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-mute">
              Too many checks from this address. Please wait a minute.
            </p>
          </motion.div>
        )}

        {validation.phase === "error" && (
          <motion.div key="error" {...stateTransition}>
            <p className={eyebrowCls}>Something went wrong</p>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-mute">
              {validation.message}
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-mute">
              Try a different search term, or{" "}
              <button
                type="button"
                onClick={() => setSearch("")}
                className="border-b border-ink/40 text-body transition-colors hover:border-ink hover:text-ink"
              >
                clear the search
              </button>{" "}
              to see all guides.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
