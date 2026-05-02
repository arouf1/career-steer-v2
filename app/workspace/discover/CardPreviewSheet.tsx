"use client";
import Link from "next/link";
import { Bookmark, X, ExternalLink } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type CardPreviewData = {
  guideId: Id<"career_guides">;
  title: string;
  slug: string;
  slotKind: "strong" | "bridge" | "aspirational" | "extra";
  whyMatchReason: string;
  overview: string;
  typicalSkills: string[];
  reaction?: "saved" | "dismissed";
};

const SLOT_LABEL: Record<CardPreviewData["slotKind"], string> = {
  strong: "Strong fit",
  bridge: "Skill bridge",
  aspirational: "Aspirational",
  extra: "More to explore",
};

export function CardPreviewSheet({
  card,
  open,
  onOpenChange,
}: {
  card: CardPreviewData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useMutation(api.discover.saveGuide);
  const dismiss = useMutation(api.discover.dismissGuide);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
        {card && (
          <>
            <SheetHeader className="space-y-2">
              <Badge variant="secondary" className="w-fit">
                {SLOT_LABEL[card.slotKind]}
              </Badge>
              <SheetTitle className="text-2xl">{card.title}</SheetTitle>
              <SheetDescription className="italic">
                {card.whyMatchReason}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <p className="text-sm leading-relaxed text-ink/80 line-clamp-6">
                {card.overview}
              </p>
              {card.typicalSkills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {card.typicalSkills.map((s) => (
                    <Badge key={s} variant="outline" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2 pt-4">
                <Button asChild className="w-full justify-center">
                  <Link href={`/career-guides/${card.slug}`}>
                    Read full guide <ExternalLink className="ml-1 size-3.5" />
                  </Link>
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant={card.reaction === "saved" ? "default" : "outline"}
                    className="flex-1"
                    onClick={async () => {
                      await save({ guideId: card.guideId });
                      onOpenChange(false);
                    }}
                  >
                    <Bookmark className="mr-1 size-4" /> Save
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={async () => {
                      await dismiss({ guideId: card.guideId });
                      onOpenChange(false);
                    }}
                  >
                    <X className="mr-1 size-4" /> Not for me
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
