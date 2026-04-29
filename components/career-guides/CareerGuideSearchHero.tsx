"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Search, ArrowRight } from "lucide-react";
import { api } from "@/convex/_generated/api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

const convexHttpOrigin = (() => {
  if (!CONVEX_URL) return null;
  // NEXT_PUBLIC_CONVEX_URL looks like https://<deployment>.convex.cloud
  // The HTTP-action origin is https://<deployment>.convex.site (same region prefix).
  return CONVEX_URL.replace(".convex.cloud", ".convex.site");
})();

const normalize = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, " ").trim();

type ValidationState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "valid"; normalizedTitle: string; slug: string | null }
  | { kind: "invalid"; reason: string }
  | { kind: "rate-limited" };

export function CareerGuideSearchHero() {
  const router = useRouter();
  const params = useSearchParams();
  const initialQuery = params.get("q") ?? "";
  const [input, setInput] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const lastValidatedRef = useRef<string>("");

  // Debounce input (500ms)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(input), 500);
    return () => clearTimeout(id);
  }, [input]);

  const debouncedNormalized = normalize(debounced);
  const shouldQueryValidation = debouncedNormalized.length >= 2;

  const validation = useQuery(
    api.careerGuides.getValidation,
    shouldQueryValidation
      ? { careerNormalized: debouncedNormalized }
      : "skip",
  );

  // Fire validation request when input is new + we don't already have a result.
  useEffect(() => {
    if (!shouldQueryValidation) return;
    if (lastValidatedRef.current === debouncedNormalized) return;
    if (!convexHttpOrigin) return;
    if (validation && validation.status !== "pending") {
      lastValidatedRef.current = debouncedNormalized;
      return;
    }
    if (validation === undefined) return; // still loading subscription
    if (validation === null) {
      lastValidatedRef.current = debouncedNormalized;
      setRateLimited(false);
      fetch(`${convexHttpOrigin}/career-guides/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ career: debounced }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json().catch(() => null)) as
            | { status?: string }
            | null;
          if (data?.status === "rate-limited") {
            setRateLimited(true);
          }
        })
        .catch((err) => {
          console.error("validate fetch failed", err);
        });
    }
  }, [debounced, debouncedNormalized, validation, shouldQueryValidation]);

  const state = useMemo<ValidationState>(() => {
    if (!shouldQueryValidation) return { kind: "idle" };
    if (rateLimited) return { kind: "rate-limited" };
    if (validation === undefined) return { kind: "checking" };
    if (validation === null) return { kind: "checking" };
    if (validation.status === "pending") return { kind: "checking" };
    if (validation.status === "valid") {
      return {
        kind: "valid",
        normalizedTitle: validation.normalizedTitle ?? debounced,
        slug: validation.slug ?? null,
      };
    }
    return {
      kind: "invalid",
      reason: validation.reason ?? "We do not recognise that as a career.",
    };
  }, [debounced, rateLimited, shouldQueryValidation, validation]);

  const onGenerate = async () => {
    if (state.kind !== "valid" || !convexHttpOrigin) return;
    setErrorMsg(null);
    setGenerating(true);
    try {
      const res = await fetch(`${convexHttpOrigin}/career-guides/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: state.normalizedTitle }),
      });
      const data = (await res.json()) as
        | { slug: string }
        | { error: string };
      if ("error" in data) {
        setErrorMsg(data.error);
        setGenerating(false);
        return;
      }
      router.push(`/career-guides/${data.slug}`);
    } catch (err) {
      console.error("generate fetch failed", err);
      setErrorMsg("Could not reach the server. Please try again.");
      setGenerating(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (state.kind === "valid") void onGenerate();
  };

  return (
    <section className="border-b border-hairline">
      <div className="mx-auto max-w-4xl px-6 py-20 text-center sm:py-28">
        <p className="type-label mb-6 text-mute">Career guides</p>
        <h1 className="type-display text-ink">
          Search <span className="text-ink-soft">any</span> career.
        </h1>
        <p className="type-body-lg mx-auto mt-6 max-w-prose text-body">
          What does the role actually involve, what does it pay, and how do
          you get in. Type a job title and we will write you a guide.
        </p>

        <form onSubmit={onSubmit} className="mx-auto mt-12 w-full max-w-2xl">
          <div className="relative flex items-center gap-2 rounded-pill border border-hairline bg-paper-raised py-2 pl-12 pr-2 transition-colors focus-within:border-hairline-strong">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-mute"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Try: marine biologist, primary school teacher, FP&A manager"
              maxLength={100}
              autoFocus
              className="type-body min-w-0 flex-1 bg-transparent py-2 text-ink placeholder:text-mute focus:outline-none"
            />
            <button
              type="submit"
              disabled={state.kind !== "valid" || generating}
              aria-label={generating ? "Generating guide" : "Generate guide"}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-ink text-paper transition-all hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-30"
            >
              {generating ? (
                <span
                  className="block h-1.5 w-1.5 animate-pulse rounded-pill bg-paper"
                  aria-hidden="true"
                />
              ) : (
                <ArrowRight
                  className="h-4 w-4"
                  aria-hidden="true"
                  strokeWidth={2}
                />
              )}
            </button>
          </div>
        </form>

        <div className="mx-auto mt-6 flex min-h-[2.5rem] max-w-2xl items-center justify-center">
          <StatusLine state={state} input={debounced} errorMsg={errorMsg} />
        </div>
      </div>
    </section>
  );
}

function StatusLine({
  state,
  input,
  errorMsg,
}: {
  state: ValidationState;
  input: string;
  errorMsg: string | null;
}) {
  if (errorMsg) {
    return <p className="type-caption text-state-error">{errorMsg}</p>;
  }
  if (state.kind === "idle") return null;
  if (state.kind === "checking") {
    return (
      <p className="type-caption inline-flex items-center gap-2 text-mute">
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-pill bg-ink-soft"
          aria-hidden="true"
        />
        Checking “{input}”…
      </p>
    );
  }
  if (state.kind === "rate-limited") {
    return (
      <p className="type-caption text-state-error">
        Too many checks from this address. Please wait a minute.
      </p>
    );
  }
  if (state.kind === "invalid") {
    return <p className="type-caption text-mute">{state.reason}</p>;
  }
  return (
    <p className="type-caption inline-flex items-center gap-2 text-body">
      Ready to write a guide for{" "}
      <span className="type-label text-ink">{state.normalizedTitle}</span>
      <ArrowRight className="h-3 w-3 text-ink" aria-hidden="true" />
    </p>
  );
}
