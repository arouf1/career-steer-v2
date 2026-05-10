"use client";

// Save / unsave control for the career-guide masthead. Mirrors the icon
// vocabulary used by CardPreviewSheet and SavedGuideCard so the same idea
// (filled Bookmark = saved, BookmarkOff hover = remove) reads consistently
// across discover, sheet, and article surfaces.
//
// Only renders for authenticated users. Logged-out visitors see nothing
// (the public-page experience is unchanged); the existing `Authenticated`
// gate keeps SSR clean and avoids a hydration flash.

import { Bookmark, BookmarkOff } from "lucide-react";
import { Authenticated, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function CareerGuideSaveButton({
  guideId,
  guideTitle,
}: {
  guideId: Id<"career_guides">;
  guideTitle: string;
}) {
  // Separator lives inside the Authenticated gate so logged-out users
  // don't see a stray dot in the byline meta row. Mirrors the dotted
  // rhythm used by the other meta items (Published · Updated · …).
  return (
    <Authenticated>
      <span aria-hidden className="text-mute/40">
        ·
      </span>
      <SaveButtonInner guideId={guideId} guideTitle={guideTitle} />
    </Authenticated>
  );
}

function SaveButtonInner({
  guideId,
  guideTitle,
}: {
  guideId: Id<"career_guides">;
  guideTitle: string;
}) {
  const reaction = useQuery(api.discover.getReactionForGuide, { guideId });
  const save = useMutation(api.discover.saveGuide);
  const removeSave = useMutation(api.discover.removeSave);

  // Reserve space while the reaction subscription is loading so the
  // dateline row doesn't reflow when the button finally appears.
  if (reaction === undefined) {
    return <span aria-hidden className="inline-block h-7 w-[5.5rem]" />;
  }

  if (reaction === "saved") {
    return (
      <button
        type="button"
        onClick={() => void removeSave({ guideId })}
        aria-label={`Remove ${guideTitle} from saved`}
        className="group/save inline-flex items-center gap-1.5 rounded-pill border border-hairline px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-ink-deep hover:bg-paper-raised"
      >
        <span className="relative grid h-3.5 w-3.5 place-items-center">
          <Bookmark
            className="h-3.5 w-3.5 transition-opacity duration-150 group-hover/save:opacity-0"
            fill="currentColor"
            strokeWidth={1.75}
            aria-hidden
          />
          <BookmarkOff
            className="absolute h-3.5 w-3.5 opacity-0 transition-opacity duration-150 group-hover/save:opacity-100"
            strokeWidth={1.75}
            aria-hidden
          />
        </span>
        <span className="group-hover/save:hidden">Saved</span>
        <span className="hidden group-hover/save:inline">Unsave</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void save({ guideId })}
      className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-ink-deep hover:bg-paper-raised"
    >
      <Bookmark className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
      Save
    </button>
  );
}
