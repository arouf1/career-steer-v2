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

// Smart open/close quote characters — no italic needed when Garamond carries
// the typographic weight at 26px with these marks.
const LQUOTE = "“";
const RQUOTE = "”";

export function InterviewDetailPanel({ rubric, meta, className }: Props) {
  // Strip the redundant "Mock interview: " prefix and the trailing
  // " at COMPANY" suffix so the h1 is just the role. The company moves
  // to its own byline row above the title (logo + name).
  const cleanTitle = meta.title.replace(/^Mock interview:\s*/i, "");
  const companyName = meta.companyName?.trim();
  const roleOnly = companyName
    ? cleanTitle.replace(
        new RegExp(`\\s+at\\s+${escapeRegExp(companyName)}\\s*$`, "i"),
        "",
      )
    : cleanTitle;

  return (
    <div className={cn("flex flex-col", className)}>
      {/* ── Masthead + Verdict — career-guide hero pattern ──────────────── */}
      <section
        id="verdict"
        className="scroll-mt-24 border-b border-hairline pb-12"
      >
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
          Mock interview <span aria-hidden>{"·"}</span>{" "}
          {formatDuration(meta.durationSeconds)} <span aria-hidden>{"·"}</span>{" "}
          {formatRelative(meta.createdAt)}
        </p>

        {/* Byline: logo + company name as a "publisher" badge above the
            headline. Logo small (32px) so it complements the title rather
            than competing with it. */}
        {(companyName || meta.companyLogoUrl) && (
          <div className="mt-6 flex items-center gap-3">
            <CompanyAnchor
              name={companyName}
              logoUrl={meta.companyLogoUrl}
            />
            {companyName && (
              <p className="text-[14px] text-mute">{companyName}</p>
            )}
          </div>
        )}

        <h1 className="mt-6 text-balance text-5xl leading-[1.02] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-6xl">
          {roleOnly}
        </h1>

        <div className="mt-7 flex items-baseline gap-2">
          <span className="text-[48px] font-normal leading-none text-ink [font-family:var(--font-serif)]">
            {rubric.overallScore.toFixed(1)}
          </span>
          <span className="text-[14px] font-medium uppercase tracking-[0.18em] text-mute">
            / 5
          </span>
        </div>

        <p className="mt-7 max-w-2xl text-balance text-[19px] leading-[1.55] text-ink/70 sm:text-[20px]">
          {rubric.oneLineVerdict}
        </p>
      </section>

      {/* ── Dimensions (stacked, hairline-divided — NEVER a 2x2 grid) ──── */}
      <section id="dimensions" className="scroll-mt-24">
        <p className="mt-12 mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
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
                    <span className="text-mute">{"—"}</span>
                  ) : (
                    <>
                      {d.score} <span className="text-mute">/ 5</span>
                    </>
                  )}
                </p>
              </div>
              {d.whatWorked && d.whatWorked !== "—" && (
                <>
                  <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
                    What worked
                  </p>
                  <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-ink">
                    {d.whatWorked}
                  </p>
                </>
              )}
              {d.whatToFix && d.whatToFix !== "—" && (
                <>
                  <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
                    To push
                  </p>
                  <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-mute">
                    {d.whatToFix}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Best moment (editorial pull-quote — Garamond normal, no chrome) ─ */}
      {rubric.bestMoment.quote && (
        <section id="best-moment" className="scroll-mt-24">
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
            Best moment
          </p>
          <blockquote className="max-w-[60ch] text-[26px] leading-snug text-ink [font-family:var(--font-serif)]">
            {LQUOTE}{rubric.bestMoment.quote}{RQUOTE}
          </blockquote>
          {rubric.bestMoment.why && (
            <p className="mt-4 max-w-[60ch] text-[14px] leading-relaxed text-mute">
              {rubric.bestMoment.why}
            </p>
          )}
        </section>
      )}

      {/* ── Biggest miss ───────────────────────────────────────────────── */}
      {rubric.biggestMiss.quote && (
        <section id="biggest-miss" className="scroll-mt-24">
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
            Biggest miss
          </p>
          <blockquote className="max-w-[60ch] text-[26px] leading-snug text-ink [font-family:var(--font-serif)]">
            {LQUOTE}{rubric.biggestMiss.quote}{RQUOTE}
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
        </section>
      )}

      {/* ── What to work on (numbered editorial list, no disclosure) ───── */}
      {rubric.nextStepExercises.length > 0 && (
        <section id="next-steps" className="scroll-mt-24">
          <hr className="mt-12 border-t border-hairline" />
          <p className="mt-12 mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
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
        </section>
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

// CompanyAnchor — circular byline-scale logo (32px) or initial mark, no
// border. Sits above the masthead h1 as a "publisher" badge alongside the
// company name. Brandfetch CDN URLs aren't whitelisted in
// next.config.ts remotePatterns and we don't want to widen that surface
// for one image, so use raw <img>.
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
          "h-8 w-8 shrink-0 overflow-hidden rounded-full bg-paper-raised",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={name ? `${name} logo` : ""}
          width={32}
          height={32}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }
  if (!name) return null;
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper-raised text-[14px] font-normal text-ink [font-family:var(--font-serif)]",
        className,
      )}
      aria-label={`${name} logo placeholder`}
    >
      {initial}
    </div>
  );
}

// Escape a string for safe inclusion in a regex literal — used to strip
// the "at COMPANY" suffix from the title without partial matches.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
