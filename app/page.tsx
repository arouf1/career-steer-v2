import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { SiteNav } from "@/components/site/SiteNav";
import { CareerGuideSearchHero } from "@/components/career-guides/CareerGuideSearchHero";
import { CareerGuideCard } from "@/components/career-guides/CareerGuideCard";

export const revalidate = 60;

export default async function Home() {
  const recent = await fetchQuery(api.careerGuides.listRecent, { limit: 9 });

  return (
    <>
      <SiteNav />
      <main className="flex flex-1 flex-col">
        <CareerGuideSearchHero />

        {recent.length > 0 && (
          <section className="border-b border-hairline">
            <div className="mx-auto w-full max-w-6xl px-6 py-20">
              <header className="mb-10 flex items-baseline justify-between gap-4 border-b border-hairline pb-6">
                <h2 className="type-headline text-ink">Recently written</h2>
                <Link
                  href="/career-guides"
                  className="type-label inline-flex items-center gap-2 text-ink-soft transition-colors hover:text-ink"
                >
                  See all
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </header>
              <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {recent[0] && (
                  <li className="lg:col-span-2 lg:row-span-2">
                    <CareerGuideCard guide={recent[0]} variant="lead" />
                  </li>
                )}
                {recent.slice(1, 3).map((g) => (
                  <li key={g._id}>
                    <CareerGuideCard guide={g} variant="medium" />
                  </li>
                ))}
                {recent.slice(3).map((g) => (
                  <li key={g._id}>
                    <CareerGuideCard guide={g} variant="small" />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <SearchActionJsonLd />
      </main>
    </>
  );
}

function SearchActionJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Career Steer",
    potentialAction: {
      "@type": "SearchAction",
      target: "/career-guides/{search_term_string}",
      "query-input": "required name=search_term_string",
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
