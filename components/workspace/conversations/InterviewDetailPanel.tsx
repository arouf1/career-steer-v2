// components/workspace/conversations/InterviewDetailPanel.tsx
//
// Editorial detail panel for mock-interview conversations. Single-column
// reading flow on plain paper — no card-in-card chrome, no 2x2 dimension
// grid (DESIGN.md absolute ban), no monospaced "code-block" pull-quotes.
// Section breaks are hairline dividers; typography carries the hierarchy.

"use client";

import { cn } from "@/lib/utils";
import type { InterviewRubric } from "@/lib/ai/prompts/interviewer";

type Props = {
  rubric: InterviewRubric;
  meta: {
    title: string;
    createdAt: number;
    durationSeconds: number;
    companyName?: string;
    companyLogoUrl?: string;
  };
  className?: string;
};

export function InterviewDetailPanel({ rubric, meta, className }: Props) {
  // Strip the redundant "Mock interview: " prefix — the masthead label and
  // company anchor already signal surface. Mirrors InterviewRow.
  const cleanTitle = meta.title.replace(/^Mock interview:\s*/i, "");
  const companyName = meta.companyName?.trim();

  return (
    <div className={cn("flex flex-col", className)}>
      {/* ── Masthead ────────────────────────────────────────────────────── */}
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
          Mock interview <span aria-hidden>·</span>{" "}
          {formatDuration(meta.durationSeconds)} <span aria-hidden>·</span>{" "}
          {formatRelative(meta.createdAt)}
        </p>

        <CompanyAnchor name={companyName} logoUrl={meta.companyLogoUrl} className="mt-6" />

        <h1 className="mt-5 text-[36px] font-normal leading-tight text-ink [font-family:var(--font-serif)]">
          {cleanTitle}
        </h1>
        {companyName && (
          <p className="mt-2 text-[18px] italic text-mute [font-family:var(--font-serif)]">
            at {companyName}
          </p>
        )}

        <div className="mt-8 flex items-baseline gap-2">
          <span className="text-[48px] font-normal leading-none text-ink [font-family:var(--font-serif)]">
            {rubric.overallScore.toFixed(1)}
          </span>
          <span className="text-[14px] font-medium uppercase tracking-[0.08em] text-mute">
            / 5
          </span>
        </div>

        <p className="mt-4 max-w-[60ch] text-[17px] italic leading-relaxed text-body [font-family:var(--font-serif)]">
          {rubric.oneLineVerdict}
        </p>
      </header>

      {/* ── Dimensions (stacked, hairline-divided — NEVER a 2x2 grid) ──── */}
      <p className="mt-12 mb-4 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
        Where the interview landed
      </p>
      <div className="flex flex-col">
        {rubric.dimensions.map((d, i) => (
          <div
            key={d.key}
            className={cn(
              "py-6",
              i === 0 ? "" : "border-t border-hairline",
            )}
          >
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-[20px] font-normal leading-snug text-ink [font-family:var(--font-serif)]">
                {titleCase(d.key)}
              </h3>
              <p className="shrink-0 text-[18px] font-normal text-ink [font-family:var(--font-serif)]">
                {d.score == null ? (
                  <span className="italic text-mute">—</span>
                ) : (
                  <>
                    {d.score} <span className="text-mute">/ 5</span>
                  </>
                )}
              </p>
            </div>
            {d.whatWorked && d.whatWorked !== "—" && (
              <p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-ink">
                {d.whatWorked}
              </p>
            )}
            {d.whatToFix && d.whatToFix !== "—" && (
              <p className="mt-2 max-w-[60ch] text-[14px] italic leading-relaxed text-mute">
                To push: {d.whatToFix}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── Best moment (editorial pull-quote — Garamond italic, no chrome) ─ */}
      {rubric.bestMoment.quote && (
        <>
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
            Best moment
          </p>
          <blockquote className="max-w-[60ch] text-[24px] italic leading-snug text-ink [font-family:var(--font-serif)]">
            “{rubric.bestMoment.quote}”
          </blockquote>
          {rubric.bestMoment.why && (
            <p className="mt-4 max-w-[60ch] text-[14px] leading-relaxed text-mute">
              {rubric.bestMoment.why}
            </p>
          )}
        </>
      )}

      {/* ── Biggest miss ───────────────────────────────────────────────── */}
      {rubric.biggestMiss.quote && (
        <>
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
            Biggest miss
          </p>
          <blockquote className="max-w-[60ch] text-[24px] italic leading-snug text-ink [font-family:var(--font-serif)]">
            “{rubric.biggestMiss.quote}”
          </blockquote>
          {rubric.biggestMiss.why && (
            <p className="mt-4 max-w-[60ch] text-[14px] leading-relaxed text-mute">
              {rubric.biggestMiss.why}
            </p>
          )}
          {rubric.biggestMiss.betterAnswerSketch && (
            <p className="mt-4 max-w-[60ch] text-[14px] leading-relaxed text-ink">
              <span className="font-medium">A stronger answer might:</span>{" "}
              {rubric.biggestMiss.betterAnswerSketch}
            </p>
          )}
        </>
      )}

      {/* ── What to work on (numbered editorial list, no disclosure) ───── */}
      {rubric.nextStepExercises.length > 0 && (
        <>
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
            What to work on
          </p>
          <ol className="flex flex-col">
            {rubric.nextStepExercises.map((e, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-5 py-5",
                  i === 0 ? "" : "border-t border-hairline",
                )}
              >
                <span
                  className="shrink-0 text-[24px] font-normal leading-none text-ink [font-family:var(--font-serif)]"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h4 className="text-[15px] font-medium leading-snug text-ink">
                    {e.title}
                  </h4>
                  {e.why && (
                    <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-mute">
                      {e.why}
                    </p>
                  )}
                  {e.how && (
                    <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-ink">
                      {e.how}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function titleCase(key: string): string {
  return key
    .split(/[-_\s]+/)
    .map((word) => (word.length === 0 ? "" : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 1) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// CompanyAnchor — circular logo (56px) or initial mark, no border. Mirrors
// InterviewRow.CompanyAnchor at a larger size for the masthead. Brandfetch
// CDN URLs aren't whitelisted in next.config.ts remotePatterns and we don't
// want to widen that surface for one image, so use raw <img>.
function CompanyAnchor({
  name,
  logoUrl,
  className,
}: {
  name?: string;
  logoUrl?: string;
  className?: string;
}) {
  if (logoUrl) {
    return (
      <div
        className={cn(
          "h-14 w-14 overflow-hidden rounded-full bg-paper-raised",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={name ? `${name} logo` : ""}
          width={56}
          height={56}
          className="h-full w-full object-contain p-1"
        />
      </div>
    );
  }
  if (!name) return null;
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <div
      className={cn(
        "flex h-14 w-14 items-center justify-center rounded-full bg-paper-raised text-[22px] font-normal text-ink [font-family:var(--font-serif)]",
        className,
      )}
      aria-label={`${name} logo placeholder`}
    >
      {initial}
    </div>
  );
}
