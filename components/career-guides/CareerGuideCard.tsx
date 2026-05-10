import Link from "next/link";
import Image from "next/image";
import type { GuideWithUrl } from "@/convex/careerGuides";
import { tierChip, type Tier } from "@/lib/tier-display";

type Variant = "lead" | "medium" | "small";

export function CareerGuideCard({
  guide,
  variant = "small",
  tier,
}: {
  guide: GuideWithUrl;
  variant?: Variant;
  // Optional tier chip shown in the top-right of the illustration. Only
  // rendered when a tier is provided, leaves legacy callers untouched.
  tier?: Tier;
}) {
  const isLead = variant === "lead";
  const dek = guide.content?.overview ?? "";
  const dateline = formatDateline(guide._creationTime);

  return (
    <Link
      href={`/career-guides/${guide.slug}`}
      className={`group relative flex flex-col overflow-hidden rounded-surface border border-hairline bg-paper-raised transition-colors hover:border-hairline-strong${
        isLead ? " aspect-[3/4] lg:aspect-auto lg:h-full" : " aspect-[3/4]"
      }`}
    >
      {guide.illustrationUrl ? (
        <Image
          src={guide.illustrationUrl}
          alt={`Illustration for ${guide.title}`}
          fill
          sizes={
            isLead
              ? "(min-width: 1024px) 50vw, (min-width: 768px) 100vw, 100vw"
              : "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
          }
          className="object-cover"
          priority={isLead}
        />
      ) : (
        <div className="absolute inset-0 bg-paper" aria-hidden />
      )}

      {tier && (
        <span
          aria-label={`Tier: ${tierChip(tier).toLowerCase()}`}
          className="absolute right-3 top-3 z-10 rounded-pill bg-paper/85 px-2 py-0.5 text-[10px] font-medium tracking-[0.12em] text-mute"
        >
          {tierChip(tier)}
        </span>
      )}

      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-paper-raised via-paper-raised to-transparent"
      />

      <div
        className={`relative z-10 mt-auto flex flex-col gap-2 px-6 pb-6${
          isLead ? " lg:gap-3 lg:px-8 lg:pb-8" : ""
        }`}
      >
        <h3
          className={`type-title text-ink${
            isLead ? " lg:text-2xl lg:leading-tight lg:tracking-tight" : ""
          }`}
        >
          {guide.title}
        </h3>
        {dek && <p className="type-body line-clamp-2 text-body">{dek}</p>}
        <p className="type-caption text-mute">{dateline}</p>
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
