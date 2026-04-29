"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  MapPin,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { GuideWithUrl } from "@/convex/careerGuides";
import { MobileTableOfContents } from "./MobileTableOfContents";
import { FieldCitation, type CitationSource } from "./FieldCitation";
import { CareerGuidePodcast } from "./CareerGuidePodcast";

export type Region = "us" | "uk";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

type ArticleProps = {
  guide: GuideWithUrl;
  defaultRegion: Region;
  /** Map of normalized (lowercased + trimmed) existing guide titles → slug. */
  existingByTitle: Record<string, string>;
};

type SectionLink = { id: string; label: string };

function buildSections(
  title: string,
  hasRisks: boolean,
  hasPodcast: boolean,
): SectionLink[] {
  const sections: SectionLink[] = [];
  if (hasPodcast) sections.push({ id: "podcast", label: "Listen" });
  sections.push(
    { id: "overview", label: `What is a ${title}?` },
    { id: "skills", label: "Skills you need" },
    { id: "day-to-day", label: "Day to day" },
    { id: "outlook", label: "Career outlook" },
    { id: "learning-path", label: "How to get there" },
  );
  if (hasRisks) sections.push({ id: "considerations", label: "Worth knowing" });
  sections.push({ id: "related", label: "Related roles" });
  return sections;
}

export function CareerGuideArticle({
  guide,
  defaultRegion,
  existingByTitle,
}: ArticleProps) {
  const searchParams = useSearchParams();
  const region: Region =
    searchParams.get("region") === "uk" ? "uk" : defaultRegion;

  const c = guide.content;
  const hasPodcast = guide.podcast?.status !== undefined && guide.podcast.status !== "failed";
  const sections = useMemo(
    () =>
      buildSections(
        guide.title,
        (c?.riskFactors.length ?? 0) > 0,
        hasPodcast,
      ),
    [guide.title, c?.riskFactors.length, hasPodcast],
  );

  if (!c) return null;
  const r = c.regional[region];
  const cite = (path: string): CitationSource[] | undefined =>
    guide.citations?.[path];

  return (
    <div className="mx-auto w-full max-w-7xl px-6 pb-32 sm:px-10">
      <div className="pb-12 pt-8">
        <Link
          href="/career-guides"
          className="group inline-flex items-center gap-2 text-[13px] text-mute transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-0.5" />
          All career guides
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-y-12 lg:grid-cols-12 lg:gap-12">
        {/* Sticky desktop TOC */}
        <aside className="hidden lg:col-span-2 lg:block">
          <div className="lg:sticky lg:top-12">
            <WikiTableOfContents sections={sections} />
          </div>
        </aside>

        {/* Article */}
        <article className="min-w-0 lg:col-span-7">
          <Byline
            title={guide.title}
            updatedAt={guide.updatedAt}
            lead={c.whyConsider}
          />

          <Illustration
            url={guide.illustrationUrl}
            status={guide.illustrationStatus}
            title={guide.title}
          />

          <CareerGuidePodcast guide={guide} />

          <div className="divide-y divide-hairline">
            <ArticleSection
              id="overview"
              eyebrow="Section one"
              title={`What is a ${guide.title}?`}
            >
              <div className="max-w-2xl space-y-5">
                {c.overview.split("\n").map((para, i) => (
                  <p
                    key={i}
                    className="text-balance text-[17px] leading-[1.75] text-ink/75"
                  >
                    {para}
                  </p>
                ))}
              </div>

              <div className="mt-10 max-w-2xl rounded-surface border border-hairline bg-paper-raised px-6 py-5">
                <p className="text-[15px] leading-relaxed text-body">
                  This is a general guide.{" "}
                  <Link
                    href="/profile"
                    className="font-medium text-ink underline-offset-4 transition-colors hover:underline"
                  >
                    Upload your CV
                  </Link>{" "}
                  to see how your specific skills and experience align with
                  this career path.
                </p>
              </div>
            </ArticleSection>

            <ArticleSection
              id="skills"
              eyebrow="Section two"
              title="What skills do you need?"
              lead="The capabilities that matter most for this role, from core to complementary."
            >
              <ul className="max-w-2xl space-y-2.5">
                {c.typicalSkills.map((skill, i, arr) => (
                  <li
                    key={skill}
                    className="flex items-start gap-3 text-[15px] leading-relaxed text-ink/85"
                  >
                    <span
                      aria-hidden
                      className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-pill bg-ink-soft"
                    />
                    <span>
                      {skill}
                      {i === arr.length - 1 && (
                        <FieldCitation citations={cite("typicalSkills")} />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </ArticleSection>

            <ArticleSection
              id="day-to-day"
              eyebrow="Section three"
              title="What does the day look like?"
              lead="What the work actually looks like, beyond the job description."
            >
              <div className="max-w-2xl space-y-5">
                {c.dayToDay.split("\n").map((para, i) => (
                  <p
                    key={i}
                    className="text-balance text-[17px] leading-[1.75] text-ink/75"
                  >
                    {para}
                  </p>
                ))}
              </div>
            </ArticleSection>

            <ArticleSection
              id="outlook"
              eyebrow="Section four"
              title="What's the career outlook?"
              lead="Where the demand is heading and what the market looks like today."
              meta={<RegionBadge region={region} />}
            >
              <div className="max-w-2xl space-y-5">
                {r.careerOutlook.split("\n").map((para, i, arr) => (
                  <p
                    key={i}
                    className="text-balance text-[17px] leading-[1.75] text-ink/75"
                  >
                    {para}
                    {i === arr.length - 1 && (
                      <FieldCitation
                        citations={cite(`regional.${region}.careerOutlook`)}
                      />
                    )}
                  </p>
                ))}
              </div>
            </ArticleSection>

            <ArticleSection
              id="learning-path"
              eyebrow="Section five"
              title="How do you get there?"
              lead="A practical path from interest to competence, step by step."
              meta={<RegionBadge region={region} />}
            >
              <ol className="max-w-2xl space-y-7">
                {r.learningPath.map((step, i, arr) => (
                  <li key={step} className="flex items-start gap-6">
                    <span className="w-8 shrink-0 pt-1 text-2xl font-light leading-none tabular-nums text-ink/30 [font-family:var(--font-serif)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <p className="flex-1 text-[16px] leading-[1.7] text-ink/85">
                      {step}
                      {i === arr.length - 1 && (
                        <FieldCitation
                          citations={cite(`regional.${region}.learningPath`)}
                        />
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            </ArticleSection>

            {c.riskFactors.length > 0 && (
              <ArticleSection
                id="considerations"
                eyebrow="Section six"
                title="Worth knowing."
                lead="Honest considerations to weigh before you commit."
              >
                <ul className="max-w-2xl space-y-5">
                  {c.riskFactors.map((item, i, arr) => (
                    <li
                      key={item}
                      className="flex items-start gap-5 border-l border-state-warning/40 py-1 pl-5 text-[16px] leading-[1.7] text-ink/80"
                    >
                      <span>
                        {item}
                        {i === arr.length - 1 && (
                          <FieldCitation citations={cite("riskFactors")} />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </ArticleSection>
            )}

            <ArticleSection
              id="related"
              eyebrow="Section seven"
              title="Related roles."
              lead="Other career paths that share common ground with this one."
              meta={<RegionBadge region={region} />}
            >
              <ul className="max-w-2xl space-y-1">
                {r.relatedRoles.map((role) => {
                  const existingSlug =
                    existingByTitle[role.toLowerCase().trim()];
                  const href = existingSlug
                    ? `/career-guides/${existingSlug}`
                    : `/?q=${encodeURIComponent(role)}`;
                  return (
                    <li key={role}>
                      <Link
                        href={href}
                        className="group -mx-2 flex items-center justify-between rounded-control border-b border-hairline/70 px-2 py-3 transition-colors last:border-b-0 hover:bg-ink/[0.03]"
                      >
                        <span className="text-[15px] text-ink/85 transition-colors group-hover:text-ink">
                          {role}
                        </span>
                        <ArrowUpRight
                          className="h-3.5 w-3.5 text-mute opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </ArticleSection>
          </div>
        </article>

        {/* Sidebar */}
        <aside className="lg:col-span-3">
          <div className="lg:sticky lg:top-12">
            <Sidebar
              slug={guide.slug}
              region={region}
              salary={r.salary}
              salaryCitations={cite(`regional.${region}.salary`)}
            />
          </div>
        </aside>
      </div>

      <MobileTableOfContents sections={sections} />
    </div>
  );
}

function Byline({
  title,
  updatedAt,
  lead,
}: {
  title: string;
  updatedAt: number;
  lead?: string;
}) {
  const formatted = new Date(updatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.65, 0.3, 1] }}
      className="border-b border-hairline pb-12"
    >
      <h1 className="mt-6 text-balance text-5xl leading-[1.02] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-6xl lg:text-[4.25rem]">
        {title}
      </h1>
      {lead && (
        <p className="mt-7 max-w-2xl text-balance text-[19px] leading-[1.55] text-ink/70 sm:text-[20px]">
          {lead}
        </p>
      )}
      <div className="mt-9 flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px] text-mute">
        <span>Career guide</span>
        <span aria-hidden className="text-mute/40">
          ·
        </span>
        <span>Last updated {formatted}</span>
      </div>
    </motion.header>
  );
}

function Illustration({
  url,
  status,
  title,
}: {
  url: string | null;
  status: "generating" | "complete" | "failed";
  title: string;
}) {
  if (status === "generating") {
    return (
      <div className="my-12 aspect-[16/9] w-full animate-pulse rounded-card border border-hairline bg-paper-raised" />
    );
  }
  if (status === "failed" || !url) return <div className="my-12" />;
  return (
    <motion.figure
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.15, ease: [0.2, 0.65, 0.3, 1] }}
      className="my-12 overflow-hidden rounded-card border border-hairline"
    >
      <Image
        src={url}
        alt={`Illustration representing the career of ${title}`}
        width={1280}
        height={720}
        className="h-auto w-full"
        priority
      />
    </motion.figure>
  );
}

function ArticleSection({
  id,
  eyebrow,
  title,
  lead,
  meta,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 py-14 first:pt-0">
      {(eyebrow || meta) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {eyebrow && <p className={eyebrowCls}>{eyebrow}</p>}
          {meta}
        </div>
      )}
      <h2 className="mt-3 text-balance text-3xl leading-[1.15] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-[2rem]">
        {title}
      </h2>
      {lead && (
        <p className="mt-5 max-w-2xl text-balance text-[17px] leading-[1.75] text-ink/75">
          {lead}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function WikiTableOfContents({ sections }: { sections: SectionLink[] }) {
  const [activeSection, setActiveSection] = useState<string>("");

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    }
  };

  return (
    <nav aria-label="Article sections">
      <p className={eyebrowCls}>In this guide</p>
      <ul className="mt-4 space-y-0.5">
        {sections.map((section, i) => {
          const isActive = activeSection === section.id;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => handleClick(section.id)}
                className={`group flex w-full items-baseline gap-3 py-1.5 text-left text-[13px] transition-colors duration-300 ${
                  isActive
                    ? "text-ink"
                    : "text-ink/45 hover:text-ink/80"
                }`}
              >
                <span
                  aria-hidden
                  className={`w-6 shrink-0 text-[12px] tabular-nums leading-none [font-family:var(--font-serif)] transition-colors duration-300 ${
                    isActive
                      ? "text-ink"
                      : "text-ink/30 group-hover:text-ink/60"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                {section.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function RegionBadge({ region }: { region: Region }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
      <MapPin className="h-3 w-3" aria-hidden="true" strokeWidth={1.75} />
      {region === "us" ? "United States" : "United Kingdom"}
    </span>
  );
}

type Salary = {
  entry: string;
  mid: string;
  senior: string;
  note?: string;
};

// Compacts six-figure salary strings for display:
//   "$300,000 to $400,000" -> "300k to 400k"
//   "£28,000 to £38,000"   -> "28k to 38k"
//   "$600,000+"            -> "600k+"
//   "$50,500 to $63,500"   -> "50.5k to 63.5k"
// Currency symbol is stripped because the active region is already shown
// in the sidebar's segmented toggle directly above.
function formatSalaryBand(s: string): string {
  return s
    .replace(/[$£€]/g, "")
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => {
      const n = Number.parseInt(m.replace(/,/g, ""), 10);
      if (!Number.isFinite(n)) return m;
      if (n >= 1_000_000) {
        const v = n / 1_000_000;
        return `${v % 1 === 0 ? v : v.toFixed(1)}m`;
      }
      if (n >= 1_000) {
        const v = n / 1_000;
        return `${v % 1 === 0 ? v : v.toFixed(1)}k`;
      }
      return m;
    })
    .trim();
}

function Sidebar({
  slug,
  region,
  salary,
  salaryCitations,
}: {
  slug: string;
  region: Region;
  salary: Salary;
  salaryCitations?: CitationSource[];
}) {
  const bands: Array<[string, string]> = [
    ["Entry", formatSalaryBand(salary.entry)],
    ["Mid", formatSalaryBand(salary.mid)],
    ["Senior", formatSalaryBand(salary.senior)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <FactCheckCard slug={slug} />
      <div className="rounded-card border border-hairline bg-paper-raised p-6">
        <p className={eyebrowCls}>Region</p>
        <div
          role="group"
          aria-label="Switch region"
          className="mt-3 inline-flex w-full items-center gap-0.5 rounded-pill border border-hairline bg-paper p-1"
        >
          {(["us", "uk"] as const).map((opt) => {
            const active = region === opt;
            const label = opt === "us" ? "US" : "UK";
            return (
              <Link
                key={opt}
                href={`?region=${opt}`}
                replace
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={`type-label flex-1 rounded-pill px-3 py-2 text-center transition-colors ${
                  active
                    ? "bg-paper-raised text-ink"
                    : "text-mute hover:text-ink"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <hr className="my-6 border-hairline" />

        <div className="flex items-center justify-between gap-3">
          <p className={eyebrowCls}>Typical earnings</p>
          <FieldCitation citations={salaryCitations} />
        </div>
        <dl className="mt-3 divide-y divide-hairline">
          {bands.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <dt className="type-caption text-mute">{label}</dt>
              <dd className="type-body text-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {salary.note && (
          <p className="type-caption mt-4 text-mute">{salary.note}</p>
        )}
      </div>

      <Link
        href="/profile"
        className="group flex items-start gap-4 rounded-card bg-ink p-6 text-paper transition-colors hover:bg-ink-deep"
      >
        <div className="flex flex-col gap-2">
          <p className="type-label text-paper/70">Your turn</p>
          <p className="type-title text-paper">
            See where your CV could take you
          </p>
          <p className="type-caption mt-1 text-paper/80">
            Upload your CV and we will map paths that match your real experience.
          </p>
          <span className="type-label mt-3 inline-flex items-center gap-2 text-paper">
            Build my path
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
        </div>
      </Link>
    </div>
  );
}

// ── Live fact-check status (sidebar) ───────────────────────────────────────

const FACT_CHECK_VERBS = [
  "Reading BLS data",
  "Cross-referencing salaries",
  "Pulling outlook reports",
  "Tracing learning paths",
  "Spotting the trade-offs",
];

const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function FactCheckCard({ slug }: { slug: string }) {
  const live = useQuery(api.careerGuides.getBySlug, { slug });
  const enrichment = live?.enrichment;
  const triggerRefresh = useMutation(
    api.careerGuides.triggerEnrichmentBySlug,
  );
  const [verbIdx, setVerbIdx] = useState(0);
  const [refreshPending, setRefreshPending] = useState(false);

  const isRunning = enrichment?.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(
      () => setVerbIdx((i) => (i + 1) % FACT_CHECK_VERBS.length),
      2200,
    );
    return () => clearInterval(id);
  }, [isRunning]);

  // Reset the local pending flag once the doc flips out of "complete" — at
  // that point the card visually switches to the running/queued layout.
  useEffect(() => {
    if (refreshPending && enrichment && enrichment.status !== "complete") {
      setRefreshPending(false);
    }
  }, [refreshPending, enrichment]);

  if (!enrichment) return null;

  if (enrichment.status === "complete") {
    const lastEnrichedAt = enrichment.lastEnrichedAt ?? Date.now();
    const totalSources = Object.values(live?.citations ?? {}).reduce(
      (acc, arr) => acc + arr.length,
      0,
    );
    const isStale = Date.now() - lastEnrichedAt > RECHECK_AFTER_MS;

    const handleRefresh = async () => {
      if (refreshPending) return;
      setRefreshPending(true);
      try {
        await triggerRefresh({ slug });
      } catch {
        setRefreshPending(false);
      }
    };

    return (
      <div className="rounded-card border border-hairline bg-paper-raised p-5">
        <div className="flex items-center justify-between">
          <p className={eyebrowCls}>Fact-checked</p>
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-pill border border-hairline-strong text-ink">
            <Check
              className="h-3 w-3"
              aria-hidden="true"
              strokeWidth={2.25}
            />
          </span>
        </div>
        <p className="mt-2 type-caption text-ink">
          Verified {formatRelative(lastEnrichedAt)}
        </p>
        {totalSources > 0 && (
          <p className="mt-1 type-caption text-mute">
            {totalSources} {totalSources === 1 ? "source" : "sources"} cited inline
          </p>
        )}
        {isStale && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshPending}
            className="mt-4 inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-hairline-strong bg-paper px-2.5 py-1 text-[11px] font-medium leading-none text-ink transition-all hover:border-ink hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <RotateCw
              className={`h-2.5 w-2.5 ${refreshPending ? "animate-spin" : ""}`}
              aria-hidden="true"
              strokeWidth={1.75}
            />
            {refreshPending ? "Re-checking…" : "Re-check sources"}
          </button>
        )}
      </div>
    );
  }

  if (enrichment.status === "failed") {
    return (
      <div className="rounded-card border border-hairline bg-paper-raised p-5">
        <div className="flex items-center justify-between">
          <p className={eyebrowCls}>Fact-check</p>
          <CircleAlert
            className="h-4 w-4 text-mute"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        </div>
        <p className="mt-2 type-caption text-ink">
          Couldn&rsquo;t verify sources
        </p>
        <p className="mt-1 type-caption text-mute">
          We&rsquo;ll try again shortly.
        </p>
      </div>
    );
  }

  // pending or running
  const total = enrichment.progress.total || 1;
  const done = enrichment.progress.done;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="rounded-card border border-hairline bg-paper-raised p-5">
      <div className="flex items-center justify-between">
        <p className={eyebrowCls}>Fact-checking</p>
        <Sparkles
          className="h-3.5 w-3.5 animate-pulse text-ink-soft"
          aria-hidden="true"
          strokeWidth={1.75}
        />
      </div>
      <p className="mt-2 type-caption text-ink tabular-nums">
        {done} / {total} sources verified
      </p>
      <div
        className="mt-3 h-1 w-full overflow-hidden rounded-pill bg-hairline"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div
          className="h-full rounded-pill bg-ink transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-3 type-caption text-mute">
        {isRunning ? FACT_CHECK_VERBS[verbIdx] : "Queued"}
      </p>
    </div>
  );
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${min === 1 ? "minute" : "minutes"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ${hr === 1 ? "hour" : "hours"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} ${day === 1 ? "day" : "days"} ago`;
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Pending state (subscribes via useQuery and reloads when content arrives) ─

const LOADING_VERBS = [
  "Researching the role",
  "Crunching the salary data",
  "Mapping the learning path",
  "Spotting the trade-offs",
  "Drawing the illustration",
];

export function CareerGuidePending({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  const router = useRouter();
  const guide = useQuery(api.careerGuides.getBySlug, { slug });
  const [verbIdx, setVerbIdx] = useState(0);

  const failed = guide?.contentStatus === "failed";

  useEffect(() => {
    if (failed) return;
    const id = setInterval(
      () => setVerbIdx((i) => (i + 1) % LOADING_VERBS.length),
      2200,
    );
    return () => clearInterval(id);
  }, [failed]);

  useEffect(() => {
    if (guide && guide.contentStatus === "complete") {
      router.refresh();
    }
  }, [guide, router]);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-20 sm:px-10">
      <div className="pb-12">
        <Link
          href="/career-guides"
          className="group inline-flex items-center gap-2 text-[13px] text-mute transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-0.5" />
          All career guides
        </Link>
      </div>

      {failed ? (
        <CareerGuideFailed slug={slug} title={title} />
      ) : (
        <>
          <p className={eyebrowCls}>Generating</p>
          <h1 className="type-headline mt-2 text-ink">{title}</h1>

          <div className="mt-12 space-y-6">
            <div className="aspect-[16/9] w-full animate-pulse rounded-card border border-hairline bg-paper-raised" />
            <p className="type-body inline-flex items-center gap-2 text-body">
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-pill bg-ink"
                aria-hidden="true"
              />
              {LOADING_VERBS[verbIdx]}
              <span className="type-caption text-mute">
                (this usually takes 30 to 60 seconds)
              </span>
            </p>
            <div className="space-y-3">
              {[80, 95, 70, 90, 65].map((w, i) => (
                <div
                  key={i}
                  className="h-3 animate-pulse rounded-hair bg-hairline"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CareerGuideFailed({ slug, title }: { slug: string; title: string }) {
  void slug;
  return (
    <div className="flex flex-col gap-6">
      <p className="type-label text-state-error">Generation failed</p>
      <h1 className="type-headline text-ink">{title}</h1>
      <p className="type-body max-w-prose text-body">
        We could not finish this guide. This is usually a temporary model hiccup,
        not something wrong with the title.
      </p>
      <Link
        href="/"
        className="type-label inline-flex items-center gap-2 self-start rounded-pill bg-ink px-6 py-3 text-paper transition-colors hover:bg-ink-deep"
      >
        Try again from the home page
      </Link>
    </div>
  );
}
