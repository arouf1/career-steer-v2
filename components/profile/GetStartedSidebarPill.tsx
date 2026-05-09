"use client";

import { PanelLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Floating bottom-center "Get started" pill that opens the workspace
 * sidebar. Mirrors the floating Save bar on the profile edit page —
 * same pill shape, same enter/exit motion — so floating CTAs across
 * the workspace read as one vocabulary.
 *
 * Self-hides when the sidebar is already expanded or on mobile (where
 * the mobile header carries its own toggle).
 */
export function GetStartedSidebarPill() {
  const { state, setOpen, isMobile } = useSidebar();
  const visible = !isMobile && state !== "expanded";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="get-started-pill"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.24, ease: [0.2, 0.65, 0.3, 1] }}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="pointer-events-auto type-label inline-flex items-center gap-2 rounded-pill bg-ink px-5 py-2.5 text-paper shadow-[0_8px_32px_-12px_rgba(0,0,0,0.18)] transition-colors hover:bg-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Get started
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
