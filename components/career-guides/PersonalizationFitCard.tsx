"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { RotateCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PersonalizeProfileCta } from "./PersonalizeProfileCta";
import { LoopingFeather } from "./LoopingFeather";
import { LoopingBrain } from "./LoopingBrain";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

type Props = {
  guideId: Id<"career_guides">;
  guideTitle: string;
};

export function PersonalizationFitCard({ guideId, guideTitle }: Props) {
  const result = useQuery(api.careerGuidePersonalizations.getForGuide, {
    guideId,
  });
  const trigger = useMutation(api.careerGuidePersonalizations.trigger);
  const retryEnrichment = useMutation(
    api.careerGuidePersonalizations.retryEnrichment,
  );

  // Drive trigger from observable state, not a one-shot ref. The mutation is
  // idempotent (noops on fresh-generating + up-to-date stamps), so each call
  // is safe. We re-fire when:
  //   - state becomes "ready" (initial mount, or after enrichment recovers
  //     from "stale" because the user just edited their profile/location)
  //   - OR the row's enrichment stamp changes (regen completed)
  //   - OR the row's status changes (generating → complete/failed transitions)
  // This catches mid-session profile edits without re-rendering inputs.
  const state = result?.state;
  const row = result?.state === "ready" ? result.row : null;
  const rowStatus = row?.status;
  const rowStamp = row?.enrichmentEnrichedAtStamp;
  useEffect(() => {
    if (state !== "ready") return;
    void trigger({ guideId });
  }, [state, rowStatus, rowStamp, trigger, guideId]);

  // Auto-retry enrichment on page load when we land in "enrichment-failed".
  // One attempt per mount: if it fails again we surface the manual retry
  // button (FitErrorCard) so the user isn't stuck in an infinite loop on a
  // persistent failure (e.g. malformed CV, model schema bug).
  const autoRetriedRef = useRef(false);
  useEffect(() => {
    if (state !== "enrichment-failed") return;
    if (autoRetriedRef.current) return;
    autoRetriedRef.current = true;
    void retryEnrichment({});
  }, [state, retryEnrichment]);

  // Stuck-pending recovery: if we sit in "profile-pending" for longer than
  // STUCK_THRESHOLD (well past the 5s debounce + 60s LLM timeout), assume
  // the previous enrichment crashed before writing markFailed and trigger
  // a manual retry. One attempt per mount.
  const STUCK_THRESHOLD_MS = 90_000;
  const stuckRetriedRef = useRef(false);
  useEffect(() => {
    if (state !== "profile-pending") return;
    if (stuckRetriedRef.current) return;
    const id = setTimeout(() => {
      if (stuckRetriedRef.current) return;
      stuckRetriedRef.current = true;
      void retryEnrichment({});
    }, STUCK_THRESHOLD_MS);
    return () => clearTimeout(id);
  }, [state, retryEnrichment]);

  if (!result || result.state === "anonymous") return null;

  if (result.state === "no-profile") {
    return <PersonalizeProfileCta id="your-fit" guideTitle={guideTitle} />;
  }

  if (result.state === "enrichment-failed") {
    // While the auto-retry is in flight (the enrichment mutation has fired
    // but the row hasn't yet flipped status), show the skeleton so the user
    // sees something is happening. Once the row flips to stale/pending, the
    // query re-fires and state moves to "profile-pending" automatically.
    if (autoRetriedRef.current) {
      return <FitSkeleton label="Retrying your personalisation..." />;
    }
    return <FitErrorCard reason={result.reason} />;
  }

  if (result.state === "profile-pending") {
    // Profile or enrichment has moved on since the last personalization, so
    // any stored content is by definition stale (e.g. references old
    // location). Always show the skeleton, never stale narrative.
    return <FitSkeleton label="Reading your profile..." />;
  }

  // result.state === "ready"
  if (!row || row.status === "generating") {
    // We only schedule a regenerate when the existing row's enrichment
    // stamp is older than the live enrichment, i.e. the existing content
    // is stale. So during "generating" we also avoid showing the row.content.
    return <FitSkeleton label="Personalising this guide for you..." />;
  }

  if (row.status === "failed") {
    return null;
  }

  // Complete
  const content = row.content;
  if (!content) return null;
  return <FitContent content={content.whyYoureAFit} />;
}

function FitContent({ content }: { content: string }) {
  return (
    <section
      id="your-fit"
      className="scroll-mt-24 border-t border-hairline py-14 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className={eyebrowCls}>Your fit</p>
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink/55">
          <LoopingBrain size={12} />
          Personalised
        </span>
      </div>
      <h2 className="mt-3 max-w-2xl text-balance text-3xl leading-[1.15] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-[2rem]">
        Why you're right for this.
      </h2>
      <div className="mt-7 max-w-2xl space-y-5">
        {content.split("\n").map((para, i) => (
          <p
            key={i}
            className="text-balance text-[17px] leading-[1.75] text-ink/80"
          >
            {para}
          </p>
        ))}
      </div>
    </section>
  );
}

function FitErrorCard({ reason }: { reason: string | null }) {
  const retry = useMutation(api.careerGuidePersonalizations.retryEnrichment);
  const [retrying, setRetrying] = useState(false);
  const [retried, setRetried] = useState(false);
  const onRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retry({});
      setRetried(true);
    } finally {
      setRetrying(false);
    }
  };
  return (
    <section
      id="your-fit"
      className="scroll-mt-24 border-t border-hairline py-14 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className={eyebrowCls}>Your fit</p>
        <span className="inline-flex items-center rounded-pill border border-state-warning/40 bg-state-warning/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink/70">
          Couldn't read your profile
        </span>
      </div>
      <h2 className="mt-3 max-w-2xl text-balance text-3xl leading-[1.15] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-[2rem]">
        We hit a snag personalising this for you.
      </h2>
      <p className="mt-5 max-w-2xl text-[17px] leading-[1.75] text-ink/75">
        Our profile analysis couldn't finish on the last attempt
        {reason ? ` (${reason})` : ""}. Tap retry to try again, or re-upload
        your CV from the profile page if it keeps failing.
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying || retried}
        className="mt-6 inline-flex items-center gap-2 rounded-pill border border-hairline bg-paper-raised px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RotateCw
          className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`}
          aria-hidden
        />
        {retrying ? "Retrying..." : retried ? "Retry scheduled" : "Retry"}
      </button>
    </section>
  );
}

function FitSkeleton({ label }: { label: string }) {
  return (
    <section
      id="your-fit"
      className="scroll-mt-24 border-t border-hairline py-14 first:border-t-0 first:pt-0"
    >
      <div className="flex items-center gap-3">
        <p className={eyebrowCls}>Your fit</p>
        <span className="inline-flex items-center rounded-pill border border-hairline px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink/40">
          Personalising
        </span>
      </div>
      <h2 className="mt-3 max-w-2xl text-balance text-3xl leading-[1.15] tracking-tight text-ink/30 [font-family:var(--font-serif)] sm:text-[2rem]">
        Why you're right for this.
      </h2>
      <div
        className="mt-7 flex max-w-2xl items-center gap-3 text-[14px] text-mute"
        aria-live="polite"
      >
        <LoopingFeather size={14} className="text-mute" />
        <span>{label}</span>
      </div>
      <div className="mt-6 max-w-2xl space-y-3" aria-hidden>
        <div className="h-3 w-full rounded-pill bg-ink/5" />
        <div className="h-3 w-[95%] rounded-pill bg-ink/5" />
        <div className="h-3 w-[88%] rounded-pill bg-ink/5" />
        <div className="h-3 w-[78%] rounded-pill bg-ink/5" />
        <div className="h-3 w-[92%] rounded-pill bg-ink/5" />
        <div className="h-3 w-[84%] rounded-pill bg-ink/5" />
        <div className="h-3 w-[90%] rounded-pill bg-ink/5" />
        <div className="h-3 w-[68%] rounded-pill bg-ink/5" />
      </div>
    </section>
  );
}
