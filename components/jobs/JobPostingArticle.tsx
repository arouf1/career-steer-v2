"use client";

// Public-facing render of a single job posting at
// /jobs/listing/[city]/[company]/[title]/[id]. The page boundary stays a
// Server Component (it owns JSON-LD, generateMetadata, the fire-and-forget
// mutations, and SSR'd illustrationUrl); this article is a Client Component
// so the IntersectionObserver-driven TOC, motion fades, and live hero image
// subscription can mount cleanly.

import { useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  Building2,
  Calendar,
  ExternalLink,
  MapPin,
  PoundSterling,
} from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  MobileTableOfContents,
  type SectionLink,
  WikiTableOfContents,
} from "@/components/site/TableOfContents";
import {
  FieldCitation,
  type CitationSource,
} from "@/components/career-guides/FieldCitation";
import { HeroImageLive } from "./HeroImageLive";
import { JobVoiceCallTile } from "./voice/JobVoiceCallTile";
import { InterviewSimCallTile } from "./voice/interview/InterviewSimCallTile";

type Posting = Doc<"job_postings">;

type Citation = {
  url: string;
  title: string;
  publisher?: string;
  fetchedAt: number;
};

type ResearchStatus = "pending" | "generating" | "complete" | "failed";

type CompanyResearch = {
  status: ResearchStatus;
  culture: string | null;
  financials: string | null;
  citations: Record<string, Citation[]>;
} | null;

type CompanyRoleResearch = {
  status: ResearchStatus;
  interview: string | null;
  compensation: string | null;
  citations: Record<string, Citation[]>;
} | null;

type RelatedJob = {
  jobPostingId: string;
  score: number;
  title: string;
  companyName: string;
  city: string;
  citySlug: string;
  companySlug: string;
  titleSlug: string;
  illustrationUrl: string | null;
  overviewSnippet: string;
};

type Company = {
  nameRaw: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
};

type Props = {
  posting: Posting;
  company: Company;
  relatedGuide: {
    slug: string;
    title: string;
  } | null;
  illustrationUrl: string | null;
  companyResearch: CompanyResearch;
  companyRoleResearch: CompanyRoleResearch;
  relatedJobs: RelatedJob[];
};

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

const fadeEase = [0.2, 0.65, 0.3, 1] as const;

const sectionTitleCls =
  "text-balance text-3xl leading-[1.15] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-[2.25rem]";

const sectionShellCls =
  "scroll-mt-24 border-t border-hairline py-14 first:border-t-0";

const sectionBodyCls =
  "max-w-2xl space-y-5 text-[17px] leading-[1.75] text-ink/75";

function applyLabelFor(via: string | undefined): string {
  const cleaned = via?.replace(/^via\s+/i, "")?.trim();
  return cleaned ? `Apply on ${cleaned}` : "Apply on the source site";
}

function buildSections({
  hasWhatStandsOut,
  hasCompSummary,
  hasCompInsights,
  hasCulture,
  hasFinancials,
  hasInterview,
  hasRelatedJobs,
}: {
  hasWhatStandsOut: boolean;
  hasCompSummary: boolean;
  hasCompInsights: boolean;
  hasCulture: boolean;
  hasFinancials: boolean;
  hasInterview: boolean;
  hasRelatedJobs: boolean;
}): SectionLink[] {
  const sections: SectionLink[] = [
    { id: "overview", label: "Overview" },
    { id: "the-role", label: "The role" },
  ];
  if (hasWhatStandsOut)
    sections.push({ id: "what-stands-out", label: "What stands out" });
  sections.push({ id: "who-thrives", label: "Who would thrive" });
  if (hasCompSummary)
    sections.push({ id: "compensation", label: "Compensation" });
  if (hasCompInsights)
    sections.push({ id: "comp-insights", label: "Market signal" });
  if (hasCulture) sections.push({ id: "culture", label: "Company culture" });
  if (hasFinancials)
    sections.push({ id: "financials", label: "Company health" });
  if (hasInterview)
    sections.push({ id: "interview", label: "Interview process" });
  if (hasRelatedJobs) sections.push({ id: "related-jobs", label: "Related jobs" });
  return sections;
}

function toCitationSources(citations: Citation[] | undefined): CitationSource[] {
  if (!citations || citations.length === 0) return [];
  return citations.map((c) => ({
    url: c.url,
    title: c.title,
    publisher: c.publisher,
    fetchedAt: c.fetchedAt,
  }));
}

export function JobPostingArticle({
  posting,
  company,
  relatedGuide,
  illustrationUrl,
  companyResearch,
  companyRoleResearch,
  relatedJobs,
}: Props) {
  const isArchived = posting.isActive === false;
  const content = posting.content;
  const ext = posting.detectedExtensions;

  // Role-overlay surfaces only render when there's actually a matched
  // archetype. Before the resolver lands, default-allow so the article is
  // stable on the first view; once it has run with no match, hide them.
  const archetypeResolved = posting.roleArchetypeResolvedAt != null;
  const hasArchetypeSlug = posting.roleArchetypeSlug != null;
  const showRoleSurfaces = !archetypeResolved || hasArchetypeSlug;

  // Each research surface only renders inline when the data is actually
  // there, pending/loading/failed/empty states are silently omitted so the
  // article never shows a "Researching…" stub under a serif headline. The
  // research lands within ~30-60s and pops in on the next view.
  const cultureText =
    companyResearch?.status === "complete" && companyResearch.culture
      ? companyResearch.culture
      : null;

  const financialsText =
    companyResearch?.status === "complete" && companyResearch.financials
      ? companyResearch.financials
      : null;

  const interviewText =
    showRoleSurfaces &&
    companyRoleResearch?.status === "complete" &&
    companyRoleResearch.interview
      ? companyRoleResearch.interview
      : null;

  const compInsightsText =
    showRoleSurfaces &&
    companyRoleResearch?.status === "complete" &&
    companyRoleResearch.compensation
      ? companyRoleResearch.compensation
      : null;

  const sections = useMemo(
    () =>
      buildSections({
        hasWhatStandsOut: !!content && content.whatStandsOut.length > 0,
        hasCompSummary: !!content?.compSummary,
        hasCompInsights: !!compInsightsText,
        hasCulture: !!cultureText,
        hasFinancials: !!financialsText,
        hasInterview: !!interviewText,
        hasRelatedJobs: relatedJobs.length > 0,
      }),
    [
      content,
      compInsightsText,
      cultureText,
      financialsText,
      interviewText,
      relatedJobs.length,
    ],
  );

  // Listing path and call title for the voice CTA. Built once here so
  // JobByline (byline-inline variant) and JobSidebar (aside variant) stay
  // in lockstep without re-deriving.
  const listingPath = `/jobs/listing/${posting.citySlug}/${company.slug}/${posting.titleSlug}/${posting._id}`;
  const callTitle = `the ${posting.title} role at ${company.nameRaw}`;

  // Pending state: posting exists but the LLM rewrite hasn't landed. Render
  // a stripped-down single-column layout with the byline + raw description so
  // the page is useful immediately.
  if (!content) {
    return (
      <PendingShell
        posting={posting}
        company={company}
        illustrationUrl={illustrationUrl}
        isArchived={isArchived}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 pb-32 sm:px-10">
      <div className="pb-12 pt-8">
        <Link
          href="/jobs"
          className="group inline-flex items-center gap-2 text-[13px] text-mute hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          All jobs
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-y-12 lg:grid-cols-12 lg:gap-12">
        <aside className="hidden lg:col-span-2 lg:block">
          <div className="lg:sticky lg:top-12">
            <WikiTableOfContents sections={sections} />
          </div>
        </aside>

        <article className="min-w-0 lg:col-span-7">
          <JobByline
            posting={posting}
            company={company}
            ext={ext}
            isArchived={isArchived}
            listingPath={listingPath}
            callTitle={callTitle}
          />

          {isArchived && <ArchivedNotice />}

          <HeroFigure
            jobPostingId={posting._id}
            initialUrl={illustrationUrl}
            alt={content.socialAlt ?? posting.title}
          />

          <div>
            <ArticleSection
              id="overview"
              eyebrow="Summary"
              title="Overview"
            >
              <p>{content.overview}</p>
            </ArticleSection>

            <ArticleSection
              id="the-role"
              eyebrow="Day to day"
              title="The role"
            >
              <p>{content.theRole}</p>
            </ArticleSection>

            {content.whatStandsOut.length > 0 && (
              <ArticleSection
                id="what-stands-out"
                eyebrow="Highlights"
                title="What stands out"
              >
                <ul className="space-y-2.5 text-[15px] leading-relaxed text-ink/85">
                  {content.whatStandsOut.map((item, i) => (
                    <li key={i} className="flex gap-3">
                      <span
                        aria-hidden
                        className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-pill bg-ink-soft"
                      />
                      <span className="min-w-0 flex-1">{item}</span>
                    </li>
                  ))}
                </ul>
              </ArticleSection>
            )}

            <ArticleSection
              id="who-thrives"
              eyebrow="Audience"
              title="Who would thrive here"
            >
              <p>{content.idealCandidate}</p>
            </ArticleSection>

            {content.compSummary && (
              <ArticleSection
                id="compensation"
                eyebrow="Compensation"
                title="About the compensation"
              >
                <p>{content.compSummary}</p>
              </ArticleSection>
            )}

            {compInsightsText && (
              <ArticleSection
                id="comp-insights"
                eyebrow="Market signal"
                title="Compensation insights"
              >
                <p>
                  {compInsightsText}
                  <FieldCitation
                    citations={toCitationSources(
                      companyRoleResearch?.citations.compensation,
                    )}
                  />
                </p>
              </ArticleSection>
            )}

            {cultureText && (
              <ArticleSection
                id="culture"
                eyebrow="Culture"
                title={`Inside ${company.nameRaw}`}
              >
                <p>
                  {cultureText}
                  <FieldCitation
                    citations={toCitationSources(
                      companyResearch?.citations.culture,
                    )}
                  />
                </p>
              </ArticleSection>
            )}

            {financialsText && (
              <ArticleSection
                id="financials"
                eyebrow="Company health"
                title="Recent financials"
              >
                <p>
                  {financialsText}
                  <FieldCitation
                    citations={toCitationSources(
                      companyResearch?.citations.financials,
                    )}
                  />
                </p>
              </ArticleSection>
            )}

            {interviewText && (
              <ArticleSection
                id="interview"
                eyebrow="Process"
                title="The interview process"
              >
                <p>
                  {interviewText}
                  <FieldCitation
                    citations={toCitationSources(
                      companyRoleResearch?.citations.interview,
                    )}
                  />
                </p>
              </ArticleSection>
            )}

            {relatedJobs.length > 0 && (
              <ArticleSection
                id="related-jobs"
                eyebrow="Keep looking"
                title="Related roles"
              >
                <RelatedJobsGrid jobs={relatedJobs} />
              </ArticleSection>
            )}
          </div>
        </article>

        <aside className="lg:col-span-3">
          <div className="flex flex-col gap-6 lg:sticky lg:top-12">
            <JobSidebar
              posting={posting}
              company={company}
              isArchived={isArchived}
              ext={ext}
              relatedGuide={relatedGuide}
              listingPath={listingPath}
              callTitle={callTitle}
            />
          </div>
        </aside>
      </div>

      <MobileTableOfContents sections={sections} />
    </div>
  );
}

// ── Byline ────────────────────────────────────────────────────────────────

function JobByline({
  posting,
  company,
  ext,
  isArchived,
  listingPath,
  callTitle,
}: {
  posting: Posting;
  company: Company;
  ext: Posting["detectedExtensions"];
  isArchived: boolean;
  // Both undefined in the pending shell (no content yet → call would fail
  // with posting-not-ready, so we silently skip the tile there).
  listingPath?: string;
  callTitle?: string;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: fadeEase }}
      className="flex flex-col gap-6"
    >
      <h1 className="text-balance text-5xl leading-[1.02] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-6xl lg:text-[4.25rem]">
        {posting.title}
      </h1>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-3 text-[13px] text-mute">
        <span className="inline-flex items-center gap-2">
          {company.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logoUrl}
              alt=""
              width={20}
              height={20}
              className="size-5 shrink-0 rounded-sm object-contain"
            />
          )}
          <span className="font-medium text-ink/85">{company.nameRaw}</span>
        </span>

        <MetaSeparator />

        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5" strokeWidth={1.75} />
          {posting.location}
        </span>

        {ext?.workFromHome && (
          <>
            <MetaSeparator />
            <span>Remote-friendly</span>
          </>
        )}

        {ext?.schedule && (
          <>
            <MetaSeparator />
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-3.5" strokeWidth={1.75} />
              {ext.schedule}
            </span>
          </>
        )}

        {ext?.postedAt && (
          <>
            <MetaSeparator />
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" strokeWidth={1.75} />
              {ext.postedAt}
            </span>
          </>
        )}

        {ext?.salary && (
          <>
            <MetaSeparator />
            <span className="inline-flex items-center gap-1.5 font-medium text-ink/85">
              <PoundSterling className="size-3.5" strokeWidth={1.75} />
              {ext.salary}
            </span>
          </>
        )}

        {posting.applyLink && !isArchived && (
          <>
            <MetaSeparator />
            <a
              href={posting.applyLink}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 text-mute transition-colors hover:text-ink"
            >
              {applyLabelFor(posting.via)}
              <ArrowUpRight
                className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                strokeWidth={1.75}
              />
            </a>
          </>
        )}

        {!isArchived && listingPath && callTitle && (
          <>
            <MetaSeparator />
            <JobVoiceCallTile
              jobPostingId={posting._id}
              callTitle={callTitle}
              listingPath={listingPath}
              variant="byline-inline"
            />
            <MetaSeparator />
            <InterviewSimCallTile
              jobPostingId={posting._id}
              callTitle={callTitle}
              companyName={company.nameRaw}
              listingPath={listingPath}
              variant="byline-inline"
            />
          </>
        )}
      </div>
    </motion.header>
  );
}

function MetaSeparator() {
  return (
    <span className="text-mute/60" aria-hidden>
      ·
    </span>
  );
}

// ── Archived ──────────────────────────────────────────────────────────────

function ArchivedNotice() {
  return (
    <aside
      role="note"
      className="mt-10 border-l border-state-warning/40 pl-5 text-[15px] leading-relaxed text-ink/75"
    >
      <p className="text-state-warning/90 font-medium">
        No longer accepting applications
      </p>
      <p className="mt-1 text-ink/70">
        This listing has expired. We keep the page live so it stays linkable,
        but you won&apos;t be able to apply.
      </p>
    </aside>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────

function HeroFigure({
  jobPostingId,
  initialUrl,
  alt,
}: {
  jobPostingId: Posting["_id"];
  initialUrl: string | null;
  alt: string;
}) {
  return (
    <motion.figure
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.15, ease: fadeEase }}
      className="mt-12 overflow-hidden rounded-card border border-hairline"
    >
      <HeroImageLive
        jobPostingId={jobPostingId}
        initialUrl={initialUrl}
        alt={alt}
      />
    </motion.figure>
  );
}

// ── Article section ───────────────────────────────────────────────────────

function ArticleSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: fadeEase }}
      className={sectionShellCls}
    >
      <p className={eyebrowCls}>{eyebrow}</p>
      <h2 className={`${sectionTitleCls} mt-3`}>{title}</h2>
      <div className={`mt-6 ${sectionBodyCls}`}>{children}</div>
    </motion.section>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────

function JobSidebar({
  posting,
  company,
  isArchived,
  ext,
  relatedGuide,
  listingPath,
  callTitle,
}: {
  posting: Posting;
  company: Company;
  isArchived: boolean;
  ext: Posting["detectedExtensions"];
  relatedGuide: { slug: string; title: string } | null;
  listingPath: string;
  callTitle: string;
}) {
  return (
    <>
      {posting.applyLink && !isArchived && (
        <a
          href={posting.applyLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-pill bg-ink px-6 py-3 text-[14px] font-medium text-paper transition-colors hover:bg-ink-deep"
        >
          {applyLabelFor(posting.via)}
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </a>
      )}

      {!isArchived && (
        <>
          <JobVoiceCallTile
            jobPostingId={posting._id}
            callTitle={callTitle}
            listingPath={listingPath}
            variant="aside"
          />
          <InterviewSimCallTile
            jobPostingId={posting._id}
            callTitle={callTitle}
            companyName={company.nameRaw}
            listingPath={listingPath}
            variant="aside"
          />
        </>
      )}

      {ext?.salary && (
        <SidebarCard eyebrow="Salary">
          <p className="text-[20px] font-medium leading-tight text-ink [font-family:var(--font-serif)]">
            {ext.salary}
          </p>
          <p className="mt-1 text-[12px] text-mute">From the source posting</p>
        </SidebarCard>
      )}

      {company.domain && (
        <SidebarCard eyebrow="Company">
          <a
            href={`https://${company.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-ink hover:text-ink-deep"
          >
            {company.nameRaw}
            <ArrowUpRight
              className="size-3.5 text-mute transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
              strokeWidth={1.75}
            />
          </a>
          <p className="mt-1 text-[12px] text-mute">{company.domain}</p>
        </SidebarCard>
      )}

      {relatedGuide && (
        <Link
          href={`/career-guides/${relatedGuide.slug}`}
          className="group block rounded-card border border-hairline bg-paper-raised p-5 transition-colors hover:border-hairline-strong"
        >
          <p className={eyebrowCls}>Further reading</p>
          <p className="mt-3 text-[18px] leading-[1.25] text-balance text-ink [font-family:var(--font-serif)]">
            The {relatedGuide.title} career guide
            <ArrowUpRight
              className="ml-1 inline size-4 align-[-2px] text-ink/45 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
              strokeWidth={1.5}
            />
          </p>
        </Link>
      )}
    </>
  );
}

function SidebarCard({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-hairline bg-paper-raised p-5">
      <p className={eyebrowCls}>{eyebrow}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

// ── Related jobs grid ─────────────────────────────────────────────────────

function RelatedJobsGrid({ jobs }: { jobs: RelatedJob[] }) {
  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map((j) => (
        <li key={j.jobPostingId} className="h-full">
          <RelatedJobCard job={j} />
        </li>
      ))}
    </ul>
  );
}

function RelatedJobCard({ job }: { job: RelatedJob }) {
  return (
    <Link
      href={`/jobs/listing/${job.citySlug}/${job.companySlug}/${job.titleSlug}/${job.jobPostingId}`}
      className="group relative flex aspect-[3/4] flex-col overflow-hidden rounded-surface border border-hairline bg-paper-raised transition-colors hover:border-hairline-strong"
    >
      {job.illustrationUrl ? (
        <Image
          src={job.illustrationUrl}
          alt={`Illustration for ${job.title}`}
          fill
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-paper" aria-hidden />
      )}

      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-paper-raised via-paper-raised to-transparent"
      />

      <div className="relative z-10 mt-auto flex flex-col gap-2 px-5 pb-5">
        <h3 className="type-title text-balance text-ink">{job.title}</h3>
        {job.overviewSnippet && (
          <p className="type-body line-clamp-3 text-body">
            {job.overviewSnippet}
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-mute">
          <span className="font-medium text-ink/75">{job.companyName}</span>
          <span className="text-mute/50" aria-hidden>
            ·
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3" strokeWidth={1.75} />
            {job.city}
          </span>
        </p>
      </div>
    </Link>
  );
}

// ── Pending shell (LLM rewrite still in flight) ──────────────────────────

function PendingShell({
  posting,
  company,
  illustrationUrl,
  isArchived,
}: {
  posting: Posting;
  company: Company;
  illustrationUrl: string | null;
  isArchived: boolean;
}) {
  const ext = posting.detectedExtensions;
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-24 sm:px-10">
      <div className="pb-12 pt-8">
        <Link
          href="/jobs"
          className="group inline-flex items-center gap-2 text-[13px] text-mute hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          All jobs
        </Link>
      </div>

      <article className="flex flex-col gap-10">
        <JobByline
          posting={posting}
          company={company}
          ext={ext}
          isArchived={isArchived}
        />

        {isArchived && <ArchivedNotice />}

        <HeroFigure
          jobPostingId={posting._id}
          initialUrl={illustrationUrl}
          alt={posting.title}
        />

        <div className="flex flex-col gap-4">
          <p className={eyebrowCls}>
            From the source posting · we&apos;re writing a polished version now
          </p>
          <div className="whitespace-pre-line rounded-card border border-hairline bg-paper-raised px-5 py-4 text-[15px] leading-relaxed text-ink/75">
            {posting.rawDescription || (
              <span className="italic text-mute">
                <Briefcase
                  className="mr-1.5 inline size-3.5 align-text-bottom"
                  strokeWidth={1.75}
                />
                No description provided.
              </span>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
