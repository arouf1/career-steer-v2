import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { SiteNav } from "@/components/site/SiteNav";
import { CareerGuidesIndexClient } from "@/components/career-guides/CareerGuidesIndexClient";

export const revalidate = 60;

const description =
  "Honest, in-depth guides to real career paths — what the work involves, the skills that matter, realistic salary ranges, and how to get started.";

export const metadata: Metadata = {
  title: "Career guides",
  description,
  alternates: { canonical: "/career-guides" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/career-guides",
    title: "Career guides · Career Steer",
    description,
    siteName: "Career Steer",
  },
  twitter: {
    card: "summary_large_image",
    title: "Career guides · Career Steer",
    description,
  },
};

export default async function CareerGuidesIndexPage() {
  const guides = await fetchQuery(api.careerGuides.listAll, {});

  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-4xl px-6 pb-24 pt-12 sm:px-10 sm:pt-20">
        <header className="space-y-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
            Career guides
          </p>
          <h1 className="type-display text-balance text-ink">
            Career path guides.
          </h1>
          <p className="max-w-xl text-balance text-[15px] leading-relaxed text-body">
            Honest, in-depth guides to real career paths — what the work
            involves, the skills that matter, realistic salary ranges, and how
            to get started.
          </p>
        </header>

        <div className="mt-12 space-y-12 sm:mt-16 sm:space-y-16">
          <CareerGuidesIndexClient guides={guides} />
        </div>

        <IndexJsonLd guides={guides} />
      </main>
    </>
  );
}

function IndexJsonLd({
  guides,
}: {
  guides: Awaited<ReturnType<typeof fetchQuery<typeof api.careerGuides.listAll>>>;
}) {
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: guides.map((g, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: g.title,
      url: `/career-guides/${g.slug}`,
    })),
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
    ],
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
    </>
  );
}
