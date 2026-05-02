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
    <div className="group relative flex flex-col gap-2 rounded-lg border border-hairline bg-paper p-4 shadow-sm">
      <button
        type="button"
        onClick={() => void removeSave({ guideId: saved.guideId })}
        aria-label={`Remove ${saved.title} from saved`}
        className="absolute right-2 top-2 rounded-full p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
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
          <span className="text-xs text-ink/60">{score}% match</span>
        )}
      </div>
      <Link
        href={`/career-guides/${saved.slug}`}
        className="text-base font-medium text-ink hover:underline"
      >
        {saved.title}
      </Link>
      {saved.whyMatchReason && (
        <p className="line-clamp-2 text-xs italic text-ink/60">
          {saved.whyMatchReason}
        </p>
      )}
      <span className="text-[11px] text-ink/40">
        Saved {new Date(saved.reactedAt).toLocaleDateString()}
      </span>
    </div>
  );
}
