"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export type LocationSelection = {
  canonicalName: string;
  countryCode: string;
};

type Props = {
  value: string | null;
  onChange: (next: string | null) => void;
  // Fires only when the user picks an item from the dropdown (mouse or
  // keyboard). Free-text typing does not invoke this — callers that need
  // the country code should treat its absence as "user typed something we
  // don't have a country code for."
  onSelect?: (item: LocationSelection) => void;
  placeholder?: string;
  className?: string;
};

const DEBOUNCE_MS = 180;
const MIN_CHARS = 2;

export function LocationCombobox({
  value,
  onChange,
  onSelect,
  placeholder = "Location",
  className,
}: Props) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState(value ?? "");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Sync external value changes (e.g. form reset) into the visible input.
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  // Debounce the typed query.
  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed.length < MIN_CHARS) {
      setDebounced("");
      return;
    }
    const t = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);

  const results = useQuery(
    api.locations.searchCities,
    debounced ? { query: debounced } : "skip",
  );
  const loading = !!debounced && results === undefined;
  const items = results ?? [];

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Reset highlight when the result set changes.
  useEffect(() => {
    setActive(0);
  }, [items.length]);

  const commit = (next: string, selection?: LocationSelection) => {
    setDraft(next);
    onChange(next.length === 0 ? null : next);
    if (selection) onSelect?.(selection);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      if (items.length > 0) setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0)
        setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      if (open && items[active]) {
        e.preventDefault();
        const it = items[active];
        commit(it.canonicalName, {
          canonicalName: it.canonicalName,
          countryCode: it.countryCode,
        });
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown =
    open && draft.trim().length >= MIN_CHARS && (loading || items.length > 0 || results !== undefined);

  const inputCls =
    className ??
    "w-full rounded-control border border-hairline bg-paper px-4 py-3 type-body text-ink placeholder:text-mute focus:border-ink focus:outline-none";

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          showDropdown && items[active]
            ? `${listboxId}-opt-${active}`
            : undefined
        }
        autoComplete="off"
        spellCheck={false}
        className={inputCls}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
          // Treat unconfirmed typing as the new value so users who type a
          // location not in our list still save what they wrote.
          onChange(e.target.value.length === 0 ? null : e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-72 overflow-auto rounded-control border border-hairline bg-paper shadow-lg"
        >
          {loading && (
            <li className="type-caption px-4 py-3 text-mute">Searching…</li>
          )}
          {!loading && items.length === 0 && (
            <li className="type-caption px-4 py-3 text-mute">No matches</li>
          )}
          {!loading &&
            items.map((it, i) => (
              <li
                key={it.id}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  // mousedown beats the input's blur and keeps focus.
                  e.preventDefault();
                  commit(it.canonicalName, {
                    canonicalName: it.canonicalName,
                    countryCode: it.countryCode,
                  });
                }}
                className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 type-body ${
                  i === active ? "bg-ink/5 text-ink" : "text-ink/90"
                }`}
              >
                <span className="truncate">{it.canonicalName}</span>
                <span className="type-caption shrink-0 font-mono uppercase text-mute">
                  {it.countryCode}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
