"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Compass } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { GuidesFromSnapshot, ProfileGuideCard } from "@/convex/matching";

// Quadrant keys, labels, and descriptions match `LANE_META` in
// app/workspace/career-compass/DiscoverCanvas.tsx, keep in sync.
type LaneKey = "linear" | "adjacent" | "earlier" | "transformational";

const LANES: Array<{
  id: LaneKey;
  label: string;
  description: string;
}> = [
  {
    id: "linear",
    label: "Linear Lanes",
    description: "The natural next step from here",
  },
  {
    id: "adjacent",
    label: "Adjacent Avenues",
    description: "Sideways moves into nearby fields",
  },
  {
    id: "earlier",
    label: "Foundational Footprints",
    description: "Earlier-stage roles that share your foundation",
  },
  {
    id: "transformational",
    label: "Transformational Tracks",
    description: "Bigger pivots that reshape your trajectory",
  },
];

function laneCards(
  data: GuidesFromSnapshot | undefined,
  id: LaneKey,
): ProfileGuideCard[] {
  if (!data || data.status !== "ready") return [];
  return data.lanes[id] ?? [];
}

function firstNonEmptyLane(data: GuidesFromSnapshot | undefined): LaneKey {
  if (!data || data.status !== "ready") return "linear";
  for (const lane of LANES) {
    if (laneCards(data, lane.id).length > 0) return lane.id;
  }
  return "linear";
}

export function GuidesForYou() {
  const [pick, setPick] = useState<LaneKey | null>(null);
  const data = useQuery(api.matching.guidesForMeFromSnapshot);

  const lane: LaneKey = pick ?? firstNonEmptyLane(data);
  const description = useMemo(
    () => LANES.find((l) => l.id === lane)?.description ?? "",
    [lane],
  );

  const isLoading = data === undefined;
  const showLaneTabs = isLoading || (data && data.status === "ready");

  return (
    <section
      aria-labelledby="guides-for-you-heading"
      aria-busy={isLoading}
      className="flex flex-col gap-6 rounded-card border border-hairline bg-paper-raised p-6 lg:p-8"
    >
      <header className="flex flex-col gap-2">
        <p className="type-label uppercase text-mute">Guides for you</p>
        <h2 id="guides-for-you-heading" className="type-headline text-ink">
          Careers worth a closer look
        </h2>
        <p className="type-body text-body max-w-prose">{description}</p>
      </header>

      {showLaneTabs && (
        <div
          role="group"
          aria-label="Compass lane"
          className="flex flex-wrap gap-2"
        >
          {LANES.map((l) => {
            const active = l.id === lane;
            const empty =
              data?.status === "ready" && laneCards(data, l.id).length === 0;
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPick(l.id)}
                className={`type-label inline-flex min-h-11 items-center rounded-pill border px-5 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper-raised ${
                  active
                    ? "border-ink bg-ink text-paper"
                    : "border-hairline bg-paper text-body hover:border-hairline-strong"
                } ${empty && !active ? "opacity-50" : ""}`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      )}

      <GuidesContent data={data} lane={lane} onPick={setPick} />
    </section>
  );
}

function GuidesContent({
  data,
  lane,
  onPick,
}: {
  data: GuidesFromSnapshot | undefined;
  lane: LaneKey;
  onPick: (lane: LaneKey) => void;
}) {
  if (data === undefined) return <GuidesSkeleton />;
  if (data.status === "generating") return <GeneratingState />;
  if (data.status === "missing" || data.status === "failed") {
    return <CalibrateCta status={data.status} />;
  }
  const cards = laneCards(data, lane);
  if (cards.length === 0) {
    return <EmptyLaneState data={data} onPick={onPick} />;
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((g) => (
        <li key={g.slug} className="h-full">
          <GuideCard guide={g} />
        </li>
      ))}
      <li className="h-full">
        <CompassCtaCard />
      </li>
    </ul>
  );
}

function CompassCtaCard() {
  return (
    <Link
      href="/workspace/career-compass"
      className="group flex h-full flex-col justify-between gap-4 rounded-card bg-ink p-6 text-paper transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper-raised"
    >
      <div className="flex flex-col gap-2">
        <p className="type-label text-paper/70">Your Compass</p>
        <p className="type-title text-paper">
          See the full canvas
        </p>
        <p className="type-caption mt-1 text-paper/80">
          Every guide matched to you across all four Compass lanes.
        </p>
      </div>
      <span className="type-label inline-flex items-center gap-2 text-paper">
        Open Compass
        <ArrowRight
          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}

function GuideCard({ guide }: { guide: ProfileGuideCard }) {
  const body = guide.whyMatchReason || guide.overviewSnippet;
  return (
    <Link
      href={`/career-guides/${guide.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-hairline bg-paper transition-colors hover:border-hairline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper-raised"
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
        {body && (
          <p className="type-body text-body line-clamp-3">{body}</p>
        )}
      </div>
    </Link>
  );
}

function CalibrateCta({ status }: { status: "missing" | "failed" }) {
  const isFailure = status === "failed";
  return (
    <div className="flex flex-col items-start gap-4 rounded-card border border-hairline bg-paper p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <Compass className="size-5 text-mute" aria-hidden />
        <p className="type-title text-ink">
          {isFailure ? "Re-calibrate your Compass" : "Calibrate your Compass"}
        </p>
      </div>
      <p className="type-body text-body max-w-prose">
        {isFailure
          ? "We couldn't generate your Career Compass last time. Try again to surface guides matched to your shape."
          : "Your Career Compass charts roles aligned with who you are and where you could go. Calibrate it once and these recommendations come from the same place."}
      </p>
      <Link
        href="/workspace/career-compass"
        className="type-label inline-flex min-h-11 items-center rounded-pill border border-ink bg-ink px-5 py-3 text-paper transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        {isFailure ? "Try again" : "Calibrate your Compass"}
      </Link>
    </div>
  );
}

function GeneratingState() {
  return (
    <div className="flex items-center gap-3 rounded-card border border-hairline bg-paper p-6">
      <Compass
        className="size-5 animate-pulse text-mute"
        aria-hidden
      />
      <p className="type-body text-body">
        Calibrating your Career Compass… we&rsquo;ll surface guides here as
        soon as it&rsquo;s ready.
      </p>
    </div>
  );
}

function EmptyLaneState({
  data,
  onPick,
}: {
  data: GuidesFromSnapshot;
  onPick: (lane: LaneKey) => void;
}) {
  const populated = LANES.filter((l) => laneCards(data, l.id).length > 0);
  if (populated.length === 0) {
    return (
      <p className="type-body text-mute">
        Your Compass is calibrated but no guides matched any lane.{" "}
        <Link
          href="/workspace/career-compass"
          className="underline underline-offset-2 hover:text-ink"
        >
          Recalibrate
        </Link>{" "}
        to try again.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="type-body text-mute">
        No guides match this lane yet. Try{" "}
        {populated.map((l, i) => (
          <span key={l.id}>
            {i > 0 && (i === populated.length - 1 ? " or " : ", ")}
            <button
              type="button"
              onClick={() => onPick(l.id)}
              className="underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper-raised"
            >
              {l.label}
            </button>
          </span>
        ))}
        .
      </p>
    </div>
  );
}

function GuidesSkeleton() {
  return (
    <ul aria-hidden className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
