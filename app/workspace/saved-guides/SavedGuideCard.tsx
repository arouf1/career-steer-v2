// app/workspace/saved-guides/SavedGuideCard.tsx
"use client";
import Link from "next/link";
import { X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";

export type SavedGuide = {
  guideId: Id<"career_guides">;
  title: string;
  slug: string;
  reactedAt: number;
  lane: "linear" | "adjacent" | "transformational" | null;
  whyMatchReason: string | null;
  arcScore: number | null;
};

export function SavedGuideCard({ saved }: { saved: SavedGuide }) {
  const removeSave = useMutation(api.discover.removeSave);
  const score = saved.arcScore != null ? Math.round(saved.arcScore * 100) : null;
  return (
    <div className="group relative flex flex-col gap-2 rounded-lg border border-hairline-strong bg-paper-raised p-4">
      <button
        type="button"
        onClick={() => void removeSave({ guideId: saved.guideId })}
        aria-label={`Remove ${saved.title} from saved`}
        className="absolute right-2 top-2 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100 hover:bg-paper-raised focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <X className="size-4" />
      </button>
      <div className="flex items-center justify-between gap-2">
        {saved.lane && (
          <Badge variant="secondary" className="text-[10px] uppercase">
            {saved.lane}
          </Badge>
        )}
        {score != null && (
          <span className="text-xs text-body">{score}% match</span>
        )}
      </div>
      <Link
        href={`/career-guides/${saved.slug}`}
        className="rounded-sm text-base font-medium text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        {saved.title}
      </Link>
      {saved.whyMatchReason && (
        <p className="line-clamp-2 text-xs italic text-body">
          {saved.whyMatchReason}
        </p>
      )}
      <span className="text-[11px] text-mute">
        Saved {new Date(saved.reactedAt).toLocaleDateString()}
      </span>
    </div>
  );
}
