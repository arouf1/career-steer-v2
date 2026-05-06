"use client";

import Link from "next/link";
import { Building2, MapPin, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

export function JobsForGuideCard({ job, viewerState, locked = false }: Props) {
  const showSalary = !locked && viewerState !== "anonymous";
  const showFitPill = viewerState === "signed-in-with-profile" && !locked;
  const showLockedFitPill = viewerState !== "signed-in-with-profile" && !locked;

  const href = locked
    ? "#"
    : `/jobs/listing/${encodeURIComponent(job.citySlug)}/${encodeURIComponent(
        job.companySlug,
      )}/${encodeURIComponent(job.titleSlug)}/${job.jobPostingId}`;

  const inner = (
    <Card
      className={cn(
        "p-4 transition-colors",
        !locked && "hover:bg-accent/40",
        locked && "pointer-events-none select-none",
      )}
      aria-hidden={locked || undefined}
    >
      <div className={cn("space-y-2", locked && "blur-[3px]")}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium leading-snug">{job.title}</h3>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="size-3" aria-hidden /> {job.companyName}
            </p>
          </div>
          {showFitPill && job.fitTier ? (
            <Badge
              variant={job.fitTier === "strong" ? "default" : "secondary"}
              className="shrink-0"
            >
              {job.fitTier === "strong" ? "Strong fit" : "Worth a look"}
            </Badge>
          ) : null}
          {showLockedFitPill ? (
            <Badge variant="outline" className="shrink-0 gap-1">
              <Lock className="size-3" aria-hidden />
              {viewerState === "anonymous"
                ? "Sign in for fit"
                : "Complete profile"}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="size-3" aria-hidden /> {job.city}
          </span>
          {showSalary && job.salaryDisplay ? <span>{job.salaryDisplay}</span> : null}
          <span>{formatPosted(job.postedAt)}</span>
        </div>
      </div>
    </Card>
  );

  if (locked) return inner;
  return (
    <Link href={href} className="block focus-visible:outline-none">
      {inner}
    </Link>
  );
}
