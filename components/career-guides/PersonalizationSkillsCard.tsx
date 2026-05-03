"use client";

import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LoopingFeather } from "./LoopingFeather";
import { LoopingBrain } from "./LoopingBrain";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

type Props = {
  guideId: Id<"career_guides">;
  /** Rendered for anonymous, no-profile, profile-pending, missing, or failed states. */
  fallback: ReactNode;
};

/**
 * Replaces the generic "Skills you need" section when a logged-in user with a
 * complete personalization is viewing the guide. In every other state we
 * defer to the fallback (the existing generic skills section).
 */
export function PersonalizationSkillsCard({ guideId, fallback }: Props) {
  const result = useQuery(api.careerGuidePersonalizations.getForGuide, {
    guideId,
  });

  // Until we know the state, render fallback so anonymous SSR matches client.
  if (!result) return <>{fallback}</>;

  // Anonymous, no-profile, or enrichment failure → defer to the generic
  // skills list so the article still has a Section 2 to read.
  if (
    result.state === "anonymous" ||
    result.state === "no-profile" ||
    result.state === "enrichment-failed"
  ) {
    return <>{fallback}</>;
  }

  // Profile-pending: profile/enrichment has moved on since the last
  // personalization, so any stored skills bucketing is stale by definition
  // (e.g. it scored gaps against the old location/role). Show the skeleton
  // until the regen completes.
  if (result.state === "profile-pending") {
    return <SkillsSkeleton />;
  }

  // result.state === "ready"
  const row = result.row;
  if (!row) return <>{fallback}</>;

  if (row.status === "generating") {
    // Same logic as profile-pending: only regenerates fire when the existing
    // content is stale, so we don't keep it on screen.
    return <SkillsSkeleton />;
  }

  if (row.status !== "complete" || !row.content) {
    return <>{fallback}</>;
  }

  return <PersonalizedSkillsView assessment={row.content.skillsAssessment} />;
}

type SkillRow = { skill: string; why: string };

// Convex schema unions legacy string[] with the new {skill, why}[] shape.
// Normalising here lets the view render uniformly and gracefully fall back
// for any pre-shape-change row that hasn't regenerated yet.
const normalizeBucket = (
  items: ReadonlyArray<string | SkillRow>,
): SkillRow[] =>
  items.map((item) =>
    typeof item === "string" ? { skill: item, why: "" } : item,
  );

function PersonalizedSkillsView({
  assessment,
}: {
  assessment: {
    strengths: ReadonlyArray<string | SkillRow>;
    transferable: ReadonlyArray<string | SkillRow>;
    gaps: ReadonlyArray<string | SkillRow>;
    summary: string;
  };
}) {
  const strengths = normalizeBucket(assessment.strengths);
  const transferable = normalizeBucket(assessment.transferable);
  const gaps = normalizeBucket(assessment.gaps);
  const { summary } = assessment;

  return (
    <section
      id="skills"
      className="scroll-mt-24 border-t border-hairline py-14 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className={eyebrowCls}>Skills</p>
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink/55">
          <LoopingBrain size={12} />
          Personalised
        </span>
      </div>
      <h2 className="mt-3 text-balance text-3xl leading-[1.15] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-[2rem]">
        Where you stand.
      </h2>
      <p className="mt-5 max-w-2xl text-balance text-[17px] leading-[1.75] text-ink/75">
        Where you already stand, what travels with you, and the ground you'd
        need to make up.
      </p>

      <div className="mt-6 max-w-2xl space-y-7">
        <SkillGroup
          label="What you already bring"
          intro="Strengths from your background that match this role."
          items={strengths}
          dotClass="bg-emerald-500/70"
        />
        <SkillGroup
          label="Skills that travel well"
          intro="Adjacent skills that translate into this role even if the labels differ."
          items={transferable}
          dotClass="bg-sky-500/70"
        />
        <SkillGroup
          label="Ground to make up"
          intro="Gaps you'd need to close to thrive here."
          items={gaps}
          dotClass="bg-amber-500/80"
        />

        {summary && (
          <div className="border-t border-hairline pt-6">
            <div className="space-y-5">
              {summary.split("\n").map((para, i) => (
                <p
                  key={i}
                  className="text-balance text-[17px] leading-[1.75] text-ink/75"
                >
                  {para}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SkillGroup({
  label,
  intro,
  items,
  dotClass,
}: {
  label: string;
  intro: string;
  items: SkillRow[];
  dotClass: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="border-t border-hairline pt-6 first:border-t-0 first:pt-0">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink/85">
        {label}
      </h3>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink/65">
        {intro}
      </p>
      <ul className="mt-5 space-y-5">
        {items.map((item) => (
          <li key={item.skill} className="flex items-start gap-3">
            <span
              aria-hidden
              className={`mt-[0.65rem] h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[17px] leading-[1.45] text-ink">
                {item.skill}
              </p>
              {item.why && (
                <p className="mt-1 text-[15px] leading-[1.65] text-ink/65">
                  {item.why}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkillsSkeleton() {
  return (
    <section
      id="skills"
      className="scroll-mt-24 border-t border-hairline py-14 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className={eyebrowCls}>Skills</p>
        <span className="inline-flex items-center rounded-pill border border-hairline px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink/40">
          Personalising
        </span>
      </div>
      <h2 className="mt-3 text-balance text-3xl leading-[1.15] tracking-tight text-ink/30 [font-family:var(--font-serif)] sm:text-[2rem]">
        Where you stand.
      </h2>
      <div
        className="mt-6 flex items-center gap-3 text-[14px] text-mute"
        aria-live="polite"
      >
        <LoopingFeather size={14} className="text-mute" />
        <span>Mapping your skills to this role...</span>
      </div>
      <div className="mt-6 max-w-2xl space-y-7" aria-hidden>
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="border-t border-hairline pt-6 first:border-t-0 first:pt-0"
          >
            <div className="h-3 w-40 rounded-pill bg-ink/5" />
            <div className="mt-3 h-2.5 w-[60%] rounded-pill bg-ink/5" />
            <div className="mt-5 space-y-5">
              {[
                ["52%", ["88%", "72%"]],
                ["44%", ["82%", "64%"]],
                ["48%", ["86%", "70%"]],
              ].map(([head, body], i) => (
                <div key={i} className="space-y-2">
                  <div
                    className="h-3 rounded-pill bg-ink/5"
                    style={{ width: head as string }}
                  />
                  {(body as string[]).map((w, j) => (
                    <div
                      key={j}
                      className="h-2.5 rounded-pill bg-ink/[0.04]"
                      style={{ width: w }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="border-t border-hairline pt-6">
          <div className="space-y-3">
            <div className="h-3 w-full rounded-pill bg-ink/5" />
            <div className="h-3 w-[94%] rounded-pill bg-ink/5" />
            <div className="h-3 w-[88%] rounded-pill bg-ink/5" />
            <div className="h-3 w-[76%] rounded-pill bg-ink/5" />
          </div>
        </div>
      </div>
    </section>
  );
}
