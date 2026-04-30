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
  return {
    title: `${guide.title} — career guide`,
    description: guide.content.overview.slice(0, 160),
    openGraph: {
      title: `${guide.title} — career guide`,
      description: guide.content.overview.slice(0, 160),
      images: guide.illustrationUrl ? [guide.illustrationUrl] : undefined,
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
            />
            <ArticleJsonLd guide={guide} region={region} />
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

function ArticleJsonLd({
  guide,
  region,
}: {
  guide: NonNullable<Awaited<ReturnType<typeof fetchQuery<typeof api.careerGuides.getBySlug>>>>;
  region: Region;
}) {
  if (!guide.content) return null;
  const r = guide.content.regional[region];
  const url = `/career-guides/${guide.slug}`;

  const citations = uniqueCitations(guide.citations).map((c) => ({
    "@type": "CreativeWork" as const,
    url: c.url,
    name: c.title,
    ...(c.publisher?.trim()
      ? { publisher: { "@type": "Organization" as const, name: c.publisher.trim() } }
      : {}),
  }));

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${guide.title} — career guide`,
    description: guide.content.overview.slice(0, 200),
    image: guide.illustrationUrl ?? undefined,
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
    description: guide.content.overview,
    skills: guide.content.typicalSkills.join(", "),
    estimatedSalary: `Entry ${r.salary.entry}; Mid ${r.salary.mid}; Senior ${r.salary.senior}`,
    occupationLocation: {
      "@type": "Country",
      name: region === "us" ? "United States" : "United Kingdom",
    },
  };

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
    </>
  );
}
