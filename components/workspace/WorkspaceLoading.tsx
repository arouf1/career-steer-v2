// Standardised loading skeletons for workspace pages. Hairline-divided
// rows mirror the populated row shapes so the page rhythm doesn't shift
// when data lands — only the content fills in. The fade-in-view utility
// (see globals.css) softens the swap; both honour prefers-reduced-motion.

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
