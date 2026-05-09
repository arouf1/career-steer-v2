"use client";

// Editorial row for a single saved career guide. Lane grouping happens at
// the parent (SavedGuidesClient) — this component owns one row's typography,
// match-tier rendering, and hover-revealed Unsave affordance.
//
// Match phrasing mirrors JobCardRow.tsx's FitTag: qualitative tiers ("Strong
// match" / "Worth exploring") replacing v1's numeric percentage. The numeric
// percentage was an AI-product cliché — see JobCardRow.tsx:9-11.

import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type SavedGuide = {
  guideId: Id<"career_guides">;
  title: string;
  slug: string;
  reactedAt: number;
  lane: "linear" | "adjacent" | "earlier" | "transformational" | null;
  whyMatchReason: string | null;
  arcScore: number | null;
};

function formatSavedAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return "just now";
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

type MatchTier = "strong" | "explore" | null;

function arcScoreTier(arcScore: number | null): MatchTier {
  if (arcScore == null) return null;
  if (arcScore >= 0.65) return "strong";
  if (arcScore >= 0.4) return "explore";
  return null;
}

export function SavedGuideCard({ saved }: { saved: SavedGuide }) {
  const removeSave = useMutation(api.discover.removeSave);
  const tier = arcScoreTier(saved.arcScore);
  const matchLabel =
    tier === "strong"
      ? "Strong match"
      : tier === "explore"
        ? "Worth exploring"
        : null;

  return (
    <article className="group relative border-b border-hairline transition-colors duration-300 hover:bg-ink/[0.02]">
      <div className="flex flex-col gap-3 px-2 py-8 sm:px-4 sm:py-10">
        <Link
          href={`/career-guides/${saved.slug}`}
          className="block max-w-3xl rounded-sm transition-colors hover:text-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
        >
          <h3 className="type-headline text-balance text-ink [font-size:clamp(1.25rem,2.4vw,1.625rem)] [line-height:1.2]">
            {saved.title}
          </h3>
        </Link>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="type-label uppercase text-mute">
            Saved {formatSavedAgo(saved.reactedAt)}
          </span>
          {matchLabel && (
            <>
              <span aria-hidden className="h-px w-6 bg-hairline-strong" />
              <span
                className={
                  tier === "strong"
                    ? "type-label uppercase text-ink"
                    : "type-label uppercase text-ink-soft"
                }
              >
                {matchLabel}
              </span>
            </>
          )}
        </p>

        {saved.whyMatchReason && (
          <p className="max-w-2xl text-balance [font-family:var(--font-serif)] text-[15px] italic leading-relaxed text-body">
            {saved.whyMatchReason}
          </p>
        )}
      </div>

      <div className="absolute right-0 top-8 sm:right-2 sm:top-10">
        <button
          type="button"
          onClick={() => void removeSave({ guideId: saved.guideId })}
          aria-label={`Remove ${saved.title} from saved`}
          className="type-label rounded-pill px-3 py-1.5 uppercase text-mute opacity-0 transition-opacity duration-200 hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 group-hover:opacity-100"
        >
          Unsave
        </button>
      </div>
    </article>
  );
}
