import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { SiteNav } from "@/components/site/SiteNav";
import {
  CareerGuideArticle,
  CareerGuidePending,
  type Region,
} from "@/components/career-guides/CareerGuideArticle";

export const revalidate = 300;

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ region?: string }>;
};

const resolveRegion = async (
  searchParamRegion: string | undefined,
): Promise<Region> => {
  if (searchParamRegion === "uk") return "uk";
  if (searchParamRegion === "us") return "us";
  const h = await headers();
  const country = h.get("x-vercel-ip-country")?.toLowerCase();
  if (country === "gb" || country === "uk") return "uk";
  return "us";
};

// Truncate at the last full word inside `max` chars and append an ellipsis.
// Used as a fallback when content.meta.description hasn't been generated.
const smartTruncate = (s: string, max: number): string => {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = await fetchQuery(api.careerGuides.getBySlug, { slug });
  if (!guide) return { title: "Career guide", robots: { index: false } };
  if (guide.contentStatus !== "complete" || !guide.content) {
    return {
      title: `${guide.title} — career guide`,
      robots: { index: false },
    };
  }

  const url = `/career-guides/${guide.slug}`;
  const m = guide.content.meta;
  const title =
    m?.title ?? `${guide.title} career: salary, skills, how to start`;
  const description =
    m?.description ?? smartTruncate(guide.content.overview, 158);
  const keywords = m?.keywords ?? [
    ...guide.content.typicalSkills.slice(0, 8),
    ...guide.content.regional.us.relatedRoles.slice(0, 4),
  ];
  const socialAlt = m?.socialAlt ?? `${guide.title} career guide`;
  const ogImages = guide.illustrationUrl
    ? [{ url: guide.illustrationUrl, width: 1280, height: 720, alt: socialAlt }]
    : undefined;
  const twitterImages = guide.illustrationUrl
    ? [guide.illustrationUrl]
    : undefined;

  return {
    title,
    description,
    keywords,
    authors: [{ name: "Career Steer Editorial" }],
    category: "Career guides",
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      url,
      title,
      description,
      siteName: "Career Steer",
      images: ogImages,
      publishedTime: new Date(guide.createdAt).toISOString(),
      modifiedTime: new Date(guide.updatedAt).toISOString(),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: twitterImages,
    },
  };
}

export default async function CareerGuidePage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const [guide, allGuides] = await Promise.all([
    fetchQuery(api.careerGuides.getBySlug, { slug }),
    fetchQuery(api.careerGuides.listAll, {}),
  ]);
  if (!guide) notFound();

  // Pre-fetch Go Deeper branches server-side so completed Q&A renders into
  // the SSR'd HTML for crawlers and AI engines. Branches still subscribe
  // reactively on the client; this just seeds the initial paint.
  const initialBranches = await fetchQuery(api.guideBranches.listForGuide, {
    guideId: guide._id,
  });

  const region = await resolveRegion(sp.region);
  const existingByTitle: Record<string, string> = Object.fromEntries(
    allGuides.map((g) => [g.title.toLowerCase().trim(), g.slug]),
  );

  return (
    <>
      <SiteNav />
      <main className="flex flex-1 flex-col">
        {guide.contentStatus === "complete" && guide.content ? (
          <>
            <CareerGuideArticle
              guide={guide}
              defaultRegion={region}
              existingByTitle={existingByTitle}
              initialBranches={initialBranches}
            />
            <ArticleJsonLd
              guide={guide}
              region={region}
              branches={initialBranches}
            />
          </>
        ) : (
          <CareerGuidePending slug={slug} title={guide.title} />
        )}
      </main>
    </>
  );
}

type CitationLike = {
  url: string;
  title: string;
  publisher?: string;
};

function uniqueCitations(
  byField: Record<string, CitationLike[]> | undefined,
  limit = 25,
): CitationLike[] {
  if (!byField) return [];
  const seen = new Map<string, CitationLike>();
  for (const list of Object.values(byField)) {
    for (const c of list) {
      if (!c?.url) continue;
      if (!seen.has(c.url)) seen.set(c.url, c);
      if (seen.size >= limit) return Array.from(seen.values());
    }
  }
  return Array.from(seen.values());
}

const wordCount = (s: string) =>
  s.trim().split(/\s+/).filter(Boolean).length;

function ArticleJsonLd({
  guide,
  region,
  branches,
}: {
  guide: NonNullable<Awaited<ReturnType<typeof fetchQuery<typeof api.careerGuides.getBySlug>>>>;
  region: Region;
  branches: Awaited<
    ReturnType<typeof fetchQuery<typeof api.guideBranches.listForGuide>>
  >;
}) {
  if (!guide.content) return null;
  const c = guide.content;
  const r = c.regional[region];
  const url = `/career-guides/${guide.slug}`;

  const citations = uniqueCitations(guide.citations).map((c) => ({
    "@type": "CreativeWork" as const,
    url: c.url,
    name: c.title,
    ...(c.publisher?.trim()
      ? { publisher: { "@type": "Organization" as const, name: c.publisher.trim() } }
      : {}),
  }));

  const totalWordCount =
    wordCount(c.overview) +
    wordCount(c.dayToDay) +
    wordCount(c.whyConsider) +
    wordCount(r.careerOutlook) +
    c.typicalSkills.reduce((acc, s) => acc + wordCount(s), 0) +
    c.riskFactors.reduce((acc, s) => acc + wordCount(s), 0) +
    r.learningPath.reduce((acc, s) => acc + wordCount(s), 0);

  const image = guide.illustrationUrl
    ? {
        "@type": "ImageObject" as const,
        url: guide.illustrationUrl,
        width: 1280,
        height: 720,
      }
    : undefined;

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${guide.title} — career guide`,
    description: c.overview.slice(0, 200),
    inLanguage: "en-GB",
    articleSection: "Career guides",
    wordCount: totalWordCount,
    ...(image ? { image } : {}),
    datePublished: new Date(guide.createdAt).toISOString(),
    dateModified: new Date(guide.updatedAt).toISOString(),
    author: { "@type": "Organization", name: "Career Steer" },
    mainEntityOfPage: url,
    ...(citations.length > 0 ? { citation: citations } : {}),
  };

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "/" },
      {
        "@type": "ListItem",
        position: 2,
        name: "Career guides",
        item: "/career-guides",
      },
      { "@type": "ListItem", position: 3, name: guide.title, item: url },
    ],
  };

  const occupation = {
    "@context": "https://schema.org",
    "@type": "Occupation",
    name: guide.title,
    description: c.overview,
    skills: c.typicalSkills.join(", "),
    estimatedSalary: `Entry ${r.salary.entry}; Mid ${r.salary.mid}; Senior ${r.salary.senior}`,
    occupationLocation: {
      "@type": "Country",
      name: region === "us" ? "United States" : "United Kingdom",
    },
  };

  // FAQPage built from completed Go Deeper branches. Only emit when we have
  // at least one Q&A actually rendered into the page; otherwise the schema
  // would describe content not present in the HTML.
  const faqEntries = branches
    .filter(
      (b): b is typeof b & { answer: { title: string; body: string } } =>
        b.status === "complete" && !!b.answer && !!b.answer.body,
    )
    .map((b) => ({
      "@type": "Question" as const,
      name: b.question,
      acceptedAnswer: {
        "@type": "Answer" as const,
        text: b.answer.body,
      },
    }));

  const faq =
    faqEntries.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqEntries,
        }
      : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(article) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(occupation) }}
      />
      {faq && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
        />
      )}
    </>
  );
}
