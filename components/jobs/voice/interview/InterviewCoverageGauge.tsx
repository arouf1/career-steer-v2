"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

type Props = {
  /** The opaque sessionId the row was created with. */
  sessionId: string | null;
  /** Dimension keys in display order. Comes from bundle.rubric.dimensions[].key. */
  dimensions: string[];
  className?: string;
};

type Confidence = "weak" | "solid" | "strong";

/**
 * 4-pip indicator that lights up as the interviewer marks dimensions covered.
 *
 * Visible to the user, invisible to the interviewer model, purely a "we
 * see them paying attention" signal that's good for trust during a 10-min
 * call. The interviewer is told (via the prompt) NOT to narrate tool calls,
 * so the user shouldn't notice a behavior change beyond pips lighting up.
 *
 * Each pip has 4 visual states:
 *   - empty (outline only), no mark yet
 *   - weak  (small filled inner dot)
 *   - solid (full filled pip)
 *   - strong (full filled + faint glow ring)
 *
 * The label under each pip is the dimension key, lowercased and de-hyphenated
 * for readability ("role-fit" → "role fit"). Hover reveals the evidence string
 * if a mark exists (via title attribute, AT-friendly).
 */
export function InterviewCoverageGauge({ sessionId, dimensions, className }: Props) {
  const coverage = useQuery(
    api.voiceCalls.getCoverage,
    sessionId ? { sessionId } : "skip",
  );

  // Map dimension key → most recent mark. Coverage rows are last-write-wins
  // server-side, so the array length matches the unique dimensions count.
  const byDimension = new Map<string, { confidence: Confidence; evidence: string }>(
    (coverage ?? []).map((c) => [
      c.dimension,
      { confidence: c.confidence as Confidence, evidence: c.evidence },
    ]),
  );

  return (
    <div
      className={cn("flex items-center justify-center gap-3", className)}
      role="group"
      aria-label="Interview coverage progress"
    >
      {dimensions.map((key) => {
        const mark = byDimension.get(key);
        return (
          <Pip
            key={key}
            label={key.replace(/-/g, " ")}
            confidence={mark?.confidence}
            evidence={mark?.evidence}
          />
        );
      })}
    </div>
  );
}

function Pip({
  label,
  confidence,
  evidence,
}: {
  label: string;
  confidence?: Confidence;
  evidence?: string;
}) {
  const filled = confidence === "solid" || confidence === "strong";
  const innerDot = confidence === "weak";
  const glow = confidence === "strong";

  return (
    <div
      className="flex flex-col items-center gap-1"
      title={evidence ? `${label}: ${evidence}` : `${label}: not yet covered`}
    >
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-3 w-3 items-center justify-center rounded-full border transition-all duration-300",
          filled ? "border-ink bg-ink" : "border-ink/30 bg-transparent",
          glow && "ring-2 ring-ink/15 ring-offset-1 ring-offset-paper",
        )}
      >
        {innerDot && (
          <span className="h-1.5 w-1.5 rounded-full bg-ink" aria-hidden />
        )}
      </span>
      <span
        className={cn(
          "text-[10px] capitalize transition-colors duration-300",
          filled ? "text-ink" : "text-mute",
        )}
      >
        {label}
      </span>
    </div>
  );
}
