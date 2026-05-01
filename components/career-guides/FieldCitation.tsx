"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen } from "lucide-react";

export type CitationSource = {
  url: string;
  title: string;
  publisher?: string;
  fetchedAt: number;
};

export function FieldCitation({
  citations,
  label = "Sources",
}: {
  citations?: CitationSource[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!citations || citations.length === 0) return null;

  const count = citations.length;
  const buttonLabel = `${count} ${count === 1 ? "source" : "sources"}`;

  return (
    <span
      ref={containerRef}
      className="relative ml-2 inline-flex align-baseline"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`View ${buttonLabel}`}
        className={`group inline-flex items-center gap-1 whitespace-nowrap rounded-pill border px-2 py-[3px] text-[11px] font-medium leading-none tracking-tight tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${
          open
            ? "border-ink bg-ink text-paper"
            : "border-hairline-strong bg-paper-raised text-ink hover:border-ink hover:bg-ink hover:text-paper"
        }`}
      >
        <BookOpen
          className="h-3 w-3"
          aria-hidden="true"
          strokeWidth={1.75}
        />
        {buttonLabel}
      </button>

      {open && (
        <span
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-hairline bg-paper-raised p-3 text-left shadow-[0_12px_40px_-16px_rgba(0,0,0,0.25)]"
        >
          <span className="flex items-center justify-between">
            <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
              {label}
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-mute tabular-nums">
              {count}
            </span>
          </span>
          <span className="mt-2 block divide-y divide-hairline">
            {citations.map((c) => {
              const host = (() => {
                try {
                  return new URL(c.url).host.replace(/^www\./, "");
                } catch {
                  return c.url;
                }
              })();
              const sourceLabel = c.publisher?.trim() || host;
              return (
                <a
                  key={c.url}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 py-2 first:pt-0 last:pb-0 text-[13px] leading-snug text-ink/85 transition-colors hover:text-ink"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-medium uppercase tracking-[0.12em] text-mute">
                      {sourceLabel}
                    </span>
                    <span className="mt-0.5 block line-clamp-2">
                      {c.title}
                    </span>
                  </span>
                  <ArrowUpRight
                    className="mt-0.5 h-3 w-3 shrink-0 text-mute transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                </a>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}
