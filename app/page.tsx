import Link from "next/link";
import { ArrowRight, FileText, IdCard, UploadCloud } from "lucide-react";
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
              <header className="mb-10 flex items-end justify-between gap-4">
                <h2 className="type-headline text-ink">Recently written</h2>
                <Link
                  href="/career-guides"
                  className="type-label inline-flex items-center gap-2 text-ink-soft transition-colors hover:text-ink"
                >
                  See all
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </header>
              <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {recent.map((g) => (
                  <li key={g._id}>
                    <CareerGuideCard guide={g} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="grid gap-12 md:grid-cols-2 md:gap-16">
            <div className="flex flex-col gap-6">
              <p className="type-label text-mute">Or, make it personal</p>
              <h2 className="type-headline text-ink">
                Where could{" "}
                <span className="text-ink-soft">your</span> career take you?
              </h2>
              <p className="type-body-lg text-body max-w-prose">
                Generic guides only go so far. Upload your CV and we will map
                paths that match your real experience and ambitions.
              </p>
              <Link
                href="/profile"
                className="type-label inline-flex items-center gap-2 self-start text-ink transition-colors hover:text-ink-deep"
              >
                Build my path
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div>
              <UploadPreview />
            </div>
          </div>
        </section>

        <SearchActionJsonLd />
      </main>
    </>
  );
}

function UploadPreview() {
  return (
    <article className="w-full rounded-card border border-hairline bg-paper-raised p-6 sm:p-8">
      <div className="mb-8 inline-flex w-full items-center gap-1 rounded-pill border border-hairline bg-paper p-1">
        <span className="type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill bg-paper-raised px-4 py-2.5 text-ink">
          <FileText className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          Upload CV
        </span>
        <span className="type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill px-4 py-2.5 text-mute">
          <IdCard className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          LinkedIn
        </span>
      </div>

      <div className="rounded-card border border-dashed border-hairline-strong bg-paper px-6 py-12 text-center">
        <UploadCloud
          className="mx-auto mb-4 h-8 w-8 text-mute"
          aria-hidden="true"
          strokeWidth={1.25}
        />
        <h3 className="type-title text-ink">
          CV or career profile screenshots
        </h3>
        <p className="type-body mt-2 text-body max-w-sm mx-auto">
          Drop your CV here and we&rsquo;ll explore what&rsquo;s possible.
        </p>
        <p className="type-caption mt-6 text-mute">Supports PDF and DOCX.</p>
      </div>
    </article>
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
