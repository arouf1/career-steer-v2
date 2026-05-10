// app/jobs/listing/[city]/[company]/[title]/[id]/page.tsx
//
// Public job-detail page. URL shape mirrors V1, keyword-rich slugs in front
// for SEO, opaque [id] at the end as the actual primary key. Slugs are
// derived (not the source of truth) so changes to a posting's normalised
// title/company/city redirect to the canonical URL via permanentRedirect.

import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { JobPostingArticle } from "@/components/jobs/JobPostingArticle";
import { SiteNav } from "@/components/site/SiteNav";
import {
  buildJobPostingJsonLd,
  isUndisclosedEmployer,
} from "@/lib/seo/jobPostingSchema";

type PageProps = {
  params: Promise<{
    city: string;
    company: string;
    title: string;
    id: string;
  }>;
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://career-steer.app";

const VALID_FOR_DAYS = 45; // matches the staleness archive window

const buildCanonicalPath = (
  citySlug: string,
  companySlug: string,
  titleSlug: string,
  id: string,
) => `/jobs/listing/${citySlug}/${companySlug}/${titleSlug}/${id}`;

const smartTruncate = (s: string, max: number): string => {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
};

async function loadPosting(idParam: string) {
  // Convex IDs are opaque strings, bad input lands as a fetch error which
  // we treat as a 404. Avoids leaking validation logic to the client.
  try {
    const result = await fetchQuery(api.jobPostings.getByPublicId, {
      id: idParam as Id<"job_postings">,
    });
    return result;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await loadPosting(id);
  if (!data) return { title: "Job listing", robots: { index: false } };

  const { posting, company } = data;
  const isArchived = posting.isActive === false;
  const undisclosed = isUndisclosedEmployer(company.nameRaw);
  const noindex = isArchived || undisclosed;

  // Pull from rewritten content when ready; fall back to raw fields otherwise.
  const title =
    posting.content?.metaTitle ??
    `${posting.title} at ${company.nameRaw}, ${posting.city}`;
  const description =
    posting.content?.metaDescription ??
    smartTruncate(posting.rawDescription || "", 158);
  const socialAlt = posting.content?.socialAlt ?? title;

  const canonicalPath = buildCanonicalPath(
    posting.citySlug,
    company.slug,
    posting.titleSlug,
    posting._id,
  );

  const ogImages = data.illustrationUrl
    ? [
        {
          url: data.illustrationUrl,
          width: 1280,
          height: 720,
          alt: socialAlt,
        },
      ]
    : undefined;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    openGraph: {
      type: "article",
      url: canonicalPath,
      title,
      description,
      siteName: "Career Steer",
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: data.illustrationUrl ? [data.illustrationUrl] : undefined,
    },
  };
}

export default async function JobPostingPage({ params }: PageProps) {
  const p = await params;
  const data = await loadPosting(p.id);
  if (!data) notFound();

  const { posting, company, relatedGuide, illustrationUrl } = data;

  // Sub-project 4: lazy hero image. The mutation is idempotent, fires only
  // when illustrationStatus is undefined. We `void` (don't await) so the
  // first viewer doesn't block on a 30s+ Gemini call; they get the gradient
  // placeholder, the next visitor gets the real image.
  if (posting.illustrationStatus === undefined && posting.isActive) {
    void fetchMutation(api.jobPostingsImage.ensureHeroQueued, {
      jobPostingId: posting._id,
    });
  }

  // Sub-project 5: lazy company research. Idempotent. Same fire-and-forget
  // pattern, research lands within ~30-60s on the next view.
  if (posting.isActive) {
    void fetchMutation(api.companyResearch.ensureResearchQueued, {
      companyId: company._id,
      roleArchetypeSlug: posting.roleArchetypeSlug ?? null,
    });
    // First-view archetype resolution. Postings whose title hasn't been LLM-
    // canonicalized yet have `roleArchetypeSlug: null`, which the call above
    // silently treats as "no role overlay needed." That left the Interview
    // process / Compensation insights cards spinning "Researching…" forever.
    // ensureArchetypeResolved fires the LLM canonicalize → guide-lookup chain
    // and stamps `roleArchetypeResolvedAt` either way; on the next view the
    // role research will be queued (if a guide matched) or the cards will
    // hide themselves (if no guide exists for the canonical title).
    if (
      posting.roleArchetypeSlug == null &&
      posting.roleArchetypeResolvedAt == null
    ) {
      void fetchMutation(api.jobPostings.ensureArchetypeResolved, {
        jobPostingId: posting._id,
      });
    }
  }

  // Related jobs via vector search on the wholeVector. Returns [] when the
  // posting hasn't been embedded yet (first paint after content lands; the
  // embedding fires immediately after but races this read). Empty list just
  // hides the section.
  const relatedJobs = posting.contentStatus === "complete"
    ? await fetchAction(api.jobPostingEmbeddings.relatedByPostingId, {
        jobPostingId: posting._id,
        limit: 4,
      })
    : [];

  // Canonical-URL redirect. If any of the three slug params don't match the
  // posting's stored slugs (e.g. a stale share link from before a slug
  // change, or a hand-crafted URL), 308-redirect to the canonical URL.
  const canonicalPath = buildCanonicalPath(
    posting.citySlug,
    company.slug,
    posting.titleSlug,
    posting._id,
  );
  if (
    p.city !== posting.citySlug ||
    p.company !== company.slug ||
    p.title !== posting.titleSlug
  ) {
    permanentRedirect(canonicalPath);
  }

  const isArchived = posting.isActive === false;
  const undisclosed = isUndisclosedEmployer(company.nameRaw);
  const emitJsonLd = !isArchived && !undisclosed;

  return (
    <>
      {emitJsonLd && (
        <script
          type="application/ld+json"
          // Rendering as a string is the canonical SSR pattern for JSON-LD
          // and bypasses React's dangerouslySetInnerHTML noise. The object
          // is server-built so there's no XSS surface.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(
              buildJobPostingJsonLd({
                jobId: posting._id,
                title: posting.title,
                companyName: company.nameRaw,
                companyLogoUrl: company.logoUrl ?? null,
                companyHomepageUrl: company.domain
                  ? `https://${company.domain}`
                  : null,
                location: posting.location,
                description:
                  posting.content?.overview ?? posting.rawDescription,
                schedule: posting.detectedExtensions?.schedule ?? null,
                salary: posting.detectedExtensions?.salary ?? null,
                workFromHome:
                  posting.detectedExtensions?.workFromHome ?? null,
                experienceLevel: null,
                industry: null,
                firstSeenAt: posting.firstSeenAt,
                canonicalUrl: `${SITE_URL}${canonicalPath}`,
                validForDays: VALID_FOR_DAYS,
              }),
            ),
          }}
        />
      )}
      <main className="flex flex-1 flex-col bg-paper">
        <SiteNav />
        <JobPostingArticle
          posting={posting}
          company={{
            nameRaw: company.nameRaw,
            slug: company.slug,
            domain: company.domain,
            logoUrl: company.logoUrl,
          }}
          relatedGuide={
            relatedGuide
              ? {
                  slug: relatedGuide.slug,
                  title: relatedGuide.title,
                }
              : null
          }
          illustrationUrl={illustrationUrl}
          companyResearch={data.companyResearch}
          companyRoleResearch={data.companyRoleResearch}
          relatedJobs={relatedJobs}
        />
      </main>
    </>
  );
}
