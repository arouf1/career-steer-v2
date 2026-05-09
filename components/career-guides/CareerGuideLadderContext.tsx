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

// ── Breadcrumb ─────────────────────────────────────────────────────────────

// Renders the full rung sequence above the article. Current rung in ink +
// medium weight; siblings in ink-soft + regular. Each non-current rung
// links to the corresponding guide. If a guide has TWO ladder positions
// (cross-cutting like Engineering Manager), both ladders are shown stacked.
export function CareerGuideLadderBreadcrumb({
  ctx,
  currentSlug,
}: {
  ctx: LadderContext;
  currentSlug: string;
}) {
  const ladders = [ctx.primary, ...(ctx.secondary ? [ctx.secondary] : [])];

  return (
    <nav
      aria-label="Career ladder progression"
      className="mx-auto w-full max-w-7xl px-6 pt-12 sm:px-10"
    >
      <div className="grid grid-cols-1 gap-y-3 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-2" aria-hidden />
        <div className="lg:col-span-7 space-y-5">
          {ladders.map((ladder) => (
            <BreadcrumbRow
              key={ladder.ladderSlug}
              ladder={ladder}
              currentSlug={currentSlug}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

function BreadcrumbRow({
  ladder,
  currentSlug,
}: {
  ladder: LadderContext["primary"];
  currentSlug: string;
}) {
  // Flatten all rungs into a single ordered sequence of guides for the
  // "·"-separated row. Each rung may have 1+ guides; we show every guide
  // so the reader sees the full landscape, not just one example per rung.
  const items: { slug: string; title: string; isCurrent: boolean }[] = [];
  for (const r of ladder.rungs) {
    for (const g of r.guides) {
      items.push({
        slug: g.slug,
        title: g.title,
        isCurrent: g.slug === currentSlug,
      });
    }
  }

  return (
    <div>
      <p className={eyebrowCls}>
        {ladder.ladderName} ladder
      </p>
      <p className="mt-2 text-[15px] leading-relaxed">
        {items.map((item, i) => (
          <span key={item.slug}>
            {i > 0 && <span className="mx-2 text-hairline-strong">·</span>}
            {item.isCurrent ? (
              <span className="font-medium text-ink">{item.title}</span>
            ) : (
              <Link
                href={`/career-guides/${item.slug}`}
                className="text-mute underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                {item.title}
              </Link>
            )}
          </span>
        ))}
      </p>
    </div>
  );
}

// ── Footer pair: What's next / Earlier chapter ────────────────────────────

export function CareerGuideLadderFooter({
  ctx,
}: {
  ctx: LadderContext;
}) {
  const hasEarlier = ctx.earlier !== null;
  const hasNext = ctx.next !== null;
  const hasPeers = ctx.peers.length > 0;

  if (!hasEarlier && !hasNext && !hasPeers) return null;

  // Single-card layout when only one direction exists (top or bottom of
  // ladder). Side-by-side otherwise. On mobile both stack to full-width.
  const onlyOneFooterCard = (hasEarlier && !hasNext) || (!hasEarlier && hasNext);

  return (
    <section
      aria-label="Continue exploring this ladder"
      className="mx-auto w-full max-w-7xl px-6 pb-24 sm:px-10"
    >
      <div className="grid grid-cols-1 gap-y-12 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-2" aria-hidden />
        <div className="lg:col-span-9 space-y-12">
          {(hasEarlier || hasNext) && (
            <div>
              <p className={eyebrowCls}>
                On the {ctx.primary.ladderName} ladder
              </p>
              <div
                className={`mt-5 grid gap-4 ${
                  onlyOneFooterCard
                    ? "grid-cols-1"
                    : "grid-cols-1 sm:grid-cols-2"
                }`}
              >
                {hasEarlier && ctx.earlier && (
                  <FooterCard
                    eyebrow="Earlier chapter"
                    target={ctx.earlier}
                  />
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
