"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { CornerDownRight, Loader2, Plus, Minus } from "lucide-react";
import { motion } from "motion/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { FieldCitation } from "./FieldCitation";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexHttpOrigin = CONVEX_URL
  ? CONVEX_URL.replace(".convex.cloud", ".convex.site")
  : null;

type BranchRow = Doc<"career_guide_branches">;

const normalize = (q: string): string =>
  q.toLowerCase().replace(/\s+/g, " ").trim();

export function GoDeeper({
  guideId,
  sectionId,
  followUps,
  initialBranches,
}: {
  guideId: Id<"career_guides">;
  sectionId: string;
  followUps: string[];
  /**
   * Server-fetched branches passed from the route. Used during SSR (when
   * useQuery is undefined) so completed Q&A renders into the initial HTML
   * for crawlers. Also seeds the expanded set so already-complete answers
   * appear open on first paint.
   */
  initialBranches: BranchRow[];
}) {
  const liveBranches = useQuery(api.guideBranches.listForGuide, { guideId }) as
    | BranchRow[]
    | undefined;
  const branches = liveBranches ?? initialBranches;

  // All branches start collapsed. Pre-warmed answers are still rendered into
  // the DOM (via the always-mounted motion.div below, animated to height 0)
  // so crawlers and AI engines can extract the Q&A even when visually closed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  if (!followUps || followUps.length === 0) return null;

  const branchByQuestion = new Map<string, BranchRow>();
  for (const b of branches) {
    if (b.sectionId === sectionId) {
      branchByQuestion.set(b.questionNormalized, b);
    }
  }

  const onToggle = async (question: string) => {
    const key = normalize(question);
    const isCurrentlyExpanded = expanded.has(key);

    setExpanded((prev) => {
      const next = new Set(prev);
      if (isCurrentlyExpanded) next.delete(key);
      else next.add(key);
      return next;
    });

    if (isCurrentlyExpanded) return;

    const branch = branchByQuestion.get(key);
    const needsGeneration =
      !branch || branch.status === "failed";
    if (!needsGeneration || !convexHttpOrigin || pending.has(key)) return;

    setPending((prev) => new Set(prev).add(key));
    try {
      await fetch(`${convexHttpOrigin}/career-guides/branches/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guideId, sectionId, question }),
      });
    } catch {
      // Silent failure — row stays collapsed-on-next-click; user can retry.
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-pill border border-hairline/70 bg-paper px-2.5 py-1">
        <CornerDownRight
          className="h-3 w-3 text-mute"
          aria-hidden="true"
          strokeWidth={1.75}
        />
        <span className={eyebrowCls}>Go deeper</span>
      </span>
      <ul className="mt-5 max-w-2xl divide-y divide-hairline/70">
        {followUps.map((question) => {
          const key = normalize(question);
          const branch = branchByQuestion.get(key);
          const isOpen = expanded.has(key);
          const isPending = pending.has(key);
          const isWorking =
            isPending ||
            branch?.status === "generating" ||
            branch?.status === "researching";
          const workingLabel = isWorking ? "Researching…" : null;

          return (
            <li key={question}>
              <button
                type="button"
                onClick={() => onToggle(question)}
                aria-expanded={isOpen}
                className="group flex w-full items-start gap-3 py-4 text-left text-[15px] leading-relaxed text-ink/85 transition-colors hover:text-ink"
              >
                <CornerDownRight
                  className="mt-1.5 h-3.5 w-3.5 shrink-0 text-mute transition-colors group-hover:text-ink"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
                <span className="flex-1">{question}</span>
                {isOpen && workingLabel && (
                  <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-mute">
                    <Loader2
                      className="h-3 w-3 animate-spin"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                    {workingLabel}
                  </span>
                )}
                {(!isOpen || (isOpen && !workingLabel)) && (
                  isOpen ? (
                    <Minus
                      className="mt-1.5 h-3.5 w-3.5 shrink-0 text-mute transition-colors group-hover:text-ink"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                  ) : (
                    <Plus
                      className="mt-1.5 h-3.5 w-3.5 shrink-0 text-mute transition-colors group-hover:text-ink"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                  )
                )}
              </button>

              <AnswerPanel isOpen={isOpen}>
                <div className="ml-7 pb-6">
                  {branch?.status === "complete" && branch.answer ? (
                    <>
                      <h3 className="mt-2 text-balance text-[22px] leading-[1.2] tracking-tight text-ink [font-family:var(--font-serif)]">
                        {branch.answer.title}
                      </h3>
                      <div className="mt-4 space-y-4">
                        {branch.answer.body.split("\n").map((para, i) => (
                          <p
                            key={i}
                            className="text-balance text-[16px] leading-[1.7] text-ink/80"
                          >
                            {para}
                          </p>
                        ))}
                      </div>
                      {branch.citations && branch.citations.length > 0 && (
                        <div className="mt-5 flex items-center gap-2">
                          <span className={eyebrowCls}>Sources</span>
                          <FieldCitation
                            citations={branch.citations}
                            label="Sources for this answer"
                          />
                        </div>
                      )}
                    </>
                  ) : branch?.status === "failed" ? (
                    <p className="mt-2 text-[14px] leading-relaxed text-mute">
                      Couldn&rsquo;t draft this one. Click again to retry.
                    </p>
                  ) : (
                    // generating / researching / pending — render skeleton
                    <div className="mt-4 space-y-3">
                      {[80, 95, 70].map((w, i) => (
                        <div
                          key={i}
                          className="h-3 animate-pulse rounded-hair bg-hairline"
                          style={{ width: `${w}%` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </AnswerPanel>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// Each accordion answer animates height 0 ↔ auto. During the animation we
// need overflow:hidden so child content doesn't spill while the height is in
// flight; once it settles open, we flip to overflow:visible so popovers (e.g.
// the FieldCitation source list) can extend outside the panel without being
// clipped.
function AnswerPanel({
  isOpen,
  children,
}: {
  isOpen: boolean;
  children: React.ReactNode;
}) {
  const [overflowVisible, setOverflowVisible] = useState(false);
  return (
    <motion.div
      initial={false}
      animate={{ opacity: isOpen ? 1 : 0, height: isOpen ? "auto" : 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.65, 0.3, 1] }}
      onAnimationStart={() => setOverflowVisible(false)}
      onAnimationComplete={() => setOverflowVisible(isOpen)}
      style={{ overflow: overflowVisible ? "visible" : "hidden" }}
      aria-hidden={!isOpen}
    >
      {children}
    </motion.div>
  );
}
