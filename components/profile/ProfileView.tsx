"use client";

import Link from "next/link";
import type { Doc } from "@/convex/_generated/dataModel";
import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";

type Props = {
  profile: Doc<"profiles">;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const CONNECTING_PREFIXES = [
  " with a focus on ",
  " specializing in ",
  " focused on ",
  " working on ",
  " building ",
  " leading ",
  " at ",
  " with ",
] as const;

function splitHeadline(headline: string): { left: string; connector: string; right: string } | null {
  const lower = headline.toLowerCase();
  for (const prefix of CONNECTING_PREFIXES) {
    const idx = lower.indexOf(prefix);
    if (idx !== -1) {
      return {
        left: headline.slice(0, idx),
        connector: headline.slice(idx, idx + prefix.length),
        right: headline.slice(idx + prefix.length),
      };
    }
  }
  return null;
}

function formatJoinedDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function formatRelative(ms: number): string {
  const now = Date.now();
  const diffMs = now - ms;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return "1 week ago";
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month ago";
  return `${diffMonths} months ago`;
}

function formatYear(dateStr: string | undefined): string {
  if (!dateStr) return "";
  // dateStr is a freeform string like "2022", "Jan 2022", "2022-01", etc.
  // Extract the 4-digit year if present.
  const match = dateStr.match(/\d{4}/);
  return match ? match[0] : dateStr;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ProfileView({ profile }: Props) {
  const name = profile.name ?? null;
  const headline = profile.headline ?? null;
  const summary = profile.summary ?? null;

  // Dateline segments
  // profiles table has no explicit updatedAt, parsedAt tracks when the CV
  // was last parsed, which is the closest proxy for "last updated".
  const datelineSegments: string[] = [];
  datelineSegments.push(`Joined ${formatJoinedDate(profile._creationTime)}`);
  if (profile.location) {
    datelineSegments.push(`Based in ${profile.location}`);
  }
  if (profile.parsedAt) {
    datelineSegments.push(`Last updated ${formatRelative(profile.parsedAt)}`);
  }

  // Two-tone headline split
  const headlineSplit = headline ? splitHeadline(headline) : null;

  return (
    <article className="flex flex-col">
      {/* ── Masthead ─────────────────────────────────────────────────── */}
      <div className="border-b border-hairline pb-12">
        {/* Eyebrow */}
        <p className="text-[10px] uppercase tracking-[0.18em] font-medium text-mute">
          Profile
        </p>

        {/* Big serif name */}
        <h1 className="mt-4 text-5xl sm:text-6xl leading-[1.05] tracking-tight text-ink [font-family:var(--font-serif)]">
          {name ?? "Your profile"}
        </h1>

        {/* Two-tone headline */}
        {headline && (
          <p className="mt-3 text-[22px] sm:text-[26px] leading-relaxed max-w-3xl [font-family:var(--font-serif)]">
            {headlineSplit ? (
              <>
                <span className="text-ink">{headlineSplit.left}</span>
                <span className="text-ink-soft">{headlineSplit.connector}{headlineSplit.right}</span>
              </>
            ) : (
              <span className="text-ink">{headline}</span>
            )}
          </p>
        )}

        {/* Dateline */}
        {datelineSegments.length > 0 && (
          <p className="mt-5 text-[12px] text-mute flex flex-wrap gap-x-2 items-center">
            {datelineSegments.map((seg, i) => (
              <span key={seg} className="flex items-center gap-x-2">
                {i > 0 && (
                  <span aria-hidden className="text-mute/40">·</span>
                )}
                {seg}
              </span>
            ))}
          </p>
        )}

        {/* Quiet meta-link strip */}
        <div className="mt-3 flex items-center gap-4">
          <Link
            href="/workspace/profile/edit"
            className="text-[12px] text-mute underline-offset-4 hover:underline hover:text-ink transition-colors"
          >
            Edit
          </Link>
          <DeleteAccountDialog
            trigger={
              <button
                type="button"
                className="text-[12px] text-state-error underline-offset-4 hover:underline transition-colors"
              >
                Delete account
              </button>
            }
          />
        </div>
      </div>

      {/* ── Summary ──────────────────────────────────────────────────── */}
      {summary && (
        <section className="mt-16">
          <p className="text-[10px] uppercase tracking-[0.18em] font-medium text-mute">
            Summary
          </p>
          <p className="mt-4 max-w-prose text-[16px] leading-[1.7] text-ink">
            {summary}
          </p>
        </section>
      )}

      {/* ── Experience ───────────────────────────────────────────────── */}
      {profile.experience.length > 0 && (
        <section className="mt-16">
          <p className="text-[10px] uppercase tracking-[0.18em] font-medium text-mute">
            Experience
          </p>
          <div className="mt-8 flex flex-col">
            {profile.experience.map((entry, i) => (
              <div
                key={i}
                className={`flex gap-8 ${i > 0 ? "border-t border-hairline pt-8" : ""} pb-8`}
              >
                {/* Year gutter */}
                <div className="w-[88px] shrink-0">
                  <span className="text-[16px] [font-family:var(--font-serif)] text-ink/40 tabular-nums">
                    {formatYear(entry.startDate)}
                  </span>
                </div>

                {/* Role details */}
                <div className="flex-1 min-w-0">
                  <p className="text-[20px] [font-family:var(--font-serif)] text-ink leading-snug">
                    {entry.title}
                  </p>
                  <p className="mt-1 text-[13px] text-mute">
                    {[
                      entry.company,
                      entry.startDate
                        ? `${formatYear(entry.startDate)} - ${entry.endDate ? formatYear(entry.endDate) : "Present"}`
                        : entry.endDate
                          ? `- ${formatYear(entry.endDate)}`
                          : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {entry.description && (
                    <p className="mt-3 text-[14px] leading-[1.6] text-body max-w-prose">
                      {entry.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Education ────────────────────────────────────────────────── */}
      {profile.education.length > 0 && (
        <section className="mt-16">
          <p className="text-[10px] uppercase tracking-[0.18em] font-medium text-mute">
            Education
          </p>
          <ul className="mt-5 flex flex-col gap-6">
            {profile.education.map((entry, i) => (
              <li key={i} className="flex flex-col gap-1">
                <p className="type-title text-ink">{entry.school}</p>
                {(entry.degree || entry.field) && (
                  <p className="type-body text-body">
                    {[entry.degree, entry.field].filter(Boolean).join(", ")}
                  </p>
                )}
                {(entry.startDate || entry.endDate) && (
                  <p className="type-caption mt-0.5 text-mute">
                    {entry.startDate ?? "-"} &ndash; {entry.endDate ?? "-"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Skills ───────────────────────────────────────────────────── */}
      {profile.skills.length > 0 && (
        <section className="mt-16">
          <p className="text-[10px] uppercase tracking-[0.18em] font-medium text-mute">
            Skills
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {profile.skills.map((skill) => (
              <li
                key={skill}
                className="type-caption rounded-pill border border-hairline bg-paper px-3 py-1 text-body"
              >
                {skill}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
