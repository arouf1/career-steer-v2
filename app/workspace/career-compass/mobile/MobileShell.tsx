"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Authenticated, useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { useMotionValue, useReducedMotion } from "motion/react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { COMPASS_LANE_ORDER } from "../lib/mobileCompassGeometry";
import type { CompassCard, CompassLane } from "../lib/mobileCompassTypes";
import { MobileCompass } from "./MobileCompass";
import { MobileLanePager } from "./MobileLanePager";
import { MobileLaneFeed, type LaneFeedHandle } from "./MobileLaneFeed";
import { MobileCardSheet } from "./MobileCardSheet";

export function MobileShell() {
  return (
    <Authenticated>
      <MobileShellInner />
    </Authenticated>
  );
}

function MobileShellInner() {
  const { user } = useUser();
  const snapshot = useQuery(api.discover.getSnapshot);
  // Don't `?? []` here — a fresh `[]` literal would change reference each
  // render and bust the `reactionByGuide` memo. Handle null below.
  const reactions = useQuery(api.discover.querySavedGuides);
  const manualRefresh = useMutation(api.discover.manualRefresh);

  const prefersReducedMotion = useReducedMotion() ?? false;

  // Continuous motion values for compass-feed coupling.
  const scrollY = useMotionValue(0);
  const dragProgress = useMotionValue(0);

  const [activeIndex, setActiveIndex] = useState(0);
  const activeLane: CompassLane = COMPASS_LANE_ORDER[activeIndex];

  // Card preview sheet.
  const [previewCard, setPreviewCard] = useState<CompassCard | null>(null);

  // One-shot flash signal for compass dot bloom on save/dismiss.
  const [lastFlash, setLastFlash] = useState<{
    guideId: string;
    kind: "save" | "dismiss";
    ts: number;
  } | null>(null);

  // Refs to each lane's scroll handle so we can sync scrollY on lane switch.
  const laneRefs = useRef<Array<LaneFeedHandle | null>>([null, null, null, null]);

  // Reactions → guideId map.
  const reactionByGuide = useMemo(() => {
    const m = new Map<string, "saved">();
    if (reactions) {
      for (const r of reactions) m.set(r.guideId as string, "saved");
    }
    return m;
  }, [reactions]);

  // Auto-trigger first-time generation when the user has no snapshot row.
  // Same pattern as DiscoverCanvas / DiscoverMobile; `manualRefresh` is
  // debounce-gated server-side.
  useEffect(() => {
    if (snapshot === null) {
      void manualRefresh({});
    }
  }, [snapshot, manualRefresh]);

  // Bucket cards by lane and tag with their lane (so the dot positioner
  // knows which quadrant). Sorted by lane order, then slotKind, then
  // arcScore — the compass uses this order for its dot reveal stagger.
  const compassCards: ReadonlyArray<CompassCard> = useMemo(() => {
    if (!snapshot || snapshot.status !== "ready") return [];
    const tierWeight: Record<CompassCard["slotKind"], number> = {
      strong: 0,
      bridge: 1,
      aspirational: 2,
      extra: 3,
    };
    const result: CompassCard[] = [];
    for (const lane of COMPASS_LANE_ORDER) {
      const laneCards =
        snapshot.lanes.find((l) => l.kind === lane)?.cards ?? [];
      for (const c of laneCards) {
        result.push({
          guideId: c.guideId,
          title: c.title,
          slug: c.slug,
          slotKind: c.slotKind,
          whyMatchReason: c.whyMatchReason,
          arcScore: c.arcScore,
          overview: c.overview,
          typicalSkills: c.typicalSkills,
          lane,
        });
      }
    }
    result.sort((a, b) => {
      const li = COMPASS_LANE_ORDER.indexOf(a.lane);
      const lj = COMPASS_LANE_ORDER.indexOf(b.lane);
      if (li !== lj) return li - lj;
      const ti = tierWeight[a.slotKind];
      const tj = tierWeight[b.slotKind];
      if (ti !== tj) return ti - tj;
      return b.arcScore - a.arcScore;
    });
    return result;
  }, [snapshot]);

  const cardsByLane = useMemo(() => {
    const m: Record<CompassLane, CompassCard[]> = {
      linear: [],
      adjacent: [],
      earlier: [],
      transformational: [],
    };
    for (const c of compassCards) m[c.lane].push(c);
    return m;
  }, [compassCards]);

  const laneCounts: Record<CompassLane, number> = useMemo(
    () => ({
      linear: cardsByLane.linear.length,
      adjacent: cardsByLane.adjacent.length,
      earlier: cardsByLane.earlier.length,
      transformational: cardsByLane.transformational.length,
    }),
    [cardsByLane],
  );

  // Pick a sensible default lane on first load — Linear if it has cards,
  // otherwise the first non-empty lane in the canonical order. Only runs
  // once after snapshot becomes ready.
  const didDefaultRef = useRef(false);
  useEffect(() => {
    if (didDefaultRef.current) return;
    if (!snapshot || snapshot.status !== "ready") return;
    const target = COMPASS_LANE_ORDER.findIndex(
      (lane) => laneCounts[lane] > 0,
    );
    if (target > 0) setActiveIndex(target);
    didDefaultRef.current = true;
  }, [snapshot, laneCounts]);

  // Snapshot status → compass visual state.
  const compassState: "loading" | "ready" | "failed" = useMemo(() => {
    if (snapshot === undefined) return "loading";
    if (snapshot === null) return "loading";
    if (snapshot.status === "generating") return "loading";
    if (snapshot.status === "failed") return "failed";
    return "ready";
  }, [snapshot]);

  // Initials for the YOU avatar.
  const initials =
    (user?.firstName?.[0] ?? "Y") + (user?.lastName?.[0] ?? "ou");

  // Pull-to-refresh handler — calls manualRefresh, returns a promise that
  // resolves once we've kicked off the regeneration. The snapshot status
  // will flip to "generating" via subscription which puts the compass back
  // into sonar state.
  const handleRefresh = useCallback(async () => {
    await manualRefresh({});
    // No need to await further — the compass observes the status.
  }, [manualRefresh]);

  const handleUserSettle = useCallback(
    (idx: number) => {
      triggerHaptic(prefersReducedMotion);
      // Sync scrollY to the new active lane's actual scroll position so
      // the compass shrink matches what the user is seeing.
      const top = laneRefs.current[idx]?.getScrollTop() ?? 0;
      scrollY.set(top);
    },
    [prefersReducedMotion, scrollY],
  );

  const handleIndexChange = useCallback((idx: number) => {
    setActiveIndex(idx);
  }, []);

  return (
    <div className="flex h-full flex-col bg-paper">
      {/* Compass header — sticky with hairline below */}
      <header className="border-b border-hairline px-4 pb-2 pt-2">
        <MobileCompass
          state={compassState}
          cards={compassCards}
          activeLane={activeLane}
          laneCounts={laneCounts}
          dragProgress={dragProgress}
          scrollY={scrollY}
          initials={initials}
          lastFlash={lastFlash}
          prefersReducedMotion={prefersReducedMotion}
        />

        {compassState === "failed" && (
          <div className="mt-4 flex flex-col items-center gap-2 px-4">
            <p className="text-center font-serif text-base italic leading-relaxed text-mute">
              We couldn&apos;t read your landscape. Try again.
            </p>
            <Button
              type="button"
              onClick={() => void manualRefresh({})}
              className="rounded-pill bg-ink text-paper hover:bg-ink-deep"
            >
              Try again
            </Button>
          </div>
        )}

        {compassState === "loading" && (
          <p className="mt-3 text-center text-[12px] italic text-mute">
            Reading your landscape…
          </p>
        )}
      </header>

      {/* Lane pager fills the remainder. Only mount when we have a ready
          snapshot — keeps the visible chrome focused on the compass during
          loading/failure. */}
      <main className="flex-1 overflow-hidden">
        {compassState === "ready" && (
          <MobileLanePager
            activeIndex={activeIndex}
            onIndexChange={handleIndexChange}
            dragProgress={dragProgress}
            onUserSettle={handleUserSettle}
            pages={COMPASS_LANE_ORDER.map((lane, i) => (
              <MobileLaneFeed
                key={lane}
                ref={(el) => {
                  laneRefs.current[i] = el;
                }}
                lane={lane}
                cards={cardsByLane[lane]}
                reactionByGuide={reactionByGuide}
                onCardTap={setPreviewCard}
                isActive={i === activeIndex}
                onRefresh={handleRefresh}
                onScrollY={(top) => scrollY.set(top)}
              />
            ))}
          />
        )}
      </main>

      <MobileCardSheet
        card={previewCard}
        open={previewCard !== null}
        onOpenChange={(o) => !o && setPreviewCard(null)}
        reaction={
          previewCard
            ? reactionByGuide.get(previewCard.guideId as string)
            : undefined
        }
        onSaved={(guideId) =>
          setLastFlash({ guideId, kind: "save", ts: Date.now() })
        }
        onDismissed={(guideId) =>
          setLastFlash({ guideId, kind: "dismiss", ts: Date.now() })
        }
      />
    </div>
  );
}

function triggerHaptic(reducedMotion: boolean) {
  if (reducedMotion) return;
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(8);
  } catch {
    // Silently ignore — Android Chrome supports it; iOS Safari ignores it
    // already. No need to surface anything.
  }
}
