// Standardised loading skeletons for workspace pages. Hairline-divided
// rows mirror the populated row shapes so the page rhythm doesn't shift
// when data lands — only the content fills in. The fade-in-view utility
// (see globals.css) softens the swap; both honour prefers-reduced-motion.
//
// Three shapes covering every workspace surface today:
//   - WorkspaceLoadingHeader  → page-eyebrow + h1 + lede stack
//   - WorkspaceLoadingRows    → list-shape (saved guides, conversations list)
//   - WorkspaceLoadingArticle → detail-shape (conversation detail; future:
//                               career guide article, profile sub-pages)
//
// Every variant lives in one file so the visual language stays in sync.
// Loader2 spinners are reserved for INLINE transient actions (refreshing
// in-flight, archiving) — never for first-render data fetches.

export function WorkspaceLoadingHeader() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="skeleton-block h-3 w-24" />
      <div className="skeleton-block h-9 w-2/3 max-w-md" />
      <div className="skeleton-block h-4 w-3/4 max-w-xl" />
    </div>
  );
}

export function WorkspaceLoadingRow() {
  return (
    <div
      className="flex flex-col gap-3 border-b border-hairline px-2 py-8 sm:px-4 sm:py-10"
      aria-hidden
    >
      <div className="skeleton-block h-6 w-2/3 max-w-md" />
      <div className="skeleton-block h-3 w-32" />
      <div className="skeleton-block h-4 w-1/2 max-w-sm" />
    </div>
  );
}

export function WorkspaceLoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="border-t border-hairline" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <WorkspaceLoadingRow key={i} />
      ))}
    </div>
  );
}

// Article-shape skeleton for detail pages. Mirrors the masthead → score →
// lede → section-stack rhythm so the page doesn't reflow when content
// lands. Honours the same .skeleton-block pulse + fade-in-view utilities
// the list skeletons use.
//
// Optional `withToc` renders the left-rail TOC placeholder used by the
// 12-col career-guide layout (and the conversation detail page).
export function WorkspaceLoadingArticle({
  withToc = true,
}: {
  withToc?: boolean;
}) {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8"
      aria-busy="true"
    >
      {/* Top bar — back link + actions menu placeholders */}
      <div className="mb-6 flex items-center justify-between gap-3 pt-4 sm:pt-6">
        <div className="skeleton-block h-3 w-28" />
        <div className="skeleton-block h-7 w-7 rounded-full" />
      </div>

      <div className="lg:grid lg:grid-cols-12 lg:gap-12">
        {/* Left rail TOC */}
        {withToc && (
          <aside className="hidden lg:col-span-2 lg:block" aria-hidden>
            <div className="flex flex-col gap-2">
              <div className="skeleton-block h-2.5 w-20" />
              <div className="mt-2 flex flex-col gap-2.5">
                <div className="skeleton-block h-3 w-full" />
                <div className="skeleton-block h-3 w-5/6" />
                <div className="skeleton-block h-3 w-4/5" />
                <div className="skeleton-block h-3 w-3/4" />
                <div className="skeleton-block h-3 w-5/6" />
              </div>
            </div>
          </aside>
        )}

        {/* Main reading column */}
        <main className={withToc ? "lg:col-span-8" : "lg:col-span-12"}>
          {/* Masthead: eyebrow → byline → headline → score → lede */}
          <section className="border-b border-hairline pb-12">
            <div className="skeleton-block h-2.5 w-48" aria-hidden />
            <div className="mt-6 flex items-center gap-3" aria-hidden>
              <div className="skeleton-block h-8 w-8 rounded-full" />
              <div className="skeleton-block h-3 w-40" />
            </div>
            <div className="mt-6 flex flex-col gap-3" aria-hidden>
              <div className="skeleton-block h-12 w-full max-w-2xl" />
              <div className="skeleton-block h-12 w-3/4 max-w-xl" />
            </div>
            <div className="mt-7" aria-hidden>
              <div className="skeleton-block h-12 w-32" />
            </div>
            <div className="mt-7 flex flex-col gap-2.5" aria-hidden>
              <div className="skeleton-block h-4 w-full max-w-2xl" />
              <div className="skeleton-block h-4 w-5/6 max-w-2xl" />
            </div>
          </section>

          {/* Section stack — three blocks, each: heading → key/score row → prose */}
          <section className="mt-12" aria-hidden>
            <div className="skeleton-block h-2.5 w-44" />
            <div className="mt-4 flex flex-col">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={
                    i === 0
                      ? "py-6"
                      : "border-t border-hairline py-6"
                  }
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="skeleton-block h-5 w-40" />
                    <div className="skeleton-block h-4 w-12" />
                  </div>
                  <div className="mt-3 skeleton-block h-2.5 w-24" />
                  <div className="mt-1.5 skeleton-block h-3.5 w-full max-w-xl" />
                  <div className="mt-1 skeleton-block h-3.5 w-4/5 max-w-xl" />
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
