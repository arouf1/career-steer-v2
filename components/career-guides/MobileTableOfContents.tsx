"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, List } from "lucide-react";

export type MobileTocSection = { id: string; label: string };

const mountedSubscribe = () => () => {};
const mountedClientSnapshot = () => true;
const mountedServerSnapshot = () => false;

export function MobileTableOfContents({
  sections,
}: {
  sections: MobileTocSection[];
}) {
  const [active, setActive] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const mounted = useSyncExternalStore(
    mountedSubscribe,
    mountedClientSnapshot,
    mountedServerSnapshot,
  );

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (Math.abs(delta) > 6) {
          if (delta > 0 && y > 160) {
            setHidden(true);
            setOpen(false);
          } else {
            setHidden(false);
          }
          lastY = y;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  if (sections.length === 0) return null;

  const activeLabel =
    sections.find((s) => s.id === active)?.label ?? "Jump to section";

  const handleSelect = (id: string) => {
    setOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    }
  };

  return (
    <AnimatePresence>
      {mounted && (
        <motion.div
          ref={containerRef}
          initial={{ opacity: 0, y: 20 }}
          animate={{
            opacity: hidden && !open ? 0 : 1,
            y: hidden && !open ? 28 : 0,
          }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.28, ease: [0.2, 0.65, 0.3, 1] }}
          style={{ pointerEvents: hidden && !open ? "none" : "auto" }}
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <AnimatePresence>
            {open && (
              <motion.div
                key="menu"
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.2, 0.65, 0.3, 1] }}
                role="listbox"
                aria-label="Article sections"
                className="mb-3 max-h-[60vh] w-[min(20rem,calc(100vw-2rem))] overflow-auto overscroll-contain rounded-card border border-hairline bg-paper-raised p-1.5 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.25)]"
              >
                <ul>
                  {sections.map((s) => {
                    const isActive = s.id === active;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => handleSelect(s.id)}
                          className={`flex w-full items-center justify-between gap-3 rounded-control px-3 py-2.5 text-left text-[14px] transition-colors ${
                            isActive
                              ? "bg-ink/[0.06] text-ink"
                              : "text-body hover:bg-ink/[0.04] hover:text-ink"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {s.label}
                          </span>
                          {isActive && (
                            <Check
                              className="h-3.5 w-3.5 shrink-0 text-ink"
                              aria-hidden="true"
                              strokeWidth={2}
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={open ? "Close section menu" : "Open section menu"}
            className="inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-2.5 text-[14px] font-medium text-paper shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)] transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <List
              className="h-3.5 w-3.5 shrink-0 text-paper/70"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            <span className="max-w-[12rem] truncate">{activeLabel}</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
