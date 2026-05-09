"use client";

import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, KeyboardEvent } from "react";
import { api } from "@/convex/_generated/api";
import { ProfileSchema, type Profile } from "@/lib/profiles/schema";
import type { Doc } from "@/convex/_generated/dataModel";
import { LocationCombobox } from "./LocationCombobox";
import { MonthYearDatePicker } from "./MonthYearDatePicker";

type Props = { profile: Doc<"profiles">; onDone: () => void };

export function ProfileEditForm({ profile, onDone }: Props) {
  const update = useMutation(api.profiles.update);
  const markReviewed = useMutation(api.profiles.markReviewed);

  const form = useForm<Profile>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: {
      name: profile.name ?? null,
      headline: profile.headline ?? null,
      summary: profile.summary ?? null,
      location: profile.location ?? null,
      experience: profile.experience.map((e) => ({
        title: e.title,
        company: e.company,
        startDate: e.startDate ?? null,
        endDate: e.endDate ?? null,
        description: e.description ?? null,
      })),
      education: profile.education.map((e) => ({
        school: e.school,
        degree: e.degree ?? null,
        field: e.field ?? null,
        startDate: e.startDate ?? null,
        endDate: e.endDate ?? null,
      })),
      skills: profile.skills,
    },
  });

  const expArray = useFieldArray({ control: form.control, name: "experience" });
  const eduArray = useFieldArray({ control: form.control, name: "education" });

  const onSubmit = form.handleSubmit(async (values: Profile) => {
    // Map Zod Profile (nullable sub-fields) → Convex patch (optional sub-fields).
    // Top-level strings: update accepts null via v.union(v.string(), v.null()).
    // Array sub-fields: update accepts only v.optional(v.string()) — no null.
    await update({
      patch: {
        name: values.name,
        headline: values.headline,
        summary: values.summary,
        location: values.location,
        experience: values.experience.map((e) => ({
          title: e.title,
          company: e.company,
          startDate: e.startDate ?? undefined,
          endDate: e.endDate ?? undefined,
          description: e.description ?? undefined,
        })),
        education: values.education.map((e) => ({
          school: e.school,
          degree: e.degree ?? undefined,
          field: e.field ?? undefined,
          startDate: e.startDate ?? undefined,
          endDate: e.endDate ?? undefined,
        })),
        skills: values.skills,
      },
    });
    await markReviewed({});
    onDone();
  });

  function handleCancelClick() {
    if (form.formState.isDirty) {
      const confirmed = window.confirm(
        "You have unsaved changes. Leave without saving?",
      );
      if (!confirmed) return;
    }
    onDone();
  }

  const inputCls =
    "w-full rounded-control border border-hairline bg-paper px-4 py-2.5 text-[14px] text-ink placeholder:text-mute focus:border-ink focus:outline-none";

  const labelCls = "text-[10px] uppercase tracking-[0.18em] font-medium text-mute mb-1.5 block";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-12">
      {/* ── About you ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-6">
        <p className={labelCls}>About you</p>

        <div>
          <label htmlFor="edit-name" className={labelCls}>Name</label>
          <input
            id="edit-name"
            className={inputCls}
            placeholder="Your name"
            {...form.register("name")}
          />
        </div>

        <div>
          <label htmlFor="edit-headline" className={labelCls}>Headline</label>
          <input
            id="edit-headline"
            className={inputCls}
            placeholder="e.g. Product Designer at Acme"
            {...form.register("headline")}
          />
        </div>

        <div>
          <label htmlFor="edit-location" className={labelCls}>Location</label>
          <Controller
            control={form.control}
            name="location"
            render={({ field }) => (
              <LocationCombobox
                value={field.value ?? null}
                onChange={field.onChange}
                placeholder="City, Country"
                className={inputCls}
              />
            )}
          />
        </div>

        <div>
          <label htmlFor="edit-summary" className={labelCls}>Summary</label>
          <textarea
            id="edit-summary"
            className={inputCls}
            rows={4}
            placeholder="A short professional summary"
            {...form.register("summary")}
          />
        </div>
      </section>

      {/* ── Experience ────────────────────────────────────────────────── */}
      <section>
        <p className={labelCls}>Experience</p>
        <ul className="mt-4 flex flex-col gap-6">
          {expArray.fields.map((field, i) => (
            <ExperienceEntry
              key={field.id}
              index={i}
              form={form}
              onRemove={() => expArray.remove(i)}
              inputCls={inputCls}
              labelCls={labelCls}
            />
          ))}
        </ul>
        <button
          type="button"
          onClick={() =>
            expArray.append({
              title: "",
              company: "",
              startDate: null,
              endDate: null,
              description: null,
            })
          }
          className="mt-6 inline-flex items-center gap-2 rounded-pill border border-hairline px-4 py-2 text-[13px] text-ink transition-colors hover:border-ink"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
          Add role
        </button>
      </section>

      {/* ── Education ─────────────────────────────────────────────────── */}
      <section>
        <p className={labelCls}>Education</p>
        <ul className="mt-4 flex flex-col gap-6">
          {eduArray.fields.map((field, i) => (
            <EducationEntry
              key={field.id}
              index={i}
              form={form}
              onRemove={() => eduArray.remove(i)}
              inputCls={inputCls}
              labelCls={labelCls}
            />
          ))}
        </ul>
        <button
          type="button"
          onClick={() =>
            eduArray.append({
              school: "",
              degree: null,
              field: null,
              startDate: null,
              endDate: null,
            })
          }
          className="mt-6 inline-flex items-center gap-2 rounded-pill border border-hairline px-4 py-2 text-[13px] text-ink transition-colors hover:border-ink"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
          Add education
        </button>
      </section>

      {/* ── Skills ────────────────────────────────────────────────────── */}
      <section>
        <p className={labelCls}>Skills</p>
        <Controller
          control={form.control}
          name="skills"
          render={({ field }) => (
            <SkillsInput value={field.value} onChange={field.onChange} />
          )}
        />
      </section>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-t border-hairline pt-6">
        <button
          type="button"
          onClick={handleCancelClick}
          className="text-[13px] text-mute transition-colors hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="type-label rounded-pill bg-ink px-6 py-3 text-paper transition-colors hover:bg-ink-deep disabled:opacity-50"
        >
          {form.formState.isSubmitting ? "Saving…" : "Save and mark reviewed"}
        </button>
      </div>
    </form>
  );
}

// ── ExperienceEntry sub-component ─────────────────────────────────────────

type EntrySharedProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: ReturnType<typeof useForm<Profile>>;
  index: number;
  onRemove: () => void;
  inputCls: string;
  labelCls: string;
};

function ExperienceEntry({ form, index: i, onRemove, inputCls, labelCls }: EntrySharedProps) {
  const endDateValue = form.watch(`experience.${i}.endDate`);
  const isCurrent = endDateValue === null || endDateValue === undefined;
  const [currentlyHere, setCurrentlyHere] = useState(isCurrent);

  function handleCurrentToggle(checked: boolean) {
    setCurrentlyHere(checked);
    if (checked) {
      form.setValue(`experience.${i}.endDate`, null, { shouldDirty: true });
    }
  }

  return (
    <li className="relative flex flex-col gap-4 rounded-card border border-hairline bg-paper p-6">
      {/* Remove button — top-right */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove this role"
        className="absolute right-4 top-4 rounded p-1 text-mute transition-colors hover:text-state-error"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </button>

      <div>
        <label htmlFor={`exp-title-${i}`} className={labelCls}>Title</label>
        <input
          id={`exp-title-${i}`}
          className={inputCls}
          placeholder="e.g. Senior Engineer"
          {...form.register(`experience.${i}.title`)}
        />
        {form.formState.errors.experience?.[i]?.title && (
          <p className="mt-1 text-[12px] text-state-error">
            {form.formState.errors.experience[i]?.title?.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`exp-company-${i}`} className={labelCls}>Company</label>
        <input
          id={`exp-company-${i}`}
          className={inputCls}
          placeholder="e.g. Acme Corp"
          {...form.register(`experience.${i}.company`)}
        />
        {form.formState.errors.experience?.[i]?.company && (
          <p className="mt-1 text-[12px] text-state-error">
            {form.formState.errors.experience[i]?.company?.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className={labelCls}>Start date</p>
          <Controller
            control={form.control}
            name={`experience.${i}.startDate`}
            render={({ field }) => (
              <MonthYearDatePicker
                value={field.value}
                onChange={(v) => field.onChange(v ?? null)}
                placeholder="Start date"
              />
            )}
          />
        </div>
        <div>
          <p className={labelCls}>End date</p>
          <Controller
            control={form.control}
            name={`experience.${i}.endDate`}
            render={({ field }) => (
              <MonthYearDatePicker
                value={field.value}
                onChange={(v) => field.onChange(v ?? null)}
                placeholder={currentlyHere ? "Present" : "End date"}
                disabled={currentlyHere}
              />
            )}
          />
        </div>
      </div>

      {/* "I currently work here" checkbox */}
      <label className="inline-flex cursor-pointer items-center gap-2.5 self-start">
        <input
          type="checkbox"
          checked={currentlyHere}
          onChange={(e) => handleCurrentToggle(e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded border-hairline accent-ink"
        />
        <span className="text-[13px] text-body">I currently work here</span>
      </label>

      <div>
        <label htmlFor={`exp-desc-${i}`} className={labelCls}>Description</label>
        <textarea
          id={`exp-desc-${i}`}
          className={inputCls}
          rows={3}
          placeholder="Describe your role and impact"
          {...form.register(`experience.${i}.description`)}
        />
      </div>
    </li>
  );
}

// ── EducationEntry sub-component ──────────────────────────────────────────

function EducationEntry({ form, index: i, onRemove, inputCls, labelCls }: EntrySharedProps) {
  return (
    <li className="relative flex flex-col gap-4 rounded-card border border-hairline bg-paper p-6">
      {/* Remove button — top-right */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove this education entry"
        className="absolute right-4 top-4 rounded p-1 text-mute transition-colors hover:text-state-error"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </button>

      <div>
        <label htmlFor={`edu-school-${i}`} className={labelCls}>School</label>
        <input
          id={`edu-school-${i}`}
          className={inputCls}
          placeholder="e.g. University of Edinburgh"
          {...form.register(`education.${i}.school`)}
        />
        {form.formState.errors.education?.[i]?.school && (
          <p className="mt-1 text-[12px] text-state-error">
            {form.formState.errors.education[i]?.school?.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`edu-degree-${i}`} className={labelCls}>Degree</label>
        <input
          id={`edu-degree-${i}`}
          className={inputCls}
          placeholder="e.g. BSc, MSc, PhD"
          {...form.register(`education.${i}.degree`)}
        />
      </div>

      <div>
        <label htmlFor={`edu-field-${i}`} className={labelCls}>Field of study</label>
        <input
          id={`edu-field-${i}`}
          className={inputCls}
          placeholder="e.g. Computer Science"
          {...form.register(`education.${i}.field`)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className={labelCls}>Start year</p>
          <Controller
            control={form.control}
            name={`education.${i}.startDate`}
            render={({ field }) => (
              <MonthYearDatePicker
                value={field.value}
                onChange={(v) => field.onChange(v ?? null)}
                placeholder="Start year"
                precision="year"
                lockPrecision
              />
            )}
          />
        </div>
        <div>
          <p className={labelCls}>End year</p>
          <Controller
            control={form.control}
            name={`education.${i}.endDate`}
            render={({ field }) => (
              <MonthYearDatePicker
                value={field.value}
                onChange={(v) => field.onChange(v ?? null)}
                placeholder="End year"
                precision="year"
                lockPrecision
              />
            )}
          />
        </div>
      </div>
    </li>
  );
}

// ── SkillsInput — chip-style tag input ────────────────────────────────────

function SkillsInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addSkill(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInputValue("");
  }

  function removeSkill(skill: string) {
    onChange(value.filter((s) => s !== skill));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSkill(inputValue);
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      // Delete last chip on backspace when input is empty
      onChange(value.slice(0, -1));
    }
  }

  function handleBlur() {
    if (inputValue.trim()) {
      addSkill(inputValue);
    }
  }

  return (
    <div
      className="flex min-h-[44px] w-full cursor-text flex-wrap gap-2 rounded-control border border-hairline bg-paper px-3 py-2.5 transition-colors focus-within:border-ink"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((skill) => (
        <span
          key={skill}
          className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-paper-raised px-3 py-1 text-[12px] text-ink"
        >
          {skill}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeSkill(skill);
            }}
            aria-label={`Remove ${skill}`}
            className="text-mute transition-colors hover:text-state-error"
          >
            <X className="h-3 w-3" strokeWidth={2} aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? "TypeScript, React, Convex… (Enter or comma to add)" : ""}
        className="min-w-[180px] flex-1 bg-transparent text-[14px] text-ink placeholder:text-mute focus:outline-none"
        aria-label="Add a skill"
      />
    </div>
  );
}
