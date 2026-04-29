"use client";

import { useEffect, useMemo } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { CitationSource } from "./FieldCitation";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

export function AllSourcesPanel({
  open,
  onClose,
  citations,
}: {
  open: boolean;
  onClose: () => void;
  citations: Record<string, CitationSource[]>;
}) {
  const sources = useMemo(() => {
    const seen = new Map<string, CitationSource>();
    for (const list of Object.values(citations)) {
      for (const c of list) {
        if (!seen.has(c.url)) seen.set(c.url, c);
      }
    }
    return Array.from(seen.values()).sort((a, b) => {
      const labelA = (a.publisher?.trim() || hostFor(a.url)).toLowerCase();
      const labelB = (b.publisher?.trim() || hostFor(b.url)).toLowerCase();
      return labelA.localeCompare(labelB);
    });
  }, [citations]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-ink/15"
            aria-hidden="true"
          />
          <motion.aside
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="All sources"
            className="fixed inset-y-0 right-0 z-50 flex w-[26rem] max-w-[calc(100vw-2.5rem)] flex-col border-l border-hairline bg-paper"
          >
            <header className="flex items-center justify-between border-b border-hairline px-6 py-5">
              <div className="flex items-baseline gap-3">
                <h2 className="font-sans font-semibold tracking-tight text-ink text-lg">
                  Sources
                </h2>
                <span className="type-caption text-mute tabular-nums">
                  {sources.length}
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close sources"
                className="inline-flex h-8 w-8 items-center justify-center rounded-pill text-mute transition-colors hover:bg-paper-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <X className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto">
              {sources.length === 0 ? (
                <p className="px-6 py-8 type-caption text-mute">
                  No sources available yet.
                </p>
              ) : (
                <ul className="divide-y divide-hairline px-6">
                  {sources.map((c) => {
                    const host = hostFor(c.url);
                    const label = c.publisher?.trim() || host;
                    return (
                      <li key={c.url}>
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-start gap-3 py-4"
                        >
                          <span className="min-w-0 flex-1">
                            <span className={`block ${eyebrowCls}`}>
                              {label}
                            </span>
                            <span className="mt-1.5 block text-[14px] leading-snug text-ink transition-colors group-hover:text-ink-deep">
                              {c.title}
                            </span>
                            <span className="mt-1 block text-[12px] text-mute">
                              {host}
                            </span>
                          </span>
                          <ArrowUpRight
                            className="mt-1 h-3.5 w-3.5 shrink-0 text-mute transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                            aria-hidden="true"
                            strokeWidth={1.75}
                          />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function hostFor(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
