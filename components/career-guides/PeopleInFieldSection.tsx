"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Lock, MessageSquare, RotateCw, Search, Users } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { PersonCard } from "./PersonCard";
import { LoopingFeather } from "./LoopingFeather";
import { useKeyPeople } from "./useKeyPeople";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

const SEARCH_VERBS = [
  "Reading LinkedIn profiles",
  "Sorting by relevance",
  "Drafting summaries",
  "Spotting the right people",
];

type Props = {
  guideId: Id<"career_guides">;
  guideTitle: string;
};

export function PeopleInFieldSection({ guideId, guideTitle }: Props) {
  const { state, people, search, serverError, actionError, retryAfterMs } =
    useKeyPeople(guideId);

  return (
    <section
      id="people"
      className="scroll-mt-24 border-t border-hairline py-14"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className={eyebrowCls}>Section seven</p>
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink/55">
          <Users className="h-2.5 w-2.5" aria-hidden strokeWidth={1.75} />
          For you
        </span>
      </div>
      <h2 className="mt-3 text-balance text-3xl leading-[1.15] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-[2rem]">
        People in this field.
      </h2>
      <p className="mt-5 max-w-2xl text-balance text-[17px] leading-[1.75] text-ink/75">
        See who&rsquo;s actually doing this work today. We&rsquo;ll surface a
        handful of {guideTitle.toLowerCase()}s on LinkedIn and help you draft a
        thoughtful first message.
      </p>

      {state === "anonymous" ? (
        <AnonymousTeaser guideTitle={guideTitle} />
      ) : (
        <SignedInBody
          state={state}
          people={people}
          guideTitle={guideTitle}
          serverError={serverError}
          actionError={actionError}
          retryAfterMs={retryAfterMs}
          search={search}
        />
      )}
    </section>
  );
}

type SignedInBodyProps = {
  state: ReturnType<typeof useKeyPeople>["state"];
  people: ReturnType<typeof useKeyPeople>["people"];
  guideTitle: string;
  serverError: string | null;
  actionError: string | null;
  retryAfterMs: number | null;
  search: () => Promise<void>;
};

function SignedInBody({
  state,
  people,
  guideTitle,
  serverError,
  actionError,
  retryAfterMs,
  search,
}: SignedInBodyProps) {
  const inFlight = state === "running";
  const hasPeople = people.length > 0;

  return (
    <div className="mt-8 max-w-3xl">
        {state === "idle" && (
          <IdleCta onSearch={search} guideTitle={guideTitle} />
        )}

        {inFlight && !hasPeople && <SearchingSkeleton />}

        {hasPeople && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {people.map((p) => (
              <PersonCard key={p._id} person={p} />
            ))}
          </div>
        )}

        {hasPeople && inFlight && (
          <div
            className="mt-5 inline-flex items-center gap-2 text-[13px] text-mute"
            aria-live="polite"
          >
            <LoopingFeather size={13} className="text-mute" />
            Looking for more matches…
          </div>
        )}

        {state === "failed" && !hasPeople && (
          <FailedCta error={serverError} onRetry={search} />
        )}

        {hasPeople && !inFlight && (
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={search}
              className="inline-flex items-center gap-2 rounded-pill border border-hairline bg-paper-raised px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
              Find more
            </button>
          </div>
        )}

        {actionError && (
          <p className="mt-4 text-[13px] text-state-warning">{actionError}</p>
        )}
        {retryAfterMs !== null && (
          <p className="mt-2 text-[12px] text-mute">
            Search limit reached for this hour. Try again later.
          </p>
        )}
    </div>
  );
}

// Mock people for the signed-out blurred preview. Names + roles are fictional;
// the goal is to give the reader a clear *shape* of what they'll get when they
// sign in (avatar + headline + summary + "Why them" + CTAs), not real data.
const TEASER_PEOPLE: ReadonlyArray<{
  initials: string;
  tint: string;
  name: string;
  headline: string;
  summary: string;
  why: string;
}> = [
  {
    initials: "AC",
    tint: "bg-[oklch(0.94_0.025_30)]",
    name: "Alex Chen",
    headline: "Senior practitioner with 8 years in the field",
    summary:
      "Came up through a related discipline before specialising. Now leads a small team and writes occasionally about how the work has changed.",
    why: "Has actively transitioned into this work and speaks openly about the trade-offs.",
  },
  {
    initials: "MR",
    tint: "bg-[oklch(0.94_0.02_245)]",
    name: "Morgan Reyes",
    headline: "Director-level, recently promoted from individual contributor",
    summary:
      "Spent five years as a senior individual contributor before stepping into leadership. Posts thoughtful takes on what the role really involves at scale.",
    why: "Useful perspective on the IC-to-leadership inflection point in this field.",
  },
  {
    initials: "JK",
    tint: "bg-[oklch(0.94_0.025_140)]",
    name: "Jamie Kowalski",
    headline: "Independent practitioner / consultant",
    summary:
      "Left a large firm three years ago to run an independent practice. Writes about pricing, positioning, and the realities of going solo in this industry.",
    why: "Different operating model from the typical career path; strong views on autonomy.",
  },
];

function AnonymousTeaser({ guideTitle }: { guideTitle: string }) {
  return (
    <div className="relative mt-8 max-w-3xl">
      {/* Blurred mock cards behind the CTA */}
      <div
        className="pointer-events-none grid grid-cols-1 gap-4 blur-[6px] saturate-75 md:grid-cols-2"
        aria-hidden
      >
        {TEASER_PEOPLE.slice(0, 4).map((p, i) => (
          <article
            key={i}
            className="flex h-full flex-col rounded-card border border-hairline bg-paper-raised p-6"
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-pill border border-hairline ${p.tint}`}
              >
                <span className="text-[13px] font-medium text-ink/70">
                  {p.initials}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-medium leading-tight text-ink">
                  {p.name}
                </p>
                <p className="mt-1 text-[13px] leading-snug text-mute">
                  {p.headline}
                </p>
              </div>
            </div>
            <p className="mt-5 text-[14px] leading-relaxed text-ink/80">
              {p.summary}
            </p>
            <div className="mt-5 rounded-card border border-hairline bg-paper px-4 py-3">
              <p className={eyebrowCls}>Why them</p>
              <p className="mt-1.5 text-[13px] leading-snug text-ink/80">
                {p.why}
              </p>
            </div>
            <div className="mt-6 flex items-center gap-2">
              <div className="h-9 flex-1 rounded-pill bg-ink" />
              <div className="h-9 w-24 rounded-pill border border-hairline bg-paper" />
            </div>
          </article>
        ))}
      </div>

      {/* Soft fade so the cards dissolve into the page rather than ending
          in a hard blurred edge. Sits above the blur, below the CTA. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-paper"
      />

      {/* CTA card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.65, 0.3, 1] }}
        className="absolute left-1/2 top-1/2 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline bg-paper px-6 py-7 text-center shadow-[0_24px_60px_-24px_rgba(20,20,20,0.18)] sm:px-8 sm:py-8"
      >
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink/55">
          <Lock className="h-2.5 w-2.5" aria-hidden strokeWidth={1.75} />
          Members only
        </span>
        <h3 className="mt-4 text-balance text-[20px] font-medium leading-tight text-ink [font-family:var(--font-serif)] sm:text-[22px]">
          See who&rsquo;s doing this work today.
        </h3>
        <p className="mt-3 text-balance text-[14px] leading-relaxed text-ink/75">
          Sign up to surface real {guideTitle.toLowerCase()}s on LinkedIn,
          ranked against your background, with a tailored first-message draft
          ready to send.
        </p>
        <ul className="mt-5 space-y-2 text-left text-[13px] leading-snug text-ink/80">
          <li className="flex items-start gap-2.5">
            <Users
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-soft"
              aria-hidden
              strokeWidth={1.75}
            />
            Real profiles ranked against your CV
          </li>
          <li className="flex items-start gap-2.5">
            <MessageSquare
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-soft"
              aria-hidden
              strokeWidth={1.75}
            />
            One-click outreach drafts in your voice
          </li>
        </ul>
        <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center gap-2 rounded-pill bg-ink px-5 py-2.5 text-[13px] font-medium text-paper transition-colors hover:bg-ink-deep"
          >
            Sign up free
            <ArrowRight className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-pill border border-hairline bg-paper px-5 py-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-paper-raised"
          >
            I have an account
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

function IdleCta({
  guideTitle,
  onSearch,
}: {
  guideTitle: string;
  onSearch: () => void;
}) {
  const [pending, setPending] = useState(false);
  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onSearch();
    } finally {
      setPending(false);
    }
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.65, 0.3, 1] }}
      className="rounded-card border border-hairline bg-paper-raised px-6 py-7 sm:px-8 sm:py-8"
    >
      <h3 className="text-[18px] font-medium text-ink">
        See who&rsquo;s doing this work today.
      </h3>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink/75">
        We&rsquo;ll search LinkedIn for {guideTitle.toLowerCase()}s, rank them
        against your background, and let you draft a tailored first message in
        a couple of clicks.
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="mt-6 inline-flex items-center gap-2 rounded-pill bg-ink px-5 py-2.5 text-[13px] font-medium text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Search className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
        {pending ? "Starting…" : "Find people in this field"}
      </button>
    </motion.div>
  );
}

function FailedCta({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const [pending, setPending] = useState(false);
  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onRetry();
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="rounded-card border border-hairline bg-paper-raised px-6 py-7">
      <h3 className="text-[16px] font-medium text-ink">
        We hit a snag finding people.
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-ink/70">
        {error ?? "Sometimes LinkedIn doesn't surface clean matches. Try once more in a moment."}
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="mt-5 inline-flex items-center gap-2 rounded-pill border border-hairline bg-paper px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RotateCw
          className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}
          aria-hidden
          strokeWidth={1.75}
        />
        {pending ? "Trying again…" : "Try again"}
      </button>
    </div>
  );
}

function SearchingSkeleton() {
  const [verbIdx, setVerbIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setVerbIdx((i) => (i + 1) % SEARCH_VERBS.length),
      2200,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div>
      <div
        className="inline-flex items-center gap-2 text-[13px] text-mute"
        aria-live="polite"
      >
        <LoopingFeather size={13} className="text-mute" />
        {SEARCH_VERBS[verbIdx]}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-card border border-hairline bg-paper-raised p-6"
          >
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 shrink-0 animate-pulse rounded-pill bg-ink/5" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/5 animate-pulse rounded-pill bg-ink/5" />
                <div className="h-3 w-4/5 animate-pulse rounded-pill bg-ink/5" />
              </div>
            </div>
            <div className="mt-5 space-y-2">
              <div className="h-3 w-full animate-pulse rounded-pill bg-ink/5" />
              <div className="h-3 w-[92%] animate-pulse rounded-pill bg-ink/5" />
              <div className="h-3 w-[78%] animate-pulse rounded-pill bg-ink/5" />
            </div>
            <div className="mt-6 h-9 w-full animate-pulse rounded-pill bg-ink/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
