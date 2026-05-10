"use client";

import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";

type Precision = "month" | "year";

type Props = {
  value: string | null | undefined; // "YYYY" | "YYYY-MM" | undefined
  onChange: (next: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Some surfaces (e.g. graduation year) only ever store a year. Pass
   * `precision="year"` and `lockPrecision` to hide the toggle and force
   * the picker into year-only mode.
   */
  precision?: Precision;
  lockPrecision?: boolean;
  className?: string;
};

const MIN_DATE = new Date(1960, 0, 1);

function parseValue(raw: string | null | undefined): { date?: Date; precision: Precision } {
  if (!raw) return { precision: "month" };
  if (/^\d{4}$/.test(raw)) {
    return { date: new Date(parseInt(raw, 10), 0, 1), precision: "year" };
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    try {
      return { date: parse(raw, "yyyy-MM", new Date()), precision: "month" };
    } catch {
      return { precision: "month" };
    }
  }
  // Defensive: legacy data (full ISO, free-form), try Date(), fall back.
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return { date: d, precision: "month" };
  return { precision: "month" };
}

function serialize(date: Date, precision: Precision): string {
  return precision === "year" ? format(date, "yyyy") : format(date, "yyyy-MM");
}

function displayLabel(date: Date, precision: Precision): string {
  return precision === "year" ? format(date, "yyyy") : format(date, "MMMM yyyy");
}

export function MonthYearDatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  precision: precisionProp,
  lockPrecision = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseValue(value), [value]);
  // Local precision state, seeded from parsed value (or prop). Prop wins
  // when lockPrecision is true.
  const [precision, setPrecision] = useState<Precision>(
    precisionProp ?? parsed.precision,
  );
  const effectivePrecision = lockPrecision ? (precisionProp ?? "year") : precision;

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      onChange(undefined);
      setOpen(false);
      return;
    }
    const normalised =
      effectivePrecision === "year"
        ? new Date(date.getFullYear(), 0, 1)
        : new Date(date.getFullYear(), date.getMonth(), 1);
    onChange(serialize(normalised, effectivePrecision));
    setOpen(false);
  };

  // Precision-toggle handler that ALSO re-serializes the existing value
  // so the form sees a real value change. e.g. "2021-01" -> "2021" when
  // toggling to year-only; "2021" -> "2021-01" when toggling back. Without
  // this, the picker just changed local display state and RHF never saw
  // a diff, so toggling on a populated entry didn't surface the floating
  // Save bar even though the persisted value SHOULD have changed.
  const changePrecision = (next: Precision) => {
    if (next === precision) return;
    setPrecision(next);
    if (parsed.date) {
      const normalised =
        next === "year"
          ? new Date(parsed.date.getFullYear(), 0, 1)
          : new Date(parsed.date.getFullYear(), parsed.date.getMonth(), 1);
      onChange(serialize(normalised, next));
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {!lockPrecision && (
        <div
          className="inline-flex w-fit items-center gap-1 rounded-pill bg-paper-raised p-1 text-[11px]"
          role="group"
          aria-label="Date precision"
        >
          <button
            type="button"
            onClick={() => changePrecision("month")}
            aria-pressed={effectivePrecision === "month"}
            className={cn(
              "rounded-pill px-3 py-1 font-medium transition-colors",
              effectivePrecision === "month"
                ? "bg-paper text-ink"
                : "text-mute hover:text-ink",
            )}
          >
            Month + year
          </button>
          <button
            type="button"
            onClick={() => changePrecision("year")}
            aria-pressed={effectivePrecision === "year"}
            className={cn(
              "rounded-pill px-3 py-1 font-medium transition-colors",
              effectivePrecision === "year"
                ? "bg-paper text-ink"
                : "text-mute hover:text-ink",
            )}
          >
            Year only
          </button>
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "inline-flex w-full items-center justify-between gap-2 rounded-control border border-hairline bg-paper px-4 py-2.5 text-left text-[14px] text-ink transition-colors",
              "hover:border-ink/30 focus:border-ink focus:outline-none",
              !parsed.date && "text-mute",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <span className="inline-flex items-center gap-2">
              <CalendarIcon className="h-3.5 w-3.5 text-mute" strokeWidth={1.75} aria-hidden />
              {parsed.date ? displayLabel(parsed.date, effectivePrecision) : placeholder}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-mute" strokeWidth={1.75} aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={parsed.date}
            onSelect={handleSelect}
            disabled={(d) => d > new Date() || d < MIN_DATE}
            captionLayout="dropdown"
            startMonth={MIN_DATE}
            endMonth={new Date()}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
