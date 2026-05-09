import type { ReactNode } from "react";

// Standard header for every workspace page. Editorial section-opener tier
// (DESIGN.md: type-headline, 1.875–2.5rem) — not type-display, which is
// hero-only and one-per-page-max. Workspace pages are working surfaces;
// the headline stays calm so content lands above the fold.
//
// Vocabulary: eyebrow + title (with optional two-tone soft span via children)
// + lede + optional right-rail actions. Use this on every workspace page so
// the chrome reads as one product, not five separately-built screens.
export function WorkspacePageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  // flex-wrap on the row so wide action buttons drop below the title block
  // rather than overflow past the viewport edge (WorkspaceMain has
  // overflow-hidden, so anything that sticks out gets clipped).
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-8 sm:gap-y-4">
      <div className="flex max-w-2xl flex-col gap-3">
        {eyebrow && (
          <span className="type-label uppercase text-mute">{eyebrow}</span>
        )}
        <h1 className="type-headline text-balance text-ink [font-size:clamp(1.875rem,3vw,2.25rem)]">
          {title}
        </h1>
        {lede && (
          <p className="text-balance text-[15px] leading-relaxed text-ink/60">
            {lede}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
