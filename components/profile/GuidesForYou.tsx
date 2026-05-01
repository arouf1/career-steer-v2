"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { GuideMatchSummary } from "@/convex/matching";

type GuideLens = "mirror" | "stretch" | "adjacent";

const LENSES: Array<{
  id: GuideLens;
  label: string;
  hint: string;
}> = [
  {
    id: "mirror",
    label: "For who you are now",
    hint: "Roles aligned with what you're already doing",
  },
  {
    id: "stretch",
    label: "Where you could go",
    hint: "Roles your trajectory points toward next",
  },
  {
    id: "adjacent",
    label: "Skill-adjacent",
    hint: "Roles that share your skill domain",
  },
];

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; guides: GuideMatchSummary[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function GuidesForYou() {
  const [lens, setLens] = useState<GuideLens>("mirror");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const guidesForMe = useAction(api.matching.guidesForMe);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    guidesForMe({ lens, limit: 8 })
      .then((guides) => {
        if (cancelled) return;
        if (guides.length === 0) setStatus({ kind: "empty" });
        else setStatus({ kind: "ready", guides });
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Something went wrong.";
        setStatus({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [lens, guidesForMe]);

  const lensHint = useMemo(
    () => LENSES.find((l) => l.id === lens)?.hint ?? "",
    [lens],
  );

  return (
    <section
      aria-labelledby="guides-for-you-heading"
      className="flex flex-col gap-6 rounded-card border border-hairline bg-paper-raised p-6 lg:p-8"
    >
      <header className="flex flex-col gap-2">
        <p className="type-label uppercase text-mute">Guides for you</p>
        <h2 id="guides-for-you-heading" className="type-headline text-ink">
          Careers worth a closer look
        </h2>
        <p className="type-body text-body max-w-prose">{lensHint}</p>
      </header>

      <div
        role="tablist"
        aria-label="Match lens"
        className="flex flex-wrap gap-2"
      >
        {LENSES.map((l) => {
          const active = l.id === lens;
          return (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setLens(l.id)}
              className={`type-label inline-flex min-h-11 items-center rounded-pill border px-5 py-3 transition-colors ${
                active
                  ? "border-ink bg-ink text-paper"
                  : "border-hairline bg-paper text-body hover:border-hairline-strong"
              }`}
            >
              {l.label}
            </button>
          );
        })}
      </div>

      <GuidesContent status={status} />
    </section>
  );
}

function GuidesContent({ status }: { status: Status }) {
  if (status.kind === "idle" || status.kind === "loading") {
    return <GuidesSkeleton />;
  }
  if (status.kind === "empty") {
    return (
      <p className="type-body text-mute">
        Once your profile finishes processing, we&rsquo;ll surface guides
        matched to your shape here.
      </p>
    );
  }
  if (status.kind === "error") {
    return (
      <p className="type-body text-body">
        We couldn&rsquo;t load guides right now. Try again in a moment.
      </p>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {status.guides.map((g) => (
        <li key={g.slug} className="h-full">
          <GuideCard guide={g} />
        </li>
      ))}
    </ul>
  );
}

function GuideCard({ guide }: { guide: GuideMatchSummary }) {
  return (
    <Link
      href={`/career-guides/${guide.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-hairline bg-paper transition-colors hover:border-hairline-strong"
    >
      <div className="aspect-[16/9] w-full overflow-hidden bg-paper-raised">
        {guide.illustrationUrl ? (
          <Image
            src={guide.illustrationUrl}
            alt={`Illustration for ${guide.title}`}
            width={640}
            height={360}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-paper-raised" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="type-title text-ink">{guide.title}</h3>
        {guide.overviewSnippet && (
          <p className="type-body text-body line-clamp-3">
            {guide.overviewSnippet}
          </p>
        )}
      </div>
    </Link>
  );
}

function GuidesSkeleton() {
  return (
    <ul
      aria-hidden
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="flex h-full flex-col overflow-hidden rounded-card border border-hairline bg-paper"
        >
          <div className="aspect-[16/9] w-full animate-pulse bg-paper-raised" />
          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="h-5 w-3/4 animate-pulse rounded bg-paper-raised" />
            <div className="h-4 w-full animate-pulse rounded bg-paper-raised" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-paper-raised" />
          </div>
        </li>
      ))}
    </ul>
  );
}
