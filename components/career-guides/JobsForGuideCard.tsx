"use client";

import Link from "next/link";
import { Building2, MapPin, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewerState =
  | "anonymous"
  | "signed-in-no-profile"
  | "signed-in-with-profile";

export type JobCardData = {
  jobPostingId: string;
  title: string;
  titleSlug: string;
  companyName: string;
  companySlug: string;
  city: string;
  citySlug: string;
  countryCode?: string;
  postedAt: number;
  salaryDisplay?: string;
  archetypeSlug: string;
  fitTier?: "strong" | "worth" | null;
};

type Props = {
  job: JobCardData;
  viewerState: ViewerState;
  /** When true, render as the locked / blurred preview behind the tease overlay. */
  locked?: boolean;
};

const formatPosted = (ts: number): string => {
  const days = Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

const FitMarker = ({ tier }: { tier: "strong" | "worth" }) => (
  <span className="type-label inline-flex items-center gap-1.5 whitespace-nowrap text-ink">
    <span
      aria-hidden
      className={cn(
        "size-1.5 rounded-pill",
        tier === "strong" ? "bg-ink" : "bg-ink/40",
      )}
    />
    {tier === "strong" ? "Strong fit" : "Worth a look"}
  </span>
);

const LockedFitMarker = ({
  copy,
}: {
  copy: "Sign in for fit" | "Complete profile";
}) => (
  <span className="type-caption inline-flex items-center gap-1.5 whitespace-nowrap text-mute">
    <Lock className="size-3" aria-hidden />
    {copy}
  </span>
);

export function JobsForGuideCard({ job, viewerState, locked = false }: Props) {
  const showSalary = !locked && viewerState !== "anonymous";
  const showFitMarker = viewerState === "signed-in-with-profile" && !locked;
  const showLockedFitMarker = viewerState !== "signed-in-with-profile" && !locked;

  const href = locked
    ? "#"
    : `/jobs/listing/${encodeURIComponent(job.citySlug)}/${encodeURIComponent(
        job.companySlug,
      )}/${encodeURIComponent(job.titleSlug)}/${job.jobPostingId}`;

  const inner = (
    <article
      className={cn(
        "rounded-card border border-hairline bg-paper-raised px-5 py-4 transition-colors duration-200",
        !locked && "group hover:border-hairline-strong",
        locked && "pointer-events-none select-none",
      )}
      aria-hidden={locked || undefined}
    >
      <div className={cn("flex flex-col gap-2", locked && "blur-[3px]")}>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="type-title text-ink leading-snug">{job.title}</h3>
          {showFitMarker && job.fitTier ? <FitMarker tier={job.fitTier} /> : null}
          {showLockedFitMarker ? (
            <LockedFitMarker
              copy={
                viewerState === "anonymous"
                  ? "Sign in for fit"
                  : "Complete profile"
              }
            />
          ) : null}
        </div>

        <p className="type-caption flex items-center gap-1.5 text-body">
          <Building2 className="size-3.5 text-mute" aria-hidden />
          {job.companyName}
        </p>

        <div className="type-caption flex flex-wrap items-center gap-x-3 gap-y-1 text-mute">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden /> {job.city}
          </span>
          {showSalary && job.salaryDisplay ? (
            <>
              <span aria-hidden className="text-mute/40">·</span>
              <span>{job.salaryDisplay}</span>
            </>
          ) : null}
          <span aria-hidden className="text-mute/40">·</span>
          <span>{formatPosted(job.postedAt)}</span>
        </div>
      </div>
    </article>
  );

  if (locked) return inner;
  return (
    <Link
      href={href}
      className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
    >
      {inner}
    </Link>
  );
}
