"use client";

import { useMemo, useState } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import { Briefcase, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

  // Profile-resolved geo trumps IP-derived geo for signed-in users. Falls
  // back to anonymousGeo if the profile has no confirmed location.
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
  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  const onSearchLive = async () => {
    setSearchLivePending(true);
    setQuotaMessage(null);
    try {
      await searchLive({
        guideSlug,
        location: anonymousGeo.city,
        gl: viewer.countryCode,
      });
    } catch (err: unknown) {
      const data = (err as { data?: { kind?: string; retryAfterMs?: number } })
        ?.data;
      if (data?.kind === "quota_exceeded" && typeof data.retryAfterMs === "number") {
        const min = Math.max(1, Math.ceil(data.retryAfterMs / 60_000));
        setQuotaMessage(`Try again in ${min} min.`);
      } else {
        setQuotaMessage("Couldn't search right now. Try again soon.");
      }
    } finally {
      setSearchLivePending(false);
    }
  };

  if (!clerkLoaded || data === undefined) {
    return <JobsForGuideSkeleton showBlurred={!isSignedIn} />;
  }

  if (data.jobs.length === 0) {
    return (
      <Section guideTitle={guideTitle}>
        <JobsForGuideEmpty
          guideTitle={guideTitle}
          variant={isSignedIn ? "signed-in" : "anonymous"}
          onSearchLive={isSignedIn ? onSearchLive : undefined}
          searchLivePending={searchLivePending}
          signInRedirectUrl={pageUrl}
        />
        {quotaMessage ? (
          <p className="text-xs text-muted-foreground" role="status">
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
      <Section guideTitle={guideTitle}>
        <p className="text-sm text-muted-foreground">
          {heading} hiring {guideTitle}.
        </p>
        <div className="space-y-2">
          {visible.map((c) => (
            <JobsForGuideCard
              key={c.jobPostingId}
              job={c}
              viewerState="anonymous"
            />
          ))}
        </div>
        {blurred.length > 0 ? (
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
        ) : (
          // Soft footer for anonymous viewers when the archetype is small
          // enough that every cached card fits in the visible slot. Keeps
          // sign-in present without inventing a fake blurred stack.
          <div className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <span>Sign in to see how these match your profile.</span>
            <SignInButton mode="modal" forceRedirectUrl={pageUrl}>
              <Button size="sm" variant="ghost" className="h-7 text-xs">
                Sign in
              </Button>
            </SignInButton>
          </div>
        )}
      </Section>
    );
  }

  return (
    <Section guideTitle={guideTitle}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {heading} hiring {guideTitle}.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSearchLive}
          disabled={searchLivePending}
          className="text-xs"
        >
          <Search className="mr-1.5 size-3.5" aria-hidden />
          {searchLivePending ? "Searching…" : "Search live"}
        </Button>
      </div>
      <div className="space-y-2">
        {cards.map((c) => (
          <JobsForGuideCard
            key={c.jobPostingId}
            job={c}
            viewerState={viewerState}
          />
        ))}
      </div>
      {quotaMessage ? (
        <p className="text-xs text-muted-foreground" role="status">
          {quotaMessage}
        </p>
      ) : null}
    </Section>
  );
}

function Section({
  guideTitle,
  children,
}: {
  guideTitle: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="jobs-for-guide-heading"
      className="mx-auto mt-12 w-full max-w-2xl space-y-3 border-t px-4 pt-8"
    >
      <h2
        id="jobs-for-guide-heading"
        className="flex items-center gap-2 text-base font-semibold"
      >
        <Briefcase className="size-4 text-muted-foreground" aria-hidden />
        Jobs hiring {guideTitle}
      </h2>
      {children}
    </section>
  );
}

function JobsForGuideSkeleton({ showBlurred }: { showBlurred: boolean }) {
  return (
    <section className="mx-auto mt-12 w-full max-w-2xl space-y-3 border-t px-4 pt-8">
      <Skeleton className="h-5 w-48" />
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
        {showBlurred ? <Skeleton className="h-20 w-full opacity-50" /> : null}
      </div>
    </section>
  );
}

