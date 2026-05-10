"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Authenticated, useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { useMotionValue, useReducedMotion } from "motion/react";
import { RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { COMPASS_LANE_ORDER } from "../lib/mobileCompassGeometry";
import type { CompassCard, CompassLane } from "../lib/mobileCompassTypes";
import { MobileCompass } from "./MobileCompass";
import { MobileLanePager } from "./MobileLanePager";
import { MobileLaneFeed, type LaneFeedHandle } from "./MobileLaneFeed";
import { MobileCardSheet } from "./MobileCardSheet";
import { CompassVoiceDock } from "@/components/career-compass/voice/CompassVoiceDock";
import type { CompassToolCallbacks } from "@/components/career-compass/voice/useCompassVoiceCall";

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
  // Don't `?? []` here, a fresh `[]` literal would change reference each
  // render and bust the `reactionByGuide` memo. Handle null below.
  const reactions = useQuery(api.discover.querySavedGuides);
  const manualRefresh = useMutation(api.discover.manualRefresh);
  const saveGuide = useMutation(api.discover.saveGuide);
  const removeSave = useMutation(api.discover.removeSave);
  const dismissGuide = useMutation(api.discover.dismissGuide);
  const undismissGuide = useMutation(api.discover.undismissGuide);
  const dismissedGuides = useQuery(api.discover.queryDismissedGuides);

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

  // Refs to each lane's scroll handle so we can sync scrollY when the user
  // switches lanes. Otherwise, swiping from a deep-scrolled dense lane to
  // a sparse lane would leave the compass shrunk against scrollTop=0 on
  // the new lane, feels disconnected.
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
  // arcScore, the compass uses this order for its dot reveal stagger.
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

  // Pick a sensible default lane on first load. Linear if it has cards,
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

  // Refresh handler, bound to the explicit refresh button in the compass
  // header. Pull-to-refresh was removed: with vertical scroll, horizontal
  // lane swipes, and bottom-sheet drag-down all happening on the same
  // surface, an additional pull-down gesture mis-fired too often. An
  // explicit affordance is more honest on a gesture-busy screen.
  const handleRefresh = useCallback(() => {
    void manualRefresh({});
  }, [manualRefresh]);

  const handleUserSettle = useCallback(
    (idx: number) => {
      triggerHaptic(prefersReducedMotion);
      // Sync the compass's scrollY motion value to the new active lane's
      // current scroll position so the compass shrink matches what the
      // user is seeing on the new page.
      const top = laneRefs.current[idx]?.getScrollTop() ?? 0;
      scrollY.set(top);
    },
    [prefersReducedMotion, scrollY],
  );

  const handleQuadrantTap = useCallback(
    (lane: CompassLane) => {
      const idx = COMPASS_LANE_ORDER.indexOf(lane);
      if (idx === -1 || idx === activeIndex) return;
      setActiveIndex(idx);
      triggerHaptic(prefersReducedMotion);
    },
    [activeIndex, prefersReducedMotion],
  );

  const handleIndexChange = useCallback((idx: number) => {
    setActiveIndex(idx);
  }, []);

  // ── Voice tool callbacks ───────────────────────────────────────────────
  // Mirror DiscoverCanvas's wiring so the voice adviser can act on the
  // mobile canvas the same way (open / close / save / unsave / dismiss /
  // refresh), plus the mobile-specific `goToLane` for the pager. Density
  // intentionally isn't here, there's no slider on mobile, the server's
  // tool list excludes setDensity for surface="mobile".
  const findCardByGuideId = useCallback(
    (guideId: string): CompassCard | null => {
      for (const c of compassCards) {
        if ((c.guideId as string) === guideId) return c;
      }
      return null;
    },
    [compassCards],
  );

  const onOpenCard = useCallback(
    async (guideId: string) => {
      const card = findCardByGuideId(guideId);
      if (!card) {
        return {
          ok: false as const,
          message: "That card isn't on your current canvas.",
        };
      }
      setPreviewCard(card);
      return { ok: true as const, message: `Opened ${card.title}.` };
    },
    [findCardByGuideId],
  );

  const onCloseCard = useCallback(async () => {
    setPreviewCard(null);
    return { ok: true as const, message: "Closed the card." };
  }, []);

  const onSaveCard = useCallback(
    async (guideId: string) => {
      const card = findCardByGuideId(guideId);
      if (!card) {
        return {
          ok: false as const,
          message: "That card isn't on your current canvas.",
        };
      }
      await saveGuide({ guideId: guideId as Id<"career_guides"> });
      setLastFlash({ guideId, kind: "save", ts: Date.now() });
      return { ok: true as const, message: `Saved ${card.title}.` };
    },
    [findCardByGuideId, saveGuide],
  );

  const onUnsaveCard = useCallback(
    async (guideId: string) => {
      const card = findCardByGuideId(guideId);
      if (!card) {
        return {
          ok: false as const,
          message: "That card isn't on your current canvas.",
        };
      }
      await removeSave({ guideId: guideId as Id<"career_guides"> });
      return {
        ok: true as const,
        message: `Removed ${card.title} from your saved list.`,
      };
    },
    [findCardByGuideId, removeSave],
  );

  const onDismissCard = useCallback(
    async (guideId: string) => {
      const card = findCardByGuideId(guideId);
      if (!card) {
        return {
          ok: false as const,
          message: "That card isn't on your current canvas.",
        };
      }
      await dismissGuide({ guideId: guideId as Id<"career_guides"> });
      setLastFlash({ guideId, kind: "dismiss", ts: Date.now() });
      return {
        ok: true as const,
        message: `Dismissed ${card.title}. A replacement will slot in shortly.`,
      };
    },
    [findCardByGuideId, dismissGuide],
  );

  const onUndismissCard = useCallback(
    async (guideId: string) => {
      const dismissed = dismissedGuides?.find(
        (d) => (d.guideId as string) === guideId,
      );
      if (!dismissed) {
        return {
          ok: false as const,
          message: "That guide isn't in the recently-dismissed list.",
        };
      }
      await undismissGuide({ guideId: guideId as Id<"career_guides"> });
      return {
        ok: true as const,
        message: `Restored ${dismissed.title}. It'll reappear after the canvas regenerates.`,
      };
    },
    [dismissedGuides, undismissGuide],
  );

  const onRefreshCanvas = useCallback(async () => {
    await manualRefresh({});
    return {
      ok: true as const,
      message: "Refresh queued, give it about thirty seconds.",
    };
  }, [manualRefresh]);

  const onGoToLane = useCallback(
    async (lane: string) => {
      const idx = COMPASS_LANE_ORDER.indexOf(lane as CompassLane);
      if (idx === -1) {
        return {
          ok: false as const,
          message: `Unknown lane: ${lane}.`,
        };
      }
      if (idx === activeIndex) {
        return {
          ok: true as const,
          message: `Already on the ${lane} lane.`,
        };
      }
      setActiveIndex(idx);
      triggerHaptic(prefersReducedMotion);
      return {
        ok: true as const,
        message: `Switched to the ${lane} lane.`,
      };
    },
    [activeIndex, prefersReducedMotion],
  );

  const voiceTools = useMemo<CompassToolCallbacks>(
    () => ({
      onOpenCard,
      onCloseCard,
      onSaveCard,
      onUnsaveCard,
      onDismissCard,
      onUndismissCard,
      onRefreshCanvas,
      onGoToLane,
    }),
    [
      onOpenCard,
      onCloseCard,
      onSaveCard,
      onUnsaveCard,
      onDismissCard,
      onUndismissCard,
      onRefreshCanvas,
      onGoToLane,
    ],
  );

  return (
    <div className="relative flex h-full flex-col bg-paper">
      {/* Discrete hint, the canvas reveals more on a larger screen. Kept
          deliberately quiet (mute, small, no chrome) so it never competes
          with the compass itself. */}
      <p className="px-4 pt-2 text-center text-[11px] leading-snug text-mute/70">
        Best viewed on a larger screen
      </p>

      {/* Compass header. Each lane below has its own scroll, so this is a
          regular flex item (not sticky); the compass shrinks via the
          active lane's scrollTop reported up through `onScrollY`. */}
      <header className="relative border-b border-hairline bg-paper px-4 pb-2 pt-2">
        <MobileCompass
          state={compassState}
          cards={compassCards}
          activeLane={activeLane}
          laneCounts={laneCounts}
          dragProgress={dragProgress}
          scrollY={scrollY}
          initials={initials}
          onQuadrantTap={handleQuadrantTap}
          lastFlash={lastFlash}
          prefersReducedMotion={prefersReducedMotion}
        />

        {compassState === "ready" && (
          <div className="absolute right-3 top-3 flex items-center gap-1.5">
            <CompassVoiceDock
              canvasReady
              variant="header-trigger"
              tools={voiceTools}
              surface="mobile"
              activeLane={activeLane}
              sheetOpen={previewCard !== null}
            />
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="Refresh career landscape"
              className="flex size-9 items-center justify-center rounded-full text-mute transition-colors hover:bg-paper-raised hover:text-ink active:bg-paper-raised"
            >
              <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        )}

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

      {/* Pager fills the remaining vertical space. Each lane inside owns
          its own vertical scroll, switching lanes resets the visible
          scroll to that lane's stored position. */}
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

      {/* Voice trigger lives in the header now (next to the refresh button)
          via variant="header-trigger". When a call is active that variant
          teleports the dock body to a fixed-bottom strip so the waveform
          doesn't crowd the header. */}
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
    // Silently ignore. Android Chrome supports it; iOS Safari ignores it
    // already. No need to surface anything.
  }
}
