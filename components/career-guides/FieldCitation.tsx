"use client";

import { ArrowUpRight, BookOpen } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type CitationSource = {
  url: string;
  title: string;
  publisher?: string;
  fetchedAt: number;
};

// Inline citation badge that opens a sources popover. Built on the Radix
// Popover primitive so the panel is portal-rendered (escapes any ancestor
// `overflow: hidden` / `clip` like the wiki article container) and uses
// Radix's auto-collision so it never lands outside the viewport: it shifts
// or flips automatically based on the trigger's position. Keeps a 16px
// breathing margin from each viewport edge via `collisionPadding`.
export function FieldCitation({
  citations,
  label = "Sources",
}: {
  citations?: CitationSource[];
  label?: string;
}) {
  if (!citations || citations.length === 0) return null;

  const count = citations.length;
  const buttonLabel = `${count} ${count === 1 ? "source" : "sources"}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`View ${buttonLabel}`}
          className="group ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded-pill border border-hairline-strong bg-paper-raised px-2 py-[3px] align-baseline text-[11px] font-medium leading-none tracking-tight tabular-nums text-ink transition-all hover:border-ink hover:bg-ink hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-paper data-[state=open]:border-ink data-[state=open]:bg-ink data-[state=open]:text-paper"
        >
          <BookOpen
            className="h-3 w-3"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          {buttonLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        aria-label={label}
        className="w-[min(22rem,calc(100vw-2rem))] rounded-card border-hairline bg-paper-raised p-4 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.25)]"
      >
        <div className="flex items-center justify-between border-b border-hairline pb-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
            {label}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-mute tabular-nums">
            {count}
          </span>
        </div>
        <ul className="divide-y divide-hairline">
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
              <li key={c.url}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 py-3.5 text-[13px] leading-relaxed text-ink/85 transition-colors hover:text-ink"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-mute">
                      {sourceLabel}
                    </span>
                    <span className="mt-1.5 block line-clamp-3 text-ink/85 group-hover:text-ink">
                      {c.title}
                    </span>
                  </span>
                  <ArrowUpRight
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mute transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                </a>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
