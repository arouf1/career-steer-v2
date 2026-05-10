"use client";

// Subscribes to convex/jobPostingsImage.heroState so the detail-page hero
// flips from gradient placeholder to the real illustration the moment
// _markHeroComplete fires, no reload needed. Initial paint uses the SSR'd
// `initialUrl` (from getByPublicId's joined storage.getUrl call) so a posting
// with an already-generated image renders instantly without a placeholder
// flash. Once the Convex subscription delivers fresh state, that wins.

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Props = {
  jobPostingId: Id<"job_postings">;
  initialUrl: string | null;
  alt: string;
};

export function HeroImageLive({ jobPostingId, initialUrl, alt }: Props) {
  const live = useQuery(api.jobPostingsImage.heroState, { jobPostingId });

  // Cross-fade: keep showing the most recent good URL we've seen so the
  // placeholder doesn't flash back in if the storage signed URL refreshes
  // between subscription ticks. The url that lives in `live` is the source
  // of truth; this is only here to suppress that one-frame regression.
  const [imageError, setImageError] = useState(false);
  const liveUrl =
    live?.status === "complete" && live.url ? live.url : null;
  const url = liveUrl ?? initialUrl;

  if (url && !imageError) {
    return (
      // Brandfetch + Convex storage URLs are stable signed paths the user
      // already approved via JobPostingArticle's other <img> tag, same
      // rationale: keeps next.config out of the picture for now.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        width={1280}
        height={720}
        className="aspect-[16/9] w-full rounded-xl object-cover"
        onError={() => setImageError(true)}
      />
    );
  }

  // No image yet (initial generation in flight, or the upstream gen failed).
  // The placeholder is paper-raised rather than a tonal gradient. DESIGN.md
  // bans gradients globally and the earlier critique flagged the previous
  // from-ink/5 version. A subtle pulse signals "in flight" without leaning
  // on chroma; it falls silent once status moves out of generating.
  const isGenerating =
    live === undefined || live.status === "generating" || live.status === "idle";

  return (
    <div
      className={
        isGenerating
          ? "aspect-[16/9] w-full animate-pulse rounded-xl bg-paper-raised"
          : "aspect-[16/9] w-full rounded-xl bg-paper-raised"
      }
      aria-busy={isGenerating || undefined}
    />
  );
}
