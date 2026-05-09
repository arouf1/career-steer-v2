"use client";

import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

type Props = {
  fieldCount: number;
  onReupload: () => void;
};

export function ReviewCallout({ onReupload }: Props) {
  const markReviewed = useMutation(api.profiles.markReviewed);

  return (
    <section
      role="region"
      aria-label="Review your résumé"
      className="rounded-card border border-hairline bg-paper-raised p-6 sm:p-8"
    >
      <h2 className="type-headline text-ink">
        Here&rsquo;s what we noticed in your résumé.
      </h2>
      <p className="type-body text-body mt-4 max-w-prose">
        Tell us what we got wrong before they flow into your coaching.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => markReviewed({})}
          className="type-label rounded-pill bg-ink px-5 py-2.5 text-paper transition-colors hover:bg-ink-deep"
        >
          Looks right
        </button>
        <Link
          href="/workspace/profile/edit"
          className="type-label rounded-pill border border-hairline-strong px-5 py-2.5 text-ink transition-colors hover:border-ink"
        >
          Edit
        </Link>
        <button
          type="button"
          onClick={onReupload}
          className="type-label text-mute transition-colors hover:text-ink"
        >
          Re-upload
        </button>
      </div>
    </section>
  );
}
