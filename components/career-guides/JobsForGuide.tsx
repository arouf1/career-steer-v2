"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import { Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { describeLadderHit } from "@/lib/jobs/microcopy";
import {
  JobsForGuideCard,
  type JobCardData,
  type ViewerState,
} from "./JobsForGuideCard";
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

  const fit = useQuery(
    api.jobsForGuide.fitScores,
    isSignedIn && data && data.jobs.length > 0
      ? { jobIds: data.jobs.map((j) => j.jobPostingId) }
      : "skip",
  );

  const viewerState: ViewerState = !isSignedIn
    ? "anonymous"
    : fit
      ? "signed-in-with-profile"
      : "signed-in-no-profile";

  const fitByJobId = useMemo(() => {
    const m = new Map<string, "strong" | "worth" | null>();
    fit?.forEach((f) => m.set(f.jobPostingId as string, f.tier));
    return m;
  }, [fit]);

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
        location: anonymousGeo.city,
        gl: viewer.countryCode,
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
  }, [searchLive, guideSlug, anonymousGeo.city, viewer.countryCode]);

  // Auto-fire live search when a signed-in user scrolls the empty section
  // into view. Single-shot per (guide-page, mount) — the rate-limit on
  // searchLive (5/archetype/hour, 20/user/day) bounds cross-mount spend.
  // Anonymous viewers never auto-fire (cost gate).
  const emptyRef = useRef<HTMLDivElement>(null);
  const autoFiredRef = useRef(false);

  useEffect(() => {
    if (!isSignedIn) return;
    if (!data || data.jobs.length > 0) return;
    if (autoFiredRef.current || autoSearchAttempted) return;
    if (!emptyRef.current) return;

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
  }, [isSignedIn, data, autoSearchAttempted, onSearchLive]);

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

  const cards: JobCardData[] = data.jobs.map((j) => ({
    jobPostingId: j.jobPostingId as string,
    title: j.title,
    titleSlug: j.titleSlug,
    companyName: j.companyName,
    companySlug: j.companySlug,
    city: j.city,
    citySlug: j.citySlug,
    countryCode: j.countryCode,
    postedAt: j.postedAt,
    salaryDisplay: j.salaryDisplay,
    archetypeSlug: j.archetypeSlug,
    fitTier: fitByJobId.get(j.jobPostingId as string) ?? null,
  }));

  // Profile-derived city wins over IP-derived city when signed-in.
  const viewerCityLabel =
    isSignedIn && profileGeo?.cityName
      ? profileGeo.cityName
      : anonymousGeo.city;
  const viewerCountryLabel = labelForCountryCode(viewer.countryCode);

  const heading = describeLadderHit({
    ladderHit: data.ladderHit,
    pickedCitySlugs: cards.map((c) => c.citySlug),
    viewerCityLabel,
    viewerCountryLabel,
    total: data.totalArchetypeMatches,
  });

  if (!isSignedIn) {
    const visible = cards.slice(0, 3);
    const blurred = cards.slice(3, ANON_LIMIT);
    const remaining = Math.max(0, data.totalArchetypeMatches - visible.length);

    return (
      <Section guideTitle={guideTitle} ladderLabel={heading}>
        <ul className="space-y-3">
          {visible.map((c) => (
            <li key={c.jobPostingId}>
              <JobsForGuideCard job={c} viewerState="anonymous" />
            </li>
          ))}
        </ul>
        {blurred.length > 0 ? (
          <div className="mt-3">
            <JobsForGuideTeaseLock
              blurredPlaceholders={blurred}
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
            />
          </div>
        ) : (
          // Soft footer when the archetype is small enough that every cached
          // card fits in the visible slot. Keeps sign-in present without
          // inventing a fake blurred stack.
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
      <ul className="space-y-3">
        {cards.map((c) => (
          <li key={c.jobPostingId}>
            <JobsForGuideCard job={c} viewerState={viewerState} />
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
// hierarchy, same hairline top-border.
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
        <div className="mx-auto max-w-3xl">{children}</div>
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
        <div className="mx-auto max-w-3xl space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 w-full animate-pulse rounded-card border border-hairline bg-paper-raised"
            />
          ))}
          {showBlurred ? (
            <div className="h-24 w-full animate-pulse rounded-card border border-hairline bg-paper-raised opacity-60" />
          ) : null}
        </div>
      </div>
    </section>
  );
}
