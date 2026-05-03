"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  RotateCw,
  X,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { OUTREACH_TYPES, type OutreachType } from "@/lib/ai/prompts/outreach";
import { useOutreachDraft } from "./useOutreachDraft";
import { LoopingFeather } from "./LoopingFeather";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

type Person = {
  _id: Id<"key_people">;
  name: string;
  headline: string;
  linkedinUrl: string;
  currentRole: string;
  currentCompany: string;
};

type Props = {
  person: Person;
  onClose: () => void;
};

export function OutreachDraftDrawer({ person, onClose }: Props) {
  const draft = useOutreachDraft({ personId: person._id });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [copied, setCopied] = useState(false);
  // Intent picker collapses once an intent is chosen so the message textarea
  // dominates the drawer. User can re-open it via the summary row to switch.
  const [intentOpen, setIntentOpen] = useState(true);
  useEffect(() => {
    if (draft.outreachType !== null) setIntentOpen(false);
  }, [draft.outreachType]);

  const selectedIntent = useMemo(
    () =>
      draft.outreachType
        ? OUTREACH_TYPES.find((o) => o.id === draft.outreachType) ?? null
        : null,
    [draft.outreachType],
  );

  // Lock body scroll while the drawer is open. The simple
  // `body { overflow: hidden }` lock isn't enough on iOS Safari —
  // the browser still transitions its URL bar in response to inner
  // scrolls, which re-anchors `position: fixed` elements (the drawer)
  // to a different visual viewport mid-session and cuts off the
  // bottom CTA. The robust iOS pattern pins the body via
  // `position: fixed` at a negative top offset equal to the current
  // scrollY. Safari reads that as "the page isn't scrolling," so it
  // stops transitioning its URL bar entirely, the visual viewport
  // stays stable, and the drawer's footer stays where it should.
  // (Same pattern as MobileCardSheet — see memory entry
  // `feedback_ios_sheet_pattern.md`.)
  useEffect(() => {
    const scrollY = window.scrollY;
    const prev = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.width = prev.width;
      document.body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Auto-resize the textarea as content grows. With the intent picker
  // collapsed there's plenty of room — only the drawer's outer scroll
  // container should take over for unusually long drafts.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 900)}px`;
  }, [draft.message, intentOpen]);

  const wordCount =
    draft.message.trim().length === 0
      ? 0
      : draft.message.trim().split(/\s+/).length;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft.message);
      window.open(person.linkedinUrl, "_blank", "noopener,noreferrer");
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Most browsers permit clipboard writes from a click; rare failure
      // surfaces as the button not flashing "Copied" — acceptable.
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.35, ease: [0.2, 0.65, 0.3, 1] }}
        className="fixed right-0 top-0 z-50 flex h-screen w-full flex-col border-l border-hairline bg-paper sm:max-w-lg"
        role="dialog"
        aria-label={`Draft message to ${person.name}`}
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-6 py-5">
          <div className="min-w-0">
            <p className={eyebrowCls}>Draft outreach</p>
            <h2 className="mt-1 truncate text-[18px] font-medium leading-tight text-ink">
              {person.name}
            </h2>
            <p className="mt-1 truncate text-[13px] text-mute">
              {person.currentRole}
              {person.currentCompany ? ` at ${person.currentCompany}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-pill p-2 text-mute transition-colors hover:bg-paper-raised hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {selectedIntent && !intentOpen ? (
            <button
              type="button"
              onClick={() => setIntentOpen(true)}
              disabled={draft.isGenerating}
              className="group flex w-full items-center justify-between gap-3 rounded-card border border-hairline bg-paper-raised px-4 py-3 text-left transition-colors hover:border-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="min-w-0">
                <p className={eyebrowCls}>Intent</p>
                <p className="mt-1 truncate text-[14px] font-medium leading-tight text-ink">
                  {selectedIntent.label}
                  <span className="ml-2 font-normal text-mute">
                    — {selectedIntent.hint}
                  </span>
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink/55 transition-colors group-hover:text-ink">
                Change
                <ChevronDown
                  className="h-3 w-3"
                  aria-hidden
                  strokeWidth={1.75}
                />
              </span>
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className={eyebrowCls}>Pick an intent</p>
                {selectedIntent && (
                  <button
                    type="button"
                    onClick={() => setIntentOpen(false)}
                    className="text-[11px] font-medium text-mute transition-colors hover:text-ink"
                  >
                    Cancel
                  </button>
                )}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                {OUTREACH_TYPES.map((opt) => (
                  <IntentButton
                    key={opt.id}
                    id={opt.id}
                    label={opt.label}
                    hint={opt.hint}
                    active={draft.outreachType === opt.id}
                    onClick={() => draft.selectOutreachType(opt.id)}
                    disabled={draft.isGenerating}
                  />
                ))}
              </div>

              {draft.outreachType === "custom" && (
                <div className="mt-4">
                  <label className={`${eyebrowCls} block`}>Your intent</label>
                  <textarea
                    value={draft.customIntent}
                    onChange={(e) => draft.setCustomIntent(e.target.value)}
                    placeholder="What do you want from this conversation? (a sentence or two)"
                    rows={3}
                    className="mt-2 w-full resize-none rounded-card border border-hairline bg-paper-raised px-4 py-3 text-[14px] leading-relaxed text-ink placeholder:text-mute focus:border-ink focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void draft.generate("custom");
                      setIntentOpen(false);
                    }}
                    disabled={
                      draft.isGenerating ||
                      draft.customIntent.trim().length === 0
                    }
                    className="mt-3 inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Draft from my intent
                  </button>
                </div>
              )}
            </>
          )}

          <div className="mt-6 border-t border-hairline pt-6">
            <div className="flex items-center justify-between gap-3">
              <p className={eyebrowCls}>Your message</p>
              {draft.isGenerating ? (
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-mute"
                  aria-live="polite"
                >
                  <LoopingFeather size={11} className="text-mute" />
                  Drafting…
                </span>
              ) : draft.hasDraft ? (
                <button
                  type="button"
                  onClick={() => draft.generate()}
                  disabled={draft.outreachType === null}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:border-ink-deep hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCw className="h-3 w-3" aria-hidden strokeWidth={1.75} />
                  Try again
                </button>
              ) : null}
            </div>

            {draft.message.length === 0 && !draft.isGenerating ? (
              <p className="mt-4 text-[14px] text-mute">
                Pick an intent above to draft a tailored message.
              </p>
            ) : (
              <textarea
                ref={textareaRef}
                value={draft.message}
                onChange={(e) => draft.setMessage(e.target.value)}
                placeholder="Drafting…"
                disabled={draft.isGenerating}
                className="mt-3 w-full resize-none overflow-hidden rounded-card border border-hairline bg-paper-raised px-4 py-4 text-[15px] leading-[1.65] text-ink placeholder:text-mute focus:border-ink focus:outline-none disabled:opacity-90"
              />
            )}

            <div className="mt-3 flex items-center justify-between text-[11px] text-mute">
              <span>
                {wordCount} {wordCount === 1 ? "word" : "words"}
              </span>
              {wordCount > 0 && (wordCount < 120 || wordCount > 280) && (
                <span className="text-ink/55">
                  {wordCount < 120
                    ? "On the short side"
                    : "A touch long for LinkedIn"}
                </span>
              )}
            </div>
          </div>

          {draft.actionError && (
            <div className="mt-5 rounded-card border border-state-warning/40 bg-state-warning/5 px-4 py-3 text-[13px] leading-snug text-ink/80">
              {draft.actionError}
            </div>
          )}
        </div>

        <footer className="border-t border-hairline px-6 py-4">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!draft.hasDraft || draft.isGenerating}
            className="inline-flex w-full items-center justify-center gap-2 rounded-pill bg-ink px-5 py-3 text-[14px] font-medium text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" aria-hidden strokeWidth={1.75} />
                Copied — opening LinkedIn
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" aria-hidden strokeWidth={1.75} />
                Copy &amp; open LinkedIn
                <ArrowUpRight
                  className="h-3.5 w-3.5"
                  aria-hidden
                  strokeWidth={1.75}
                />
              </>
            )}
          </button>
        </footer>
      </motion.aside>
    </AnimatePresence>
  );
}

function IntentButton({
  id,
  label,
  hint,
  active,
  disabled,
  onClick,
}: {
  id: OutreachType;
  label: string;
  hint: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-intent={id}
      className={`group flex items-start gap-3 rounded-card border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? "border-ink bg-ink text-paper"
          : "border-hairline bg-paper hover:border-ink-deep hover:bg-paper-raised"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p
          className={`text-[14px] font-medium leading-tight ${
            active ? "text-paper" : "text-ink"
          }`}
        >
          {label}
        </p>
        <p
          className={`mt-1 text-[12px] leading-snug ${
            active ? "text-paper/80" : "text-mute"
          }`}
        >
          {hint}
        </p>
      </div>
    </button>
  );
}
