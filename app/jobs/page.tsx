// app/jobs/page.tsx — public index of recently-cached job postings.
//
// Server-rendered, paginated via a `?cursor=<lastSeenAt>` querystring so
// crawlers can walk the full set via `<Link>` follow. No JS interactivity —
// editorial-row layout to match the workspace search visual register.

import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import type { Metadata } from "next";
import { Briefcase, Building2, MapPin } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { SiteNav } from "@/components/site/SiteNav";
import { JobsFiltersBar } from "@/components/jobs/JobsFiltersBar";

const PAGE_SIZE = 24;

export const metadata: Metadata = {
  title: "Jobs · Career Steer",
  description:
    "Recently surfaced job postings on Career Steer — software, product, design and more.",
  alternates: { canonical: "/jobs" },
  robots: { index: true, follow: true },
};

type SearchParams = Promise<{
  cursor?: string;
  q?: string;
  city?: string;
}>;

// Format firstSeenAt as a short relative-time string. Bucketing matches the
// "added how recently" register editorial readers expect — "today" / "3d" /
// "2w" — over precise timestamps. Locked to UTC-rounded math so SSR and
// client paint produce identical strings.
function formatAddedAgo(timestamp: number, now: number): string {
  const diffMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just added";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
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

function brandfetchCdnFallback(domain: string): string {
  return `https://cdn.brandfetch.io/${encodeURIComponent(domain)}/w/256/h/256/icon`;
}

function PublicJobRow({
  item,
  addedAgo,
}: {
  item: {
    jobPostingId: string;
    citySlug: string;
    companySlug: string;
    titleSlug: string;
    title: string;
    companyName: string;
    city: string;
    companyDomain: string | null;
    companyLogoUrl: string | null;
  };
  addedAgo: string;
}) {
  const href = `/jobs/listing/${item.citySlug}/${item.companySlug}/${item.titleSlug}/${item.jobPostingId}`;
  const logoSrc =
    item.companyLogoUrl ??
    (item.companyDomain ? brandfetchCdnFallback(item.companyDomain) : null);

  return (
    <Link
      href={href}
      className="group flex items-center gap-4 border-b border-hairline px-4 py-6 transition-colors duration-300 hover:bg-ink/[0.02] sm:gap-8 sm:px-8 sm:py-8"
    >
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc}
          alt=""
          width={44}
          height={44}
          className="size-11 shrink-0 rounded-surface bg-paper object-contain p-1"
        />
      ) : item.companyName.length > 0 ? (
        <div className="flex size-11 shrink-0 items-center justify-center rounded-surface bg-paper-raised text-sm font-medium text-ink/70">
          {getInitials(item.companyName)}
        </div>
      ) : (
        <div className="flex size-11 shrink-0 items-center justify-center rounded-surface bg-paper-raised text-ink/40">
          <Building2 className="size-5" strokeWidth={1.5} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="type-label uppercase text-mute">{item.companyName}</p>
        <h2 className="type-headline mt-1 line-clamp-2 text-balance text-ink [font-size:clamp(1.125rem,2vw,1.55rem)] [line-height:1.35] [padding-bottom:0.1em]">
          {item.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-mute">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5" strokeWidth={1.75} />
            {item.city}
          </span>
          <span className="text-mute/70">Added {addedAgo}</span>
        </div>
      </div>
    </Link>
  );
}

function buildPaginationHref(
  cursor: number,
  q: string,
  city: string,
): string {
  const params = new URLSearchParams();
  params.set("cursor", String(cursor));
  if (q) params.set("q", q);
  if (city) params.set("city", city);
  return `/jobs?${params.toString()}`;
}

function buildResetHref(q: string, city: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (city) params.set("city", city);
  return params.size > 0 ? `/jobs?${params.toString()}` : "/jobs";
}

export default async function JobsIndexPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const cursor = sp.cursor ? Number(sp.cursor) : undefined;
  const cursorLastSeenAt =
    cursor && Number.isFinite(cursor) ? cursor : undefined;
  const q = sp.q?.trim() ?? "";
  const city = sp.city?.trim() ?? "";
  const filtersActive = !!q || !!city;

  const { items, nextCursor } = await fetchQuery(
    api.jobPostings.listPublicRecent,
    {
      limit: PAGE_SIZE,
      cursorLastSeenAt,
      q: q || undefined,
      city: city || undefined,
    },
  );

  // Pin "now" once per render so every relative timestamp on the page lines
  // up. Using new Date() inside each row would drift between SSR and any
  // streaming chunks.
  const now = Date.now();

  return (
    <main className="flex flex-1 flex-col bg-paper">
      <SiteNav />
      <div className="mx-auto w-full max-w-4xl px-6 py-12 sm:py-16">
        <header className="mb-10 flex max-w-xl flex-col gap-4">
          <span className="type-label uppercase text-mute">Jobs</span>
          <h1 className="type-display text-balance text-ink [font-size:clamp(2rem,4.5vw,3rem)]">
            Open roles,{" "}
            <span className="text-ink-soft">in long form.</span>
          </h1>
          <p className="text-balance text-[15px] leading-relaxed text-ink/60">
            Click into any one and you&apos;ll find the role written out as a
            piece — with what we know about the company, the pay, and the
            interview set alongside it.
          </p>
        </header>

        <div className="mb-10">
          <JobsFiltersBar initialQ={q} initialCity={city} />
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-hairline-strong bg-paper-raised py-16 text-center">
            <Briefcase className="size-8 text-ink/30" strokeWidth={1.5} />
            <p className="text-[14px] text-ink/55">
              {filtersActive
                ? "No jobs match these filters yet."
                : "No active jobs cached yet."}
            </p>
            {filtersActive && (
              <Link
                href="/jobs"
                className="text-[13px] text-ink/70 underline-offset-2 hover:text-ink hover:underline"
              >
                Clear filters
              </Link>
            )}
          </div>
        ) : (
          <div className="border-t border-hairline">
            {items.map((item) => (
              <PublicJobRow
                key={item._id}
                item={item}
                addedAgo={formatAddedAgo(item.firstSeenAt, now)}
              />
            ))}
          </div>
        )}

        <nav className="mt-12 flex items-center justify-between gap-4 text-[13px]">
          {/* Back to first page only ever appears when we're past the
              homepage. We don't render a "back N" because cursors are
              opaque — leaving the user a clean reset is the safest UX.
              Filter params are preserved across pagination and across the
              "back to most recent" link. */}
          {cursorLastSeenAt ? (
            <Link
              href={buildResetHref(q, city)}
              className="text-ink/70 underline-offset-2 hover:text-ink hover:underline"
            >
              ← Back to most recent
            </Link>
          ) : (
            <span />
          )}
          {nextCursor !== null ? (
            <Link
              href={buildPaginationHref(nextCursor, q, city)}
              className="text-ink/70 underline-offset-2 hover:text-ink hover:underline"
            >
              Older jobs →
            </Link>
          ) : (
            <span className="type-label uppercase text-mute">
              No more jobs
            </span>
          )}
        </nav>
      </div>
    </main>
  );
}
