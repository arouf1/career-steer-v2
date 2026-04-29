import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { GuideWithUrl } from "@/convex/careerGuides";

export function CareerGuideCard({ guide }: { guide: GuideWithUrl }) {
  const overview = guide.content?.overview ?? "";
  const snippet =
    overview.length > 140 ? `${overview.slice(0, 140)}…` : overview;

  return (
    <Link
      href={`/career-guides/${guide.slug}`}
      className="group flex flex-col overflow-hidden rounded-card border border-hairline bg-paper-raised transition-colors hover:border-hairline-strong"
    >
      <div className="aspect-[16/9] w-full overflow-hidden bg-paper">
        {guide.illustrationUrl ? (
          <Image
            src={guide.illustrationUrl}
            alt={`Illustration for ${guide.title}`}
            width={640}
            height={360}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="h-full w-full bg-paper-raised" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <p className="type-label text-mute">Career guide</p>
        <h3 className="type-title text-ink">{guide.title}</h3>
        {snippet && <p className="type-caption text-body">{snippet}</p>}
        <span className="type-label mt-auto inline-flex items-center gap-1.5 text-ink-soft transition-colors group-hover:text-ink">
          Read guide
          <ArrowUpRight
            className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </div>
    </Link>
  );
}
