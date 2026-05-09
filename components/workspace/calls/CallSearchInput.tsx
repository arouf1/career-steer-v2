// components/workspace/calls/CallSearchInput.tsx
//
// Controlled search input with:
//   - Leading Search icon (absolute, non-interactive)
//   - Clear button (X) when value is non-empty
//   - Trailing semantic-search toggle (Sparkles) — active = filled bg-ink
//
// The component does NOT debounce — parent's responsibility.
// Mode "off" means the value is ignored downstream; we signal this by
// lowering the text opacity while still keeping the field editable.

"use client";

import { Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "off" | "text";

type Props = {
  value: string;
  onChange: (v: string) => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  placeholder?: string;
  className?: string;
};

export function CallSearchInput({
  value,
  onChange,
  mode,
  onModeChange,
  placeholder = "Search calls…",
  className,
}: Props) {
  const modeOff = mode === "off";
  const hasValue = value.length > 0;

  return (
    <div className={cn("relative flex items-center gap-2", className)}>
      {/* Input wrapper — contains the text field and the icon decorations */}
      <div className="relative flex-1">
        {/* Leading search icon */}
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute"
          strokeWidth={1.75}
          aria-hidden
        />

        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Search calls"
          className={cn(
            // Base shape — matches shadcn Input visual sizing
            "h-9 w-full rounded-control border border-hairline bg-paper py-2 pl-9 text-sm text-ink shadow-none outline-none",
            // Trailing padding: leave room for clear button when visible
            hasValue ? "pr-16" : "pr-4",
            // Mode-off: visually muted placeholder + text
            modeOff && "text-ink/40 placeholder:text-mute/40",
            // Focus ring
            "transition-colors focus-visible:border-ink/30 focus-visible:ring-2 focus-visible:ring-ink/10",
          )}
        />

        {/* Clear button — only shown when value is non-empty */}
        {hasValue && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-9 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-mute transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Semantic-search toggle button */}
      <button
        type="button"
        onClick={() => onModeChange(modeOff ? "text" : "off")}
        aria-label={modeOff ? "Switch to semantic search" : "Switch to literal text filter"}
        aria-pressed={!modeOff}
        title={modeOff ? "Semantic search" : "Switch to literal text filter"}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-control border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20",
          modeOff
            ? "border-hairline bg-paper text-mute hover:border-ink/20 hover:text-ink"
            : "border-ink bg-ink text-paper hover:bg-ink-deep",
        )}
      >
        <Sparkles className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}
