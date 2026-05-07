"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import { Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { describeLadderHit } from "@/lib/jobs/microcopy";
import { JobCardRow } from "@/components/jobs/JobCardRow";
import { JobsForGuideEmpty } from "./JobsForGuideEmpty";
import { JobsForGuideTeaseLock } from "./JobsForGuideTeaseLock";

const ANON_LIMIT = 5; // 3 visible + 2 blurred
const SIGNED_IN_LIMIT = 12;

export type AnonymousGeo = {
  city?: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
};

type Props = {
  guideSlug: string;
  guideTitle: string;
  anonymousGeo: AnonymousGeo;
  /** Absolute URL of the current guide page; used as the post-sign-in redirect. */
  pageUrl: string;
};

const COUNTRY_LABEL: Record<string, string> = {
  gb: "the UK",
  uk: "the UK",
  us: "the US",
  ca: "Canada",
  au: "Australia",
  ie: "Ireland",
  fr: "France",
  de: "Germany",
  es: "Spain",
  nl: "the Netherlands",
};

const labelForCountryCode = (cc: string | undefined): string | undefined => {
  if (!cc) return undefined;
  return COUNTRY_LABEL[cc.toLowerCase()] ?? cc.toUpperCase();
};

export function JobsForGuide({
  guideSlug,
  guideTitle,
  anonymousGeo,
  pageUrl,
}: Props) {
  const { isLoaded: clerkLoaded, isSignedIn } = useUser();

  const profileGeo = useQuery(
    api.profiles.resolvedLocation,
    isSignedIn ? {} : "skip",
  );

  // Search-time location: profile-city wins for signed-in users (the
  // confirmed truth), with anonymous IP-derived city as the safety net for
  // signed-out viewers (or signed-in users who haven't confirmed a profile
  // location yet). The Convex query uses the same precedence for ranking.
  const searchCity =
    isSignedIn && profileGeo?.cityName ? profileGeo.cityName : anonymousGeo.city;
  const searchCountry =
    isSignedIn && profileGeo?.countryCode
      ? profileGeo.countryCode
      : anonymousGeo.countryCode;

  const viewer = useMemo(() => {
    if (isSignedIn && profileGeo) {
      return {
        lat: profileGeo.lat,
        lon: profileGeo.lon,
        countryCode: profileGeo.countryCode,
      };
    }
    return {
      lat: anonymousGeo.lat,
      lon: anonymousGeo.lon,
      countryCode: anonymousGeo.countryCode,
    };
  }, [isSignedIn, profileGeo, anonymousGeo]);

  const limit = isSignedIn ? SIGNED_IN_LIMIT : ANON_LIMIT;
  const data = useQuery(api.jobsForGuide.forGuide, {
    guideSlug,
    viewer,
    limit,
  });

  // Live overview rewrite status, keyed by jobPostingId. Same subscription
  // pattern as /workspace/jobs so the JobCardRow's "Writing a polished
  // overview…" footer stays accurate as content lands.
  const liveContentArr = useQuery(
    api.jobPostings.liveContentByIds,
    data && data.jobs.length > 0
      ? { ids: data.jobs.map((j) => j.jobPostingId) }
      : "skip",
  );
  const liveContentByJobId = useMemo(() => {
    const m = new Map<
      string,
      { contentStatus: "pending" | "generating" | "complete" | "failed"; overview: string | null }
    >();
    liveContentArr?.forEach((row) => {
      m.set(row.jobPostingId as string, {
        contentStatus: row.contentStatus,
        overview: row.overview,
      });
    });
    return m;
  }, [liveContentArr]);

  // Bookmark set for the save/unsave control inside JobCardRow. Anonymous
  // viewers see no bookmark control regardless.
  const savedSetArr = useQuery(
    api.savedJobs.mySavedSet,
    isSignedIn ? {} : "skip",
  );
  const savedSet = useMemo(() => {
    if (!savedSetArr) return null;
    return new Set<string>(savedSetArr.map((id) => id as string));
  }, [savedSetArr]);

  const searchLive = useAction(api.jobsForGuide.searchLive);
  const [searchLivePending, setSearchLivePending] = useState(false);
  const [autoSearchAttempted, setAutoSearchAttempted] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  const onSearchLive = useCallback(async () => {
    setSearchLivePending(true);
    setQuotaMessage(null);
    setAutoSearchAttempted(true);
    try {
      await searchLive({
        guideSlug,
        location: searchCity,
        gl: searchCountry,
      });
    } catch (err: unknown) {
      const errData = (err as { data?: { kind?: string; retryAfterMs?: number } })
        ?.data;
      if (
        errData?.kind === "quota_exceeded" &&
        typeof errData.retryAfterMs === "number"
      ) {
        const min = Math.max(1, Math.ceil(errData.retryAfterMs / 60_000));
        setQuotaMessage(`Try again in ${min} min.`);
      } else {
        setQuotaMessage("Couldn't search right now. Try again soon.");
      }
    } finally {
      setSearchLivePending(false);
    }
  }, [searchLive, guideSlug, searchCity, searchCountry]);

  // Auto-fire live search when a signed-in user scrolls the empty section
  // into view. Single-shot per (guide-page, mount). Suppressed when the
  // viewer has no resolvable location yet — firing without a location
  // returns SearchAPI's geographic default (US-centric) which is worse than
  // showing the manual button.
  const emptyRef = useRef<HTMLDivElement>(null);
  const autoFiredRef = useRef(false);

  useEffect(() => {
    if (!isSignedIn) return;
    if (!data || data.jobs.length > 0) return;
    if (autoFiredRef.current || autoSearchAttempted) return;
    if (!emptyRef.current) return;
    // profileGeo === undefined is "still loading" — wait.
    if (profileGeo === undefined) return;
    // No usable location at all → don't auto-fire. User can still click
    // the manual button if they want.
    if (!searchCity && !searchCountry) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !autoFiredRef.current) {
          autoFiredRef.current = true;
          void onSearchLive();
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(emptyRef.current);
    return () => observer.disconnect();
  }, [
    isSignedIn,
    data,
    autoSearchAttempted,
    profileGeo,
    searchCity,
    searchCountry,
    onSearchLive,
  ]);

  if (!clerkLoaded || data === undefined) {
    return <JobsForGuideSkeleton showBlurred={!isSignedIn} />;
  }

  if (data.jobs.length === 0) {
    const emptyVariant: React.ComponentProps<typeof JobsForGuideEmpty>["variant"] =
      !isSignedIn
        ? "anonymous"
        : searchLivePending
          ? "signed-in-searching"
          : autoSearchAttempted
            ? "signed-in-empty-after-search"
            : "signed-in-idle";

    return (
      <Section guideTitle={guideTitle}>
        <JobsForGuideEmpty
          ref={emptyRef}
          guideTitle={guideTitle}
          variant={emptyVariant}
          onSearchLive={isSignedIn ? onSearchLive : undefined}
          signInRedirectUrl={pageUrl}
        />
        {quotaMessage ? (
          <p className="type-caption mt-3 text-mute" role="status">
            {quotaMessage}
          </p>
        ) : null}
      </Section>
    );
  }

  // Section heading microcopy reads off the ladder rung the query landed on
  // plus the viewer's confirmed city/country for honest framing.
  const viewerCityLabel =
    isSignedIn && profileGeo?.cityName
      ? profileGeo.cityName
      : anonymousGeo.city;
  const viewerCountryLabel = labelForCountryCode(viewer.countryCode);

  const heading = describeLadderHit({
    ladderHit: data.ladderHit,
    pickedCitySlugs: data.jobs.map((j) => j.citySlug),
    viewerCityLabel,
    viewerCountryLabel,
    total: data.totalArchetypeMatches,
  });

  if (!isSignedIn) {
    const visible = data.jobs.slice(0, 3);
    const blurred = data.jobs.slice(3, ANON_LIMIT);
    const remaining = Math.max(0, data.totalArchetypeMatches - visible.length);

    return (
      <Section guideTitle={guideTitle} ladderLabel={heading}>
        <ul className="divide-y divide-hairline">
          {visible.map((job) => (
            <li key={job.jobPostingId}>
              <JobCardRow
                job={job}
                index={0}
                isSavedSet={null}
                isSignedIn={false}
                liveContent={liveContentByJobId.get(job.jobPostingId as string)}
              />
            </li>
          ))}
        </ul>
        {blurred.length > 0 ? (
          <div className="mt-3">
            <JobsForGuideTeaseLock
              totalRemaining={remaining}
              geoLabel={
                viewerCityLabel
                  ? `near ${viewerCityLabel}`
                  : viewerCountryLabel
                    ? `in ${viewerCountryLabel}`
                    : "near you"
              }
              guideTitle={guideTitle}
              signInRedirectUrl={pageUrl}
            >
              <ul className="divide-y divide-hairline">
                {blurred.map((job) => (
                  <li key={job.jobPostingId}>
                    <JobCardRow
                      job={job}
                      index={0}
                      isSavedSet={null}
                      isSignedIn={false}
                    />
                  </li>
                ))}
              </ul>
            </JobsForGuideTeaseLock>
          </div>
        ) : (
          <div className="mt-6 flex items-center justify-between gap-4 border-t border-hairline pt-5">
            <p className="type-caption text-mute">
              Sign in to see how these match your profile.
            </p>
            <SignInButton mode="modal" forceRedirectUrl={pageUrl}>
              <button
                type="button"
                className="type-label inline-flex items-center rounded-pill px-4 py-2 text-ink transition-colors hover:bg-paper-raised"
              >
                Sign in
              </button>
            </SignInButton>
          </div>
        )}
      </Section>
    );
  }

  return (
    <Section
      guideTitle={guideTitle}
      ladderLabel={heading}
      action={
        <button
          type="button"
          onClick={onSearchLive}
          disabled={searchLivePending}
          className="type-label inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-ink transition-colors hover:bg-paper-raised disabled:opacity-60"
        >
          <Search className="size-3.5" aria-hidden />
          {searchLivePending ? "Searching…" : "Search live"}
        </button>
      }
    >
      <ul className="divide-y divide-hairline">
        {data.jobs.map((job) => (
          <li key={job.jobPostingId}>
            <JobCardRow
              job={job}
              index={0}
              isSavedSet={savedSet}
              isSignedIn={true}
              liveContent={liveContentByJobId.get(job.jobPostingId as string)}
            />
          </li>
        ))}
      </ul>
      {quotaMessage ? (
        <p className="type-caption mt-3 text-mute" role="status">
          {quotaMessage}
        </p>
      ) : null}
    </Section>
  );
}

// Section shell mirrors RelatedGuides exactly so the two paired editorial
// blocks stack with consistent rhythm — same width, same eyebrow→headline
// hierarchy, same hairline top-border. Inner content rail widens to
// max-w-5xl because JobCardRow's three-zone layout needs the room.
function Section({
  guideTitle,
  ladderLabel,
  action,
  children,
}: {
  guideTitle: string;
  ladderLabel?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="jobs-for-guide-heading"
      className="border-t border-hairline bg-paper"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:px-8 lg:py-16">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="type-label uppercase text-mute">Find work</p>
            <h2
              id="jobs-for-guide-heading"
              className="type-headline mt-2 text-ink"
            >
              Jobs hiring {guideTitle}
            </h2>
            {ladderLabel ? (
              <p className="type-body mt-3 text-body">{ladderLabel}.</p>
            ) : null}
          </div>
          {action}
        </header>
        <div className="mx-auto max-w-5xl">{children}</div>
      </div>
    </section>
  );
}

function JobsForGuideSkeleton({ showBlurred }: { showBlurred: boolean }) {
  return (
    <section className="border-t border-hairline bg-paper">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:px-8 lg:py-16">
        <header className="mb-8 max-w-2xl space-y-3">
          <div className="h-3 w-24 rounded-hair bg-paper-raised" />
          <div className="h-9 w-64 rounded-surface bg-paper-raised" />
        </header>
        <div className="mx-auto max-w-5xl space-y-px">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 w-full animate-pulse border-b border-hairline bg-paper-raised/50"
            />
          ))}
          {showBlurred ? (
            <div className="h-32 w-full animate-pulse border-b border-hairline bg-paper-raised/30" />
          ) : null}
        </div>
      </div>
    </section>
  );
}

// Suppress unused-import lint for the preserved Id type — exported in case
// callers want to type their own helpers around the same shape later.
export type { Id };
