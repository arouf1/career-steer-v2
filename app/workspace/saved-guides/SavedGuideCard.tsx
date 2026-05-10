"use client";

// Editorial row for a single saved career guide. Lane grouping happens at
// the parent (SavedGuidesClient), this component owns one row's typography,
// match-tier rendering, thumbnail, and hover-revealed Unsave affordance.
//
// Match phrasing mirrors JobCardRow.tsx's FitTag: qualitative tiers ("Strong
// match" / "Worth exploring") replacing v1's numeric percentage. The numeric
// percentage was an AI-product cliché, see JobCardRow.tsx:9-11.

import Link from "next/link";
import Image from "next/image";
import { Bookmark, BookmarkOff } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type SavedGuide = {
  guideId: Id<"career_guides">;
  title: string;
  slug: string;
  illustrationUrl: string | null;
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
      <div className="flex gap-5 px-2 py-8 sm:gap-7 sm:px-4 sm:py-10">
        <Link
          href={`/career-guides/${saved.slug}`}
          aria-hidden
          tabIndex={-1}
          className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-surface border border-hairline bg-paper-raised sm:w-32"
        >
          {saved.illustrationUrl ? (
            <Image
              src={saved.illustrationUrl}
              alt=""
              fill
              sizes="(min-width: 640px) 128px, 96px"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="absolute inset-0 bg-paper" aria-hidden />
          )}
        </Link>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
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
            <p className="max-w-2xl text-balance text-[15px] leading-relaxed text-body">
              {saved.whyMatchReason}
            </p>
          )}
        </div>
      </div>

      <div className="absolute right-0 top-8 sm:right-2 sm:top-10">
        <button
          type="button"
          onClick={() => void removeSave({ guideId: saved.guideId })}
          aria-label={`Remove ${saved.title} from saved`}
          // Filled Bookmark by default reads as a persistent saved-status
          // marker. Hovering the button swaps to BookmarkOff to surface the
          // "click to remove" intent without needing copy.
          className="group/btn relative grid h-8 w-8 place-items-center rounded-pill text-mute transition-colors duration-200 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
        >
          <Bookmark
            className="h-4 w-4 transition-opacity duration-150 group-hover/btn:opacity-0"
            fill="currentColor"
            strokeWidth={1.75}
            aria-hidden
          />
          <BookmarkOff
            className="absolute h-4 w-4 opacity-0 transition-opacity duration-150 group-hover/btn:opacity-100"
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
      </div>
    </article>
  );
}
