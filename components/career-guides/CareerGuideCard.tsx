import Link from "next/link";
import Image from "next/image";
import type { GuideWithUrl } from "@/convex/careerGuides";

type Variant = "lead" | "medium" | "small";

export function CareerGuideCard({
  guide,
  variant = "small",
}: {
  guide: GuideWithUrl;
  variant?: Variant;
}) {
  const isLead = variant === "lead";
  const dek = guide.content?.overview ?? "";
  const dateline = formatDateline(guide._creationTime);

  return (
    <Link
      href={`/career-guides/${guide.slug}`}
      className={`group h-full overflow-hidden rounded-card border border-hairline bg-paper-raised transition-colors hover:border-hairline-strong flex flex-col${
        isLead ? " lg:grid lg:grid-rows-[1fr_auto]" : ""
      }`}
    >
      <div
        className={`aspect-[16/9] w-full overflow-hidden bg-paper${
          isLead ? " lg:aspect-auto lg:min-h-0" : ""
        }`}
      >
        {guide.illustrationUrl ? (
          <Image
            src={guide.illustrationUrl}
            alt={`Illustration for ${guide.title}`}
            width={isLead ? 960 : 640}
            height={isLead ? 540 : 360}
            className="h-full w-full object-cover"
            priority={isLead}
          />
        ) : (
          <div className="h-full w-full bg-paper-raised" />
        )}
      </div>
      <div
        className={`flex flex-1 flex-col gap-3 p-6${
          isLead ? " lg:flex-none lg:gap-4 lg:p-8" : ""
        }`}
      >
        <h3
          className={`type-title text-ink${
            isLead ? " lg:text-2xl lg:leading-tight lg:tracking-tight" : ""
          }`}
        >
          {guide.title}
        </h3>
        {dek && <p className="type-body text-body line-clamp-2">{dek}</p>}
        <p className="type-caption mt-auto text-mute">{dateline}</p>
      </div>
    </Link>
  );
}

function formatDateline(timestamp: number, now = Date.now()): string {
  const diffDays = Math.floor((now - timestamp) / 86_400_000);
  if (diffDays < 1) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}
