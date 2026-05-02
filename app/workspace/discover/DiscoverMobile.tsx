// app/workspace/discover/DiscoverMobile.tsx
"use client";
import { useCallback, useMemo, useState } from "react";
import { Authenticated, useQuery, useMutation } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MobileGuideCard } from "./MobileGuideCard";
import { CardPreviewSheet, type CardPreviewData } from "./CardPreviewSheet";
import { DiscoverGenerating, DiscoverFailed } from "./DiscoverEmptyState";

const LANES = [
  { kind: "linear", label: "Linear" },
  { kind: "adjacent", label: "Adjacent" },
  { kind: "transformational", label: "Transformational" },
] as const;

export function DiscoverMobile() {
  return (
    <Authenticated>
      <DiscoverMobileInner />
    </Authenticated>
  );
}

function DiscoverMobileInner() {
  const { user } = useUser();
  const snapshot = useQuery(api.discover.getSnapshot);
  // Don't `?? []` here: a fresh `[]` literal would change reference every
  // render and bust the `reactionByGuide` memo. Handle the null case below.
  const reactions = useQuery(api.discover.querySavedGuides);
  const manualRefresh = useMutation(api.discover.manualRefresh);

  const [previewCard, setPreviewCard] = useState<CardPreviewData | null>(null);

  const reactionByGuide = useMemo(() => {
    const m = new Map<string, "saved">();
    if (reactions) {
      for (const r of reactions) m.set(r.guideId as string, "saved");
    }
    return m;
  }, [reactions]);

  const handleRefresh = useCallback(() => {
    void manualRefresh({});
  }, [manualRefresh]);

  if (
    snapshot === undefined ||
    snapshot === null ||
    snapshot.status === "generating"
  ) {
    return <DiscoverGenerating />;
  }
  if (snapshot.status === "failed") {
    return <DiscoverFailed onRetry={handleRefresh} />;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">
            {user?.fullName ?? "You"}
          </div>
          <div className="truncate text-xs text-ink/60">Discover</div>
        </div>
      </header>

      <Tabs defaultValue="linear" className="flex-1">
        <TabsList className="sticky top-0 z-10 grid w-full grid-cols-3 rounded-none border-b border-hairline bg-paper">
          {LANES.map((lane) => {
            const count =
              snapshot.lanes.find((l) => l.kind === lane.kind)?.cards.length ??
              0;
            return (
              <TabsTrigger
                key={lane.kind}
                value={lane.kind}
                className="text-xs"
              >
                {lane.label} · {count}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {LANES.map((lane) => {
          const cards =
            snapshot.lanes.find((l) => l.kind === lane.kind)?.cards ?? [];
          return (
            <TabsContent
              key={lane.kind}
              value={lane.kind}
              className="space-y-2 p-3"
            >
              {cards.length === 0 && (
                <div className="rounded-md border border-hairline p-4 text-center text-xs text-ink/60">
                  Still finding more for you
                </div>
              )}
              {cards.map((c) => (
                <MobileGuideCard
                  key={c.guideId}
                  card={{
                    guideId: c.guideId,
                    title: c.title,
                    slotKind: c.slotKind,
                    whyMatchReason: c.whyMatchReason,
                    arcScore: c.arcScore,
                    reaction: reactionByGuide.get(c.guideId as string),
                  }}
                  onTap={() => setPreviewCard(c as unknown as CardPreviewData)}
                />
              ))}
            </TabsContent>
          );
        })}
      </Tabs>

      <CardPreviewSheet
        card={previewCard}
        open={previewCard !== null}
        onOpenChange={(o) => !o && setPreviewCard(null)}
      />
    </div>
  );
}
