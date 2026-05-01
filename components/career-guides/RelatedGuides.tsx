import Link from "next/link";
import Image from "next/image";
import type { RelatedGuide } from "@/convex/careerGuides";

export function RelatedGuides({
  guides,
  sourceTitle,
}: {
  guides: RelatedGuide[];
  sourceTitle: string;
}) {
  if (guides.length === 0) return null;

  return (
    <section
      aria-labelledby="related-guides-heading"
      className="border-t border-hairline bg-paper"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:px-8 lg:py-16">
        <header className="mb-8 max-w-2xl">
          <p className="type-label uppercase text-mute">Keep exploring</p>
          <h2
            id="related-guides-heading"
            className="type-headline mt-2 text-ink"
          >
            Careers similar to {sourceTitle}
          </h2>
        </header>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {guides.map((g) => (
            <li key={g.slug} className="h-full">
              <RelatedGuideCard guide={g} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RelatedGuideCard({ guide }: { guide: RelatedGuide }) {
  return (
    <Link
      href={`/career-guides/${guide.slug}`}
      className="group relative flex aspect-[3/4] flex-col overflow-hidden rounded-surface border border-hairline bg-paper-raised transition-colors hover:border-hairline-strong"
    >
      {guide.illustrationUrl ? (
        <Image
          src={guide.illustrationUrl}
          alt={`Illustration for ${guide.title}`}
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
        <h3 className="type-title text-ink">{guide.title}</h3>
        {guide.overviewSnippet && (
          <p className="type-body line-clamp-3 text-body">
            {guide.overviewSnippet}
          </p>
        )}
      </div>
    </Link>
  );
}
