import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { tierPeerDescriptor, type Tier } from "@/lib/tier-display";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

type RungSnapshot = {
  rung: number;
  tier: Tier;
  guides: { slug: string; title: string }[];
};

export type LadderContext = {
  primary: {
    ladderSlug: string;
    ladderName: string;
    ladderFamily: string;
    ladderDescription: string;
    currentRung: number;
    currentTier: Tier;
    rungs: RungSnapshot[];
  };
  secondary: {
    ladderSlug: string;
    ladderName: string;
    ladderFamily: string;
    ladderDescription: string;
    currentRung: number;
    currentTier: Tier;
    rungs: RungSnapshot[];
  } | null;
  earlier: { slug: string; title: string; tier: Tier } | null;
  next: { slug: string; title: string; tier: Tier } | null;
  peers: { slug: string; title: string }[];
};

// ── Inline subsections (rendered inside the article's Related roles section)

/**
 * Renders the ladder-neighbour pair (Earlier / Next) and the same-tier
 * peers list as labelled subsections, without any outer page-grid
 * container. Designed to be folded into `CareerGuideArticle`'s Section 8
 * so all three "where to go next" treatments live under one heading and
 * share the article column width. The standalone-footer use case calls
 * this from `CareerGuideLadderFooter` below.
 */
export function RelatedRolesLadderSubsections({
  ctx,
}: {
  ctx: LadderContext;
}) {
  const hasEarlier = ctx.earlier !== null;
  const hasNext = ctx.next !== null;
  const hasPeers = ctx.peers.length > 0;

  if (!hasEarlier && !hasNext && !hasPeers) return null;

  const onlyOneFooterCard =
    (hasEarlier && !hasNext) || (!hasEarlier && hasNext);

  return (
    <div className="space-y-12">
      {(hasEarlier || hasNext) && (
        <div>
          <p className={eyebrowCls}>
            On the {ctx.primary.ladderName} ladder
          </p>
          <div
            className={`mt-5 grid gap-4 ${
              onlyOneFooterCard ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
            }`}
          >
            {hasEarlier && ctx.earlier && (
              <FooterCard eyebrow="Earlier chapter" target={ctx.earlier} />
            )}
            {hasNext && ctx.next && (
              <FooterCard eyebrow="Next step" target={ctx.next} />
            )}
          </div>
        </div>
      )}

      {hasPeers && (
        <div>
          <p className={eyebrowCls}>Same altitude, different paths</p>
          <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-mute">
            {tierPeerDescriptor(ctx.primary.currentTier)}.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed">
            {ctx.peers.map((peer, i) => (
              <span key={peer.slug}>
                {i > 0 && (
                  <span className="mx-2 text-hairline-strong">·</span>
                )}
                <Link
                  href={`/career-guides/${peer.slug}`}
                  className="text-body underline-offset-4 transition-colors hover:text-ink hover:underline"
                >
                  {peer.title}
                </Link>
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Standalone footer (kept for callers that still render this on its own)

/**
 * Page-width footer wrapper around `RelatedRolesLadderSubsections`. Kept
 * for backwards compatibility with any caller that renders this outside
 * the article column. The article itself now folds the subsections
 * inline so the three related-roles treatments stay in one section.
 */
export function CareerGuideLadderFooter({
  ctx,
}: {
  ctx: LadderContext;
}) {
  const hasEarlier = ctx.earlier !== null;
  const hasNext = ctx.next !== null;
  const hasPeers = ctx.peers.length > 0;

  if (!hasEarlier && !hasNext && !hasPeers) return null;

  return (
    <section
      aria-label="Continue exploring this ladder"
      className="mx-auto w-full max-w-7xl px-6 pb-24 sm:px-10"
    >
      <div className="grid grid-cols-1 gap-y-12 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-2" aria-hidden />
        <div className="lg:col-span-9">
          <RelatedRolesLadderSubsections ctx={ctx} />
        </div>
      </div>
    </section>
  );
}

function FooterCard({
  eyebrow,
  target,
}: {
  eyebrow: string;
  target: { slug: string; title: string };
}) {
  return (
    <Link
      href={`/career-guides/${target.slug}`}
      className="group block rounded-card border border-hairline bg-paper-raised px-7 py-6 transition-colors hover:border-hairline-strong"
    >
      <p className={eyebrowCls}>{eyebrow}</p>
      <h3 className="type-title mt-3 text-balance text-ink">{target.title}</h3>
      <p className="mt-4 inline-flex items-center gap-2 text-[13px] font-medium text-mute transition-colors group-hover:text-ink">
        Read
        <ArrowRight
          className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
          aria-hidden
        />
      </p>
    </Link>
  );
}
