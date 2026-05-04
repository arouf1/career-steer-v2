"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  Loader2,
  MapPin,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import type { GuideWithUrl } from "@/convex/careerGuides";
import { MobileTableOfContents } from "./MobileTableOfContents";
import { FieldCitation, type CitationSource } from "./FieldCitation";
import { CareerGuidePodcast } from "./CareerGuidePodcast";
import { AllSourcesPanel } from "./AllSourcesPanel";
import { GoDeeper } from "./GoDeeper";
import { PersonalizationFitCard } from "./PersonalizationFitCard";
import { PersonalizationSkillsCard } from "./PersonalizationSkillsCard";
import { PeopleInFieldSection } from "./PeopleInFieldSection";
import { LoopingFeather } from "./LoopingFeather";
import { DeepDiveCallTile } from "./DeepDiveCallTile";

export type Region = "us" | "uk";

/**
 * Region keys used inside the article. Adds a "user" variant for the
 * per-user personalized regional block (any country other than US/UK).
 */
type RegionKey = "us" | "uk" | "user";

type Salary = {
  entry: string;
  mid: string;
  senior: string;
  note?: string | null;
};

type RegionalView = {
  key: RegionKey;
  label: string; // "United States" / "United Kingdom" / "Canada"
  shortLabel: string; // "US" / "UK" / "CA"
  currencySymbol: string;
  salary: Salary;
  careerOutlook: string;
  learningPath: string[];
  relatedRoles: string[];
  isPersonalized: boolean;
};

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexHttpOrigin = CONVEX_URL
  ? CONVEX_URL.replace(".convex.cloud", ".convex.site")
  : null;

type ArticleProps = {
  guide: GuideWithUrl;
  defaultRegion: Region;
  /** Map of normalized (lowercased + trimmed) existing guide titles → slug. */
  existingByTitle: Record<string, string>;
  /**
   * Server-fetched Go Deeper branches. Seeds GoDeeper's expanded set with
   * already-complete branches so crawlers see Q&A in the SSR'd HTML rather
   * than waiting for the client to mount and run useQuery.
   */
  initialBranches: Doc<"career_guide_branches">[];
};

type SectionLink = { id: string; label: string };

function buildSections(
  title: string,
  hasRisks: boolean,
  hasPodcast: boolean,
  showFitChapter: boolean,
  personalizedSkillsActive: boolean,
): SectionLink[] {
  const sections: SectionLink[] = [];
  if (hasPodcast) sections.push({ id: "podcast", label: "Listen" });
  sections.push({ id: "overview", label: `What is a ${title}?` });
  // "Your fit" chapter sits directly after Overview when the personalization
  // slot is showing anything visible (CTA, skeleton, or the real card).
  if (showFitChapter) sections.push({ id: "your-fit", label: "Your fit" });
  sections.push(
    {
      id: "skills",
      label: personalizedSkillsActive ? "Where you stand" : "Skills you need",
    },
    { id: "day-to-day", label: "Day to day" },
    { id: "outlook", label: "Career outlook" },
    { id: "learning-path", label: "How to get there" },
  );
  if (hasRisks) sections.push({ id: "considerations", label: "Worth knowing" });
  // "People in this field" sits before Related roles so signed-in users see
  // their network nudge before the next-best-guide list. The section also
  // renders for signed-out users (as a blurred teaser with a sign-up CTA),
  // so it always appears in the TOC.
  sections.push({ id: "people", label: "People in this field" });
  sections.push({ id: "related", label: "Related roles" });
  return sections;
}

export function CareerGuideArticle({
  guide,
  defaultRegion,
  existingByTitle,
  initialBranches,
}: ArticleProps) {
  const searchParams = useSearchParams();

  // Clerk auth state — used to suppress the inline "general guide / upload
  // your CV" callout for signed-in users (the personalization fit slot
  // handles their CTA in every state). While Clerk is loading we err on the
  // side of hiding the inline CTA to avoid a flash of redundant content for
  // returning signed-in users.
  const { isLoaded: clerkLoaded, isSignedIn } = useUser();
  const showInlineCvCta = clerkLoaded && !isSignedIn;

  // Personalization state — also subscribed to inside the fit + skills cards.
  // Convex dedupes useQuery subscriptions on the same query+args, so this
  // costs nothing extra and lets the TOC mirror the article's actual sections.
  const personalization = useQuery(
    api.careerGuidePersonalizations.getForGuide,
    { guideId: guide._id },
  );
  const fitSlotVisible =
    personalization?.state === "no-profile" ||
    personalization?.state === "profile-pending" ||
    personalization?.state === "enrichment-failed" ||
    (personalization?.state === "ready" &&
      personalization.row !== null &&
      personalization.row.status !== "failed");
  // The personalised "Where you stand" label only applies when the live row
  // is actually complete and current. During regen we revert to the generic
  // "Skills you need" label rather than risk showing a stale label tied to
  // the old profile.
  const personalizedSkillsActive =
    personalization?.state === "ready" &&
    personalization.row?.status === "complete";
  // Regional content: only honour the live, fresh personalization. When the
  // profile or enrichment has moved on, the previous regional block is by
  // definition stale (wrong country, wrong currency) — fall back to the
  // public US/UK content rather than mislead.
  const personalizedRegional =
    personalization?.state === "ready" &&
    personalization.row?.status === "complete"
      ? personalization.row.content?.regional ?? null
      : null;
  // True while we're waiting on enrichment or generation for a logged-in
  // user with a profile. Used by the sidebar to show a "personalising your
  // region" hint instead of silently falling back to public US/UK content.
  const personalizationPending =
    personalization?.state === "profile-pending" ||
    (personalization?.state === "ready" &&
      personalization.row?.status === "generating");

  // Resolve the active region key:
  //   - explicit URL param wins ("us" / "uk" / "user")
  //   - else default to the user's personalized region when available
  //   - else fall back to the server-derived US/UK default (IP geolocation)
  const regionParam = searchParams.get("region");
  const regionKey: RegionKey = (() => {
    if (regionParam === "us" || regionParam === "uk") return regionParam;
    if (regionParam === "user" && personalizedRegional) return "user";
    if (personalizedRegional) return "user";
    return defaultRegion;
  })();

  const c = guide.content;
  const hasPodcast = guide.podcast?.status !== undefined && guide.podcast.status !== "failed";
  const sections = useMemo(
    () =>
      buildSections(
        guide.title,
        (c?.riskFactors.length ?? 0) > 0,
        hasPodcast,
        !!fitSlotVisible,
        !!personalizedSkillsActive,
      ),
    [
      guide.title,
      c?.riskFactors.length,
      hasPodcast,
      fitSlotVisible,
      personalizedSkillsActive,
    ],
  );

  if (!c) return null;

  // Build the active regional view (used by the article body + sidebar).
  // For "user" we read from personalization; for "us"/"uk" we read from the
  // public guide content. The currency symbol and country label flow with
  // the data so the sidebar's salary band always renders correctly.
  const r: RegionalView = (() => {
    if (regionKey === "user" && personalizedRegional) {
      return {
        key: "user",
        label: personalizedRegional.countryName,
        shortLabel: personalizedRegional.countryCode,
        currencySymbol: personalizedRegional.currencySymbol,
        salary: personalizedRegional.salary,
        careerOutlook: personalizedRegional.careerOutlook,
        learningPath: personalizedRegional.learningPath,
        relatedRoles: personalizedRegional.relatedRoles,
        isPersonalized: true,
      };
    }
    const fallbackKey: "us" | "uk" =
      regionKey === "user" ? defaultRegion : (regionKey as "us" | "uk");
    const block = c.regional[fallbackKey];
    return {
      key: fallbackKey,
      label: fallbackKey === "us" ? "United States" : "United Kingdom",
      shortLabel: fallbackKey === "us" ? "US" : "UK",
      currencySymbol: fallbackKey === "us" ? "$" : "£",
      salary: block.salary,
      careerOutlook: block.careerOutlook,
      learningPath: block.learningPath,
      relatedRoles: block.relatedRoles,
      isPersonalized: false,
    };
  })();

  // Build the list of region tabs the sidebar should expose. We use the
  // ISO country code (CA, AU, DE, JP, ...) for the tab label so all three
  // tabs stay compact and consistent at the same character width. The full
  // country name still appears on the section badges in the article body.
  const availableRegions: Array<{
    key: RegionKey;
    shortLabel: string;
    longLabel: string;
  }> = [];
  // When the personalized region is itself US/UK, skip the matching
  // hardcoded fallback so we don't render the same country twice. The
  // backend is supposed to leave `regional` null for US/UK profiles
  // (see convex/careerGuidePersonalizations.ts), but this guard also
  // catches legacy/dev rows generated before that contract was enforced.
  const personalizedCC = personalizedRegional?.countryCode?.toUpperCase();
  const personalizedIsUS = personalizedCC === "US" || personalizedCC === "USA";
  const personalizedIsUK = personalizedCC === "UK" || personalizedCC === "GB";

  if (personalizedRegional) {
    availableRegions.push({
      key: "user",
      shortLabel:
        personalizedRegional.countryCode?.toUpperCase() ||
        personalizedRegional.countryName,
      longLabel: personalizedRegional.countryName,
    });
  }
  if (!personalizedIsUS) {
    availableRegions.push({
      key: "us",
      shortLabel: "US",
      longLabel: "United States",
    });
  }
  if (!personalizedIsUK) {
    availableRegions.push({
      key: "uk",
      shortLabel: "UK",
      longLabel: "United Kingdom",
    });
  }

  // Citations: public US/UK fields come from `guide.citations`; the
  // personalized "user" region carries Exa-fetched citations on the
  // personalization row itself (under content.regional.citations). Map
  // requested paths so the same `cite("regional.user.salary")` etc.
  // resolves to the personalized sources.
  const personalizedRegionalCitations: CitationSource[] | undefined =
    personalizedRegional?.citations && personalizedRegional.citations.length > 0
      ? personalizedRegional.citations
      : undefined;
  const cite = (path: string): CitationSource[] | undefined => {
    if (!r.isPersonalized) return guide.citations?.[path];
    // For the "user" region, the same Exa citation set covers all three
    // grounded fields (salary, outlook, learning-path). Hand them back for
    // any of those paths so the FieldCitation pill renders.
    if (
      path === `regional.user.salary` ||
      path === `regional.user.careerOutlook` ||
      path === `regional.user.learningPath`
    ) {
      return personalizedRegionalCitations;
    }
    return undefined;
  };
  const followUpsFor = (sectionId: string): string[] | undefined =>
    r.isPersonalized ? undefined : guide.followUps?.[sectionId];

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
            publishedAt={guide.createdAt}
            updatedAt={guide.updatedAt}
            lead={c.whyConsider}
            deepDiveCta={
              <DeepDiveCallTile
                guideId={guide._id}
                guideTitle={guide.title}
                guideSlug={guide.slug}
                region={defaultRegion}
                variant="byline-inline"
              />
            }
          />

          {showInlineCvCta && (
            <div className="mt-10 max-w-2xl rounded-surface bg-ink px-6 py-5">
              <p className="text-[15px] leading-relaxed text-paper/85">
                This is a general guide.{" "}
                <Link
                  href="/workspace/profile"
                  className="font-medium text-paper underline underline-offset-4 transition-colors hover:text-paper/80"
                >
                  Upload your CV
                </Link>{" "}
                to see how your specific skills and experience align with this
                career path.
              </p>
            </div>
          )}

          <Illustration
            url={guide.illustrationUrl}
            status={guide.illustrationStatus}
            title={guide.title}
          />

          <CareerGuidePodcast guide={guide} />

          <div>
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

            </ArticleSection>

            {followUpsFor("overview") && (
              <GoDeeper
                guideId={guide._id}
                sectionId="overview"
                sectionLabel="the overview"
                followUps={followUpsFor("overview")!}
                initialBranches={initialBranches}
              />
            )}

            <PersonalizationFitCard
              guideId={guide._id}
              guideTitle={guide.title}
            />

            <PersonalizationSkillsCard
              guideId={guide._id}
              fallback={
                <ArticleSection
                  id="skills"
                  eyebrow="Section two"
                  title="What skills do you need?"
                  lead="The capabilities that matter most for this role, from core to complementary."
                >
                  <SkillsList
                    detail={c.typicalSkillsDetail}
                    fallback={c.typicalSkills}
                    citations={cite("typicalSkills")}
                  />
                </ArticleSection>
              }
            />

            <ArticleSection
              id="day-to-day"
              eyebrow="Section three"
              title="What does the day look like?"
              lead="What the work actually looks like, beyond the job description."
              illustration={<SectionIllustration guide={guide} slot="day-to-day" />}
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

            {followUpsFor("day-to-day") && (
              <GoDeeper
                guideId={guide._id}
                sectionId="day-to-day"
                sectionLabel="the day-to-day"
                followUps={followUpsFor("day-to-day")!}
                initialBranches={initialBranches}
              />
            )}

            <ArticleSection
              id="outlook"
              eyebrow="Section four"
              title="What's the career outlook?"
              lead="Where the demand is heading and what the market looks like today."
              meta={
                <RegionPicker
                  view={r}
                  regionKey={r.key}
                  availableRegions={availableRegions}
                />
              }
              illustration={<SectionIllustration guide={guide} slot="outlook" />}
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
                        citations={cite(`regional.${r.key}.careerOutlook`)}
                      />
                    )}
                  </p>
                ))}
              </div>
            </ArticleSection>

            {followUpsFor(`outlook-${r.key}`) && (
              <GoDeeper
                guideId={guide._id}
                sectionId={`outlook-${r.key}`}
                sectionLabel="the outlook"
                followUps={followUpsFor(`outlook-${r.key}`)!}
                initialBranches={initialBranches}
              />
            )}

            <ArticleSection
              id="learning-path"
              eyebrow="Section five"
              title="How do you get there?"
              lead="A practical path from interest to competence, step by step."
              meta={
                <RegionPicker
                  view={r}
                  regionKey={r.key}
                  availableRegions={availableRegions}
                />
              }
              illustration={<SectionIllustration guide={guide} slot="learning-path" />}
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
                          citations={cite(`regional.${r.key}.learningPath`)}
                        />
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            </ArticleSection>

            {followUpsFor(`learning-path-${r.key}`) && (
              <GoDeeper
                guideId={guide._id}
                sectionId={`learning-path-${r.key}`}
                sectionLabel="the learning path"
                followUps={followUpsFor(`learning-path-${r.key}`)!}
                initialBranches={initialBranches}
              />
            )}

            {c.riskFactors.length > 0 && (
              <ArticleSection
                id="considerations"
                eyebrow="Section six"
                title="Worth knowing."
                lead="Honest considerations to weigh before you commit."
                illustration={<SectionIllustration guide={guide} slot="risks" />}
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

            {c.riskFactors.length > 0 && followUpsFor("considerations") && (
              <GoDeeper
                guideId={guide._id}
                sectionId="considerations"
                sectionLabel="what to weigh"
                followUps={followUpsFor("considerations")!}
                initialBranches={initialBranches}
              />
            )}

            <PeopleInFieldSection
              guideId={guide._id}
              guideTitle={guide.title}
            />

            <ArticleSection
              id="related"
              eyebrow="Section eight"
              title="Related roles."
              lead="Other career paths that share common ground with this one."
              meta={
                <RegionPicker
                  view={r}
                  regionKey={r.key}
                  availableRegions={availableRegions}
                />
              }
            >
              <ul className="max-w-2xl space-y-1">
                {r.relatedRoles.map((role) => {
                  const existingSlug =
                    existingByTitle[role.toLowerCase().trim()];
                  return (
                    <li key={role}>
                      <RelatedRoleLink
                        title={role}
                        existingSlug={existingSlug}
                      />
                    </li>
                  );
                })}
              </ul>
            </ArticleSection>
          </div>
        </article>

        {/* Sidebar */}
        <aside className="lg:col-span-3">
          <div className="flex flex-col gap-6 lg:sticky lg:top-12">
            {/* Discrete deep-dive CTA. Anchors at the top of the right column
                on desktop (visually aligns with the article's publish date in
                the article column); flows to the bottom of the page on
                mobile when the aside reflows below the article. The
                byline-inline variant in <Byline> covers above-the-fold
                discoverability on mobile. */}
            <DeepDiveCallTile
              guideId={guide._id}
              guideTitle={guide.title}
              guideSlug={guide.slug}
              region={defaultRegion}
              variant="aside"
            />
            <Sidebar
              slug={guide.slug}
              regionKey={r.key}
              availableRegions={availableRegions}
              currencySymbol={r.currencySymbol}
              salary={r.salary}
              salaryCitations={cite(`regional.${r.key}.salary`)}
              personalizationPending={personalizationPending}
              showInlineCvCta={showInlineCvCta}
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
  publishedAt,
  updatedAt,
  lead,
  deepDiveCta,
}: {
  title: string;
  publishedAt: number;
  updatedAt: number;
  lead?: string;
  /**
   * Optional discrete CTA (e.g. the deep-dive call tile) rendered inline
   * beside the publish date. Mobile-targeted by design — the same feature
   * surfaces in the right aside on desktop.
   */
  deepDiveCta?: React.ReactNode;
}) {
  const formatDate = (ms: number) =>
    new Date(ms).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const publishedFormatted = formatDate(publishedAt);
  const updatedFormatted = formatDate(updatedAt);
  // Only show "Last updated" when meaningfully later than publish (>~1 day),
  // otherwise the two timestamps look redundant on freshly-created guides.
  const showUpdated =
    updatedAt - publishedAt > 24 * 60 * 60 * 1000 &&
    publishedFormatted !== updatedFormatted;
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
      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px] text-mute">
        <span>
          Published{" "}
          <time dateTime={new Date(publishedAt).toISOString()}>
            {publishedFormatted}
          </time>
        </span>
        {showUpdated && (
          <>
            <span aria-hidden className="text-mute/40">
              ·
            </span>
            <span>
              Updated{" "}
              <time dateTime={new Date(updatedAt).toISOString()}>
                {updatedFormatted}
              </time>
            </span>
          </>
        )}
        {deepDiveCta && (
          <>
            <span aria-hidden className="text-mute/40 lg:hidden">
              ·
            </span>
            {deepDiveCta}
          </>
        )}
      </div>
      {lead && (
        <p className="mt-7 max-w-2xl text-balance text-[19px] leading-[1.55] text-ink/70 sm:text-[20px]">
          {lead}
        </p>
      )}
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
  illustration,
  footer,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  meta?: React.ReactNode;
  illustration?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-hairline py-14 first:border-t-0 first:pt-0"
    >
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
      {illustration}
      <div className="mt-6">{children}</div>
      {footer && <div className="mt-12">{footer}</div>}
    </section>
  );
}

type SectionSlot = "day-to-day" | "outlook" | "learning-path" | "risks";

const aOrAn = (word: string): string =>
  /^[aeiou]/i.test(word.trim()) ? "an" : "a";

const pluraliseRole = (title: string): string => {
  const words = title.trim().split(/\s+/);
  if (words.length === 0) return title;
  const last = words[words.length - 1];
  let pluralLast: string;
  if (/[^aeiou]y$/i.test(last)) {
    pluralLast = last.slice(0, -1) + "ies";
  } else if (/(s|x|z|ch|sh)$/i.test(last)) {
    pluralLast = last + "es";
  } else {
    pluralLast = last + "s";
  }
  words[words.length - 1] = pluralLast;
  return words.join(" ");
};

const SLOT_ALT: Record<SectionSlot, (title: string) => string> = {
  "day-to-day": (t) => `Illustration of ${aOrAn(t)} ${t}'s working environment`,
  outlook: (t) =>
    `Illustration of the career outlook for ${pluraliseRole(t)}`,
  "learning-path": (t) =>
    `Illustration of the path to becoming ${aOrAn(t)} ${t}`,
  risks: (t) =>
    `Illustration weighing the trade-offs of being ${aOrAn(t)} ${t}`,
};

function SectionIllustration({
  guide,
  slot,
}: {
  guide: GuideWithUrl;
  slot: SectionSlot;
}) {
  const slotData = guide.slotIllustrations?.[slot];
  if (!slotData) return null;
  const url = guide.slotIllustrationUrls?.[slot];
  if (slotData.status === "generating") {
    return (
      <div className="mt-8 aspect-[16/9] w-full max-w-3xl animate-pulse rounded-card border border-hairline bg-paper-raised" />
    );
  }
  if (slotData.status === "failed" || !url) return null;
  return (
    <motion.figure
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1, ease: [0.2, 0.65, 0.3, 1] }}
      className="mt-8 max-w-3xl overflow-hidden rounded-card border border-hairline"
    >
      <Image
        src={url}
        alt={SLOT_ALT[slot](guide.title)}
        width={1280}
        height={720}
        className="h-auto w-full"
      />
    </motion.figure>
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

type SkillDetail = {
  name: string;
  rationale: string;
  tier: "must" | "nice";
};

function SkillsList({
  detail,
  fallback,
  citations,
}: {
  detail?: SkillDetail[];
  fallback: string[];
  citations?: CitationSource[];
}) {
  const must = (detail ?? []).filter((s) => s.tier === "must");
  const nice = (detail ?? []).filter((s) => s.tier === "nice");
  const hasDetail = must.length > 0 || nice.length > 0;
  const [tab, setTab] = useState<"must" | "nice">("must");

  if (!hasDetail) {
    return (
      <ul className="max-w-2xl space-y-2.5">
        {fallback.map((skill, i, arr) => (
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
              {i === arr.length - 1 && <FieldCitation citations={citations} />}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const tiers = {
    must: {
      label: "Must-haves",
      helper: "Non-negotiable. Employers screen for these.",
      items: must,
    },
    nice: {
      label: "Nice-to-haves",
      helper: "Strong differentiators, not table-stakes.",
      items: nice,
    },
  } as const;

  const tabKeys: Array<"must" | "nice"> = [];
  if (must.length > 0) tabKeys.push("must");
  if (nice.length > 0) tabKeys.push("nice");
  const activeTab = tiers[tab].items.length > 0 ? tab : tabKeys[0];
  const active = tiers[activeTab];

  return (
    <div className="max-w-2xl">
      {tabKeys.length > 1 ? (
        <div
          role="tablist"
          aria-label="Skill tier"
          className="inline-flex w-full items-center gap-0.5 rounded-pill border border-hairline bg-paper p-1"
        >
          {tabKeys.map((key) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(key)}
                className={`type-label flex-1 rounded-pill px-3 py-2 text-center transition-colors ${
                  isActive
                    ? "bg-paper-raised text-ink"
                    : "text-mute hover:text-ink"
                }`}
              >
                {tiers[key].label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className={eyebrowCls}>{active.label}</p>
      )}
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        {active.helper}
      </p>
      <ul className="mt-5 divide-y divide-hairline/70">
        {active.items.map((s, i, arr) => (
          <li key={s.name} className="py-4 first:pt-0 last:pb-0">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[16px] font-medium text-ink">{s.name}</h3>
              {activeTab === "must" && i === arr.length - 1 && (
                <FieldCitation citations={citations} />
              )}
            </div>
            <p className="mt-1.5 text-[15px] leading-[1.6] text-ink/75">
              {s.rationale}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RegionPicker({
  view,
  regionKey,
  availableRegions,
}: {
  view: RegionalView;
  regionKey: RegionKey;
  availableRegions: Array<{ key: RegionKey; shortLabel: string; longLabel: string }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-pill text-[10px] font-medium uppercase tracking-[0.18em] text-mute transition-colors hover:text-ink"
      >
        <MapPin className="h-3 w-3" aria-hidden="true" strokeWidth={1.75} />
        <span>{view.label}</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Switch region"
          className="absolute right-0 top-full z-20 mt-2 min-w-[180px] rounded-card border border-hairline bg-paper-raised p-1 shadow-md"
        >
          {availableRegions.map((opt) => {
            const active = regionKey === opt.key;
            return (
              <Link
                key={opt.key}
                href={`?region=${opt.key}`}
                replace
                scroll={false}
                role="option"
                aria-selected={active}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 rounded-pill px-3 py-2 text-[12px] tracking-tight transition-colors ${
                  active
                    ? "bg-paper text-ink"
                    : "text-mute hover:bg-paper hover:text-ink"
                }`}
              >
                <span className="flex-1 normal-case">{opt.longLabel}</span>
                {active && (
                  <Check
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                    strokeWidth={2}
                  />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Compacts salary strings for display, normalising the currency symbol so
// it always renders consistently before each number:
//   $/USD: "$300,000 to $400,000" -> "$300k to $400k"
//   £/GBP: "£28,000 to £38,000"   -> "£28k to £38k"
//   CA$:   "60,000 to 80,000"     -> "CA$60k to CA$80k"
//   €/EUR: "€55,000+"             -> "€55k+"
//   ¥/JPY: "8,500,000"            -> "¥8.5m"
// Any pre-existing currency glyph in the source string is stripped first so
// we don't double up; the caller-supplied symbol is the source of truth.
function formatSalaryBand(s: string, currencySymbol: string): string {
  return s
    .replace(/[$£€¥₹]|CA\$|A\$|S\$|HK\$|NZ\$/g, "")
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => {
      const n = Number.parseInt(m.replace(/,/g, ""), 10);
      if (!Number.isFinite(n)) return m;
      if (n >= 1_000_000) {
        const v = n / 1_000_000;
        return `${currencySymbol}${v % 1 === 0 ? v : v.toFixed(1)}m`;
      }
      if (n >= 1_000) {
        const v = n / 1_000;
        return `${currencySymbol}${v % 1 === 0 ? v : v.toFixed(1)}k`;
      }
      return `${currencySymbol}${m}`;
    })
    .trim();
}

function Sidebar({
  slug,
  regionKey,
  availableRegions,
  currencySymbol,
  salary,
  salaryCitations,
  personalizationPending,
  showInlineCvCta,
}: {
  slug: string;
  regionKey: RegionKey;
  availableRegions: Array<{ key: RegionKey; shortLabel: string; longLabel: string }>;
  currencySymbol: string;
  salary: Salary;
  salaryCitations?: CitationSource[];
  personalizationPending?: boolean;
  showInlineCvCta: boolean;
}) {
  const bands: Array<[string, string]> = [
    ["Entry", formatSalaryBand(salary.entry, currencySymbol)],
    ["Mid", formatSalaryBand(salary.mid, currencySymbol)],
    ["Senior", formatSalaryBand(salary.senior, currencySymbol)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <FactCheckCard slug={slug} />
      <div className="rounded-card border border-hairline bg-paper-raised p-6">
        <div className="flex items-center justify-between gap-3">
          <p className={eyebrowCls}>Region</p>
          {personalizationPending && (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-mute"
              aria-live="polite"
            >
              <LoopingFeather size={11} className="text-mute" />
              Personalising
            </span>
          )}
        </div>
        <div
          role="group"
          aria-label="Switch region"
          className="mt-3 inline-flex w-full items-center gap-0.5 rounded-pill border border-hairline bg-paper p-1"
        >
          {availableRegions.map((opt) => {
            const active = regionKey === opt.key;
            return (
              <Link
                key={opt.key}
                href={`?region=${opt.key}`}
                replace
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={`type-label flex-1 rounded-pill px-3 py-2 text-center transition-colors ${
                  active
                    ? "bg-paper-raised text-ink"
                    : "text-mute hover:text-ink"
                }`}
              >
                {opt.shortLabel}
              </Link>
            );
          })}
        </div>

        <hr className="my-6 border-hairline" />

        <div className="flex items-center justify-between gap-3">
          <h3 className={eyebrowCls}>Typical earnings</h3>
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

      {showInlineCvCta && (
        <Link
          href="/workspace/profile"
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
      )}
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

function RelatedRoleLink({
  title,
  existingSlug,
}: {
  title: string;
  existingSlug?: string;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);

  const rowCls =
    "group -mx-2 flex w-full items-center justify-between rounded-control border-b border-hairline/70 px-2 py-3 text-left transition-colors last:border-b-0 hover:bg-ink/[0.03] disabled:cursor-not-allowed disabled:opacity-70";

  const inner = (
    <>
      <span className="text-[15px] text-ink/85 transition-colors group-hover:text-ink">
        {title}
      </span>
      {generating ? (
        <Loader2
          className="h-3.5 w-3.5 animate-spin text-mute"
          aria-hidden="true"
          strokeWidth={1.75}
        />
      ) : (
        <ArrowUpRight
          className="h-3.5 w-3.5 text-mute opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (existingSlug) {
    return (
      <Link href={`/career-guides/${existingSlug}`} className={rowCls}>
        {inner}
      </Link>
    );
  }

  const onClick = async () => {
    if (generating || !convexHttpOrigin) return;
    setGenerating(true);
    try {
      const res = await fetch(`${convexHttpOrigin}/career-guides/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = (await res.json().catch(() => null)) as
        | { slug?: string; error?: string }
        | null;
      if (data?.slug) {
        router.push(`/career-guides/${data.slug}`);
        return;
      }
      setGenerating(false);
    } catch {
      setGenerating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={generating}
      className={rowCls}
    >
      {inner}
    </button>
  );
}

function FactCheckCard({ slug }: { slug: string }) {
  const live = useQuery(api.careerGuides.getBySlug, { slug });
  const enrichment = live?.enrichment;
  const triggerRefresh = useMutation(
    api.careerGuides.triggerEnrichmentBySlug,
  );
  const [verbIdx, setVerbIdx] = useState(0);
  const [refreshPending, setRefreshPending] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

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
          <BadgeCheck
            className="h-5 w-5 text-ink"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        </div>
        <p className="mt-2 type-caption text-ink">
          Verified {formatRelative(lastEnrichedAt)}
        </p>
        {(totalSources > 0 || isStale) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {totalSources > 0 && (
              <button
                type="button"
                onClick={() => setSourcesOpen(true)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-hairline-strong bg-paper px-2.5 py-1 text-[11px] font-medium leading-none text-ink transition-all hover:border-ink hover:bg-ink hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <BookOpen
                  className="h-3 w-3"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
                View all {totalSources}{" "}
                {totalSources === 1 ? "source" : "sources"}
              </button>
            )}
            {isStale && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshPending}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-hairline-strong bg-paper px-2.5 py-1 text-[11px] font-medium leading-none text-ink transition-all hover:border-ink hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
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
        )}
        <AllSourcesPanel
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
          citations={live?.citations ?? {}}
        />
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
  const retry = useMutation(api.careerGuides.retryFailedGuide);
  const [pending, setPending] = useState(false);
  const autoFiredRef = useRef(false);

  useEffect(() => {
    if (autoFiredRef.current) return;
    autoFiredRef.current = true;
    void retry({ slug, clientIp: "", force: false }).catch(() => {});
  }, [slug, retry]);

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      await retry({ slug, clientIp: "", force: true });
    } catch {
      // Surface nothing — the parent useQuery will reflect the next state.
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="type-label text-state-error">Generation failed</p>
      <h1 className="type-headline text-ink">{title}</h1>
      <p className="type-body max-w-prose text-body">
        We could not finish this guide. This is usually a temporary model
        hiccup, not something wrong with the title.
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="type-label inline-flex items-center gap-2 self-start rounded-pill bg-ink px-6 py-3 text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Retrying
          </>
        ) : (
          <>
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </>
        )}
      </button>
    </div>
  );
}
