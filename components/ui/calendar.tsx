"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        // Brand-tuned: bg-paper (cream), warm padding, no chrome. Stays
        // transparent inside Popover/Card surfaces (those carry their own
        // bg-paper) so we don't double-stack.
        "group/calendar bg-paper p-3 text-ink [--cell-size:--spacing(9)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 text-mute hover:bg-paper-raised hover:text-ink select-none aria-disabled:opacity-30",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 text-mute hover:bg-paper-raised hover:text-ink select-none aria-disabled:opacity-30",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-[13px] font-medium text-ink",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          // Flat-by-default per DESIGN.md, drop the shadow, use hairline
          // border and ink focus instead of the ring stack.
          "relative rounded-control border border-hairline bg-paper has-focus:border-ink",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute inset-0 bg-paper opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "font-medium text-ink select-none",
          captionLayout === "label"
            ? "text-sm"
            : "flex h-8 items-center gap-1 rounded-control pr-1 pl-2 text-[13px] [&>svg]:size-3.5 [&>svg]:text-mute",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          // Editorial label treatment, canonical eyebrow (10px uppercase
          // tracking-[0.18em]) instead of the generic muted caption.
          "flex-1 select-none text-[10px] font-medium uppercase tracking-[0.18em] text-mute",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-(--cell-size) select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-[10px] text-mute select-none",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-pill",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-pill"
            : "[&:first-child[data-selected=true]_button]:rounded-l-pill",
          defaultClassNames.day
        ),
        range_start: cn(
          "rounded-l-pill bg-paper-raised",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none bg-paper-raised", defaultClassNames.range_middle),
        range_end: cn("rounded-r-pill bg-paper-raised", defaultClassNames.range_end),
        today: cn(
          // Today reads as a quiet underline accent rather than a filled
          // chip, keeps the hierarchy: only the SELECTED day fills with
          // ink. Today is just a marker.
          "relative text-ink font-medium after:pointer-events-none after:absolute after:inset-x-3 after:bottom-1 after:h-px after:bg-ink/40 data-[selected=true]:after:hidden",
          defaultClassNames.today
        ),
        outside: cn(
          "text-mute/50 aria-selected:text-mute/50",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-mute/40",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            )
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        // Brand-tuned day button:
        // - default: ghost cell (text-ink, hover swaps to paper-raised)
        // - today: handled at the parent .today className (underline accent)
        // - selected: filled ink pill (bg-ink + text-paper rounded-pill)
        // - range pieces: paper-raised middle, ink ends, quiet tonal range
        // - focus: hairline ink ring instead of the heavy 3px ring stack
        "flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal text-ink rounded-pill transition-colors hover:bg-paper-raised " +
          "group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-1 group-data-[focused=true]/day:ring-ink/30 " +
          "data-[range-start=true]:rounded-l-pill data-[range-start=true]:bg-ink data-[range-start=true]:text-paper data-[range-start=true]:hover:bg-ink-deep " +
          "data-[range-end=true]:rounded-r-pill data-[range-end=true]:bg-ink data-[range-end=true]:text-paper data-[range-end=true]:hover:bg-ink-deep " +
          "data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-paper-raised data-[range-middle=true]:text-ink " +
          "data-[selected-single=true]:bg-ink data-[selected-single=true]:text-paper data-[selected-single=true]:hover:bg-ink-deep " +
          "[&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
