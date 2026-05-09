"use client";

// Editorial three-zone job card. Single horizontal row, hairline-divided.
// Read this top to bottom and the layout is:
//
//   [logo + fit eyebrow]   [title + company + meta + summary + actions]   [salary + save]
//
// Lifted from V1's pattern but rewritten in v2 tokens (paper/ink/hairline,
// type-display/title/label) — and intentionally drops V1's numeric fit-score
// percentage in favour of qualitative "Strong match" / "Worth exploring"
// tags. Numeric percentages are an AI-product cliché the brand voice rejects.

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Building2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { JobResult, FitTier } from "@/convex/jobSearch";

type LiveContent = {
  contentStatus: "pending" | "generating" | "complete" | "failed";
  overview: string | null;
};

type Props = {
  job: JobResult;
  index: number;
  // Reactive bookmark state from convex/savedJobs.mySavedSet. Null when the
  // user is signed out — in that mode the card hides the bookmark control.
  isSavedSet: ReadonlySet<string> | null;
  isSignedIn: boolean;
  // Live content lookup keyed by jobPostingId. Undefined when the row has no
  // backing cache row yet (pagination pages without round-trip) or while the
  // subscription is still loading. When `contentStatus === "complete"` and
  // `overview` is present, the polished overview replaces the raw SearchAPI
  // description; while pending/generating the row shows a discrete spinner
  // footer indicating the rewrite is in flight.
  liveContent?: LiveContent;
};

function buildGoogleSearchUrl(job: JobResult): string {
  const parts = [
    job.title ? `"${job.title}"` : null,
    job.companyName ? `"${job.companyName}"` : null,
  ].filter((p): p is string => p !== null);
  const q = parts.length > 0 ? parts.join(" ") : (job.title ?? "");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Brandfetch CDN URL — canonical pattern is `cdn.brandfetch.io/{domain}?c=`.
// The CDN also cross-checks Referer against the allowed-origins list set on
// the client ID in the Brandfetch dashboard. Returns null when the env var
// is unset so the caller falls through to initials.
function brandfetchCdnFallback(domain: string): string | null {
  const clientId = process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID;
  if (!clientId) return null;
  return `https://cdn.brandfetch.io/${encodeURIComponent(domain)}?c=${encodeURIComponent(clientId)}`;
}

function FitTag({ tier }: { tier: FitTier }) {
  if (tier === null) return null;
  const label = tier === "strong" ? "Strong match" : "Worth exploring";
  // Tonal-only treatment per DESIGN.md One Voice Rule — both tiers share the
  // same warm-ink hairline accent, with subtle weight contrast carrying the
  // hierarchy. No green/blue/amber colour code.
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={
          tier === "strong"
            ? "h-px w-8 bg-ink/60"
            : "h-px w-8 bg-ink/30"
        }
      />
      <span
        className={
          tier === "strong"
            ? "type-label uppercase text-ink"
            : "type-label uppercase text-ink-soft"
        }
      >
        {label}
      </span>
    </span>
  );
}

function CompanyMark({
  companyName,
  logoUrl,
  domain,
}: {
  companyName: string | null;
  logoUrl: string | null;
  domain: string | null;
}) {
  const [imgError, setImgError] = useState(false);
  const name = companyName ?? "";
  const candidateUrl =
    !imgError && logoUrl
      ? logoUrl
      : !imgError && domain
        ? brandfetchCdnFallback(domain) ?? null
        : null;

  if (candidateUrl) {
    return (
      // Brandfetch CDN URLs are stable and remote-image config is not yet
      // wired in next.config — using <img> is intentional here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={candidateUrl}
        alt=""
        width={44}
        height={44}
        className="size-11 shrink-0 rounded-surface bg-paper object-contain p-1"
        onError={() => setImgError(true)}
      />
    );
  }
  if (name.length > 0) {
    return (
      <div className="flex size-11 shrink-0 items-center justify-center rounded-surface bg-paper-raised text-sm font-medium text-ink/70">
        {getInitials(name)}
      </div>
    );
  }
  return (
    <div className="flex size-11 shrink-0 items-center justify-center rounded-surface bg-paper-raised text-ink/40">
      <Building2 className="size-5" strokeWidth={1.5} />
    </div>
  );
}

export function JobCardRow({
  job,
  isSavedSet,
  isSignedIn,
  liveContent,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const save = useMutation(api.savedJobs.save);
  const unsave = useMutation(api.savedJobs.unsave);

  // Prefer the LLM-rewritten overview when it's landed. Falls back to the
  // raw SearchAPI description otherwise. The `<p>` HTML tags users were
  // seeing in the raw text are stripped server-side (jobSearch.ts), so the
  // fallback reads as plain prose while the rewrite is in flight.
  const polishedOverview =
    liveContent?.contentStatus === "complete" && liveContent.overview
      ? liveContent.overview
      : null;
  const description = polishedOverview ?? job.description;
  const isRewriting =
    liveContent !== undefined &&
    (liveContent.contentStatus === "pending" ||
      liveContent.contentStatus === "generating");

  const isSaved =
    isSavedSet !== null && job.jobPostingId !== null
      ? isSavedSet.has(job.jobPostingId)
      : false;

  const detailUrl =
    job.jobPostingId && job.citySlug && job.companySlug && job.titleSlug
      ? (`/jobs/listing/${job.citySlug}/${job.companySlug}/${job.titleSlug}/${job.jobPostingId}` as const)
      : null;

  // Compose the meta line. Order: location · schedule · remote · postedAt.
  // Each segment is dropped silently when missing rather than rendering a
  // blank pill — the line should never have hanging separators.
  const metaParts: string[] = [];
  if (job.location) metaParts.push(job.location);
  if (job.schedule) metaParts.push(job.schedule);
  if (job.workFromHome) metaParts.push("Remote");
  if (job.postedAt) metaParts.push(job.postedAt);
  const meta = metaParts.join(" · ");

  const onToggleSave = async () => {
    if (!isSignedIn || !job.jobPostingId || pending) return;
    setPending(true);
    try {
      if (isSaved) {
        await unsave({ jobPostingId: job.jobPostingId });
      } else {
        await save({ jobPostingId: job.jobPostingId });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <article className="group relative">
      <div className="flex flex-col gap-4 border-b border-hairline px-4 py-6 transition-colors duration-300 hover:bg-ink/[0.02] sm:flex-row sm:items-start sm:gap-8 sm:px-8 sm:py-10">
        {/* Left rail: brandmark + fit tag */}
        <div className="flex items-center gap-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start sm:gap-3 sm:pt-1">
          <CompanyMark
            companyName={job.companyName}
            logoUrl={job.companyLogoUrl}
            domain={job.companyDomain}
          />
          <FitTag tier={job.fitTier} />
        </div>

        {/* Centre: title + company + meta + summary + footer */}
        <div className="min-w-0 flex-1">
          {detailUrl ? (
            <Link
              href={detailUrl}
              className="block transition-colors hover:text-ink-deep"
            >
              <h2 className="type-headline text-balance text-ink [font-size:clamp(1.25rem,2.4vw,1.7rem)] [line-height:1.15]">
                {job.title}
              </h2>
            </Link>
          ) : (
            <h2 className="type-headline text-balance text-ink [font-size:clamp(1.25rem,2.4vw,1.7rem)] [line-height:1.15]">
              {job.title}
            </h2>
          )}

          {job.companyName && (
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink/65">
              {job.companyName}
            </p>
          )}

          {(meta || (job.salary && !isSignedIn)) && (
            <p className="mt-2 text-[13px] text-mute sm:mt-3">
              {meta}
              {job.salary && (
                <span className="sm:hidden">
                  {meta ? " · " : ""}
                  {job.salary}
                </span>
              )}
            </p>
          )}

          {description && (
            <p
              className={
                expanded
                  ? "mt-3 whitespace-pre-line text-[14px] leading-relaxed text-ink/55 sm:mt-4"
                  : "mt-3 line-clamp-2 text-[14px] leading-relaxed text-ink/55 sm:mt-4 sm:line-clamp-3"
              }
            >
              {description}
            </p>
          )}

          {isRewriting && (
            <p
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-mute"
              aria-live="polite"
            >
              <Loader2
                className="size-3 animate-spin"
                strokeWidth={1.75}
                aria-hidden
              />
              Writing a polished overview…
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 sm:mt-5">
            <div className="flex items-center gap-3">
              {job.via && (
                <span className="type-label uppercase text-mute">
                  {job.via.replace(/^via\s+/i, "")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {description && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink/80 transition-colors hover:text-ink"
                  aria-expanded={expanded}
                >
                  {expanded ? (
                    <>
                      Less <ChevronUp className="size-3.5" strokeWidth={1.75} />
                    </>
                  ) : (
                    <>
                      Details{" "}
                      <ChevronDown className="size-3.5" strokeWidth={1.75} />
                    </>
                  )}
                </button>
              )}
              {detailUrl ? (
                <Link
                  href={detailUrl}
                  className="inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-1.5 text-[12px] font-medium tracking-wide text-paper transition-colors duration-300 hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                >
                  View
                  <ArrowRight className="size-3.5" strokeWidth={1.75} />
                </Link>
              ) : job.applyLink ? (
                <a
                  href={job.applyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-1.5 text-[12px] font-medium tracking-wide text-paper transition-colors duration-300 hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                >
                  Apply
                  <ExternalLink className="size-3.5" strokeWidth={1.75} />
                </a>
              ) : (
                // No detail page (no jobPostingId, e.g. SearchAPI pagination
                // pages where we skip the cache round-trip) and no apply
                // link — fall back to a plain Google search so the row never
                // ends in a dead end.
                <a
                  href={buildGoogleSearchUrl(job)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-pill border border-hairline-strong bg-paper px-4 py-1.5 text-[12px] font-medium tracking-wide text-ink/80 transition-colors duration-300 hover:border-ink/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                >
                  Find on Google
                  <ExternalLink className="size-3.5" strokeWidth={1.75} />
                </a>
              )}
            </div>
          </div>

          {expanded && (description || job.salary) && (
            <div className="mt-6 border-t border-hairline/60 pt-6">
              {job.salary && (
                <p className="text-[13px] text-mute sm:hidden">
                  Salary · {job.salary}
                </p>
              )}
              {job.applyLink && detailUrl && (
                <a
                  href={job.applyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink/80 transition-colors hover:text-ink"
                >
                  Open original posting
                  <ExternalLink className="size-3.5" strokeWidth={1.75} />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Right rail: salary + save (sm+ only — mobile folds salary into meta) */}
        <div className="hidden sm:flex sm:w-36 sm:shrink-0 sm:flex-col sm:items-end sm:gap-3 sm:pt-1">
          {job.salary && (
            <div className="text-right">
              <div className="type-headline text-ink/85 [font-size:clamp(1.25rem,2vw,1.5rem)] [line-height:1]">
                {job.salary}
              </div>
              <div className="type-label mt-1.5 text-mute">salary</div>
            </div>
          )}
          {isSignedIn && job.jobPostingId && (
            <button
              type="button"
              onClick={onToggleSave}
              disabled={pending}
              aria-label={isSaved ? "Unsave this job" : "Save this job"}
              aria-pressed={isSaved}
              className={
                isSaved
                  ? "inline-flex size-9 items-center justify-center rounded-pill bg-ink/5 text-ink transition-colors hover:bg-ink/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                  : "inline-flex size-9 items-center justify-center rounded-pill text-mute transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
              ) : isSaved ? (
                <BookmarkCheck className="size-4" strokeWidth={1.75} />
              ) : (
                <Bookmark className="size-4" strokeWidth={1.75} />
              )}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
