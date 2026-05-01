"use client";

import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ProfileSchema, type Profile } from "@/lib/profiles/schema";
import type { Doc } from "@/convex/_generated/dataModel";
import { LocationCombobox } from "./LocationCombobox";

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

  const inputCls =
    "w-full rounded-control border border-hairline bg-paper px-4 py-3 type-body text-ink placeholder:text-mute focus:border-ink focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-10">
      {/* About you */}
      <fieldset className="flex flex-col gap-4">
        <legend className="type-label uppercase tracking-wider text-mute mb-2">
          About you
        </legend>
        <input
          className={inputCls}
          placeholder="Name"
          {...form.register("name")}
        />
        <input
          className={inputCls}
          placeholder="Headline"
          {...form.register("headline")}
        />
        <Controller
          control={form.control}
          name="location"
          render={({ field }) => (
            <LocationCombobox
              value={field.value ?? null}
              onChange={field.onChange}
              placeholder="Location"
              className={inputCls}
            />
          )}
        />
        <textarea
          className={inputCls}
          rows={4}
          placeholder="Summary"
          {...form.register("summary")}
        />
      </fieldset>

      {/* Experience */}
      <fieldset>
        <legend className="type-label uppercase tracking-wider text-mute mb-4">
          Experience
        </legend>
        <ul className="flex flex-col gap-6">
          {expArray.fields.map((field, i) => (
            <li
              key={field.id}
              className="flex flex-col gap-3 rounded-card border border-hairline bg-paper p-4"
            >
              <input
                className={inputCls}
                placeholder="Title"
                {...form.register(`experience.${i}.title`)}
              />
              {form.formState.errors.experience?.[i]?.title && (
                <p className="type-caption text-state-error -mt-2">
                  {form.formState.errors.experience[i]?.title?.message}
                </p>
              )}
              <input
                className={inputCls}
                placeholder="Company"
                {...form.register(`experience.${i}.company`)}
              />
              {form.formState.errors.experience?.[i]?.company && (
                <p className="type-caption text-state-error -mt-2">
                  {form.formState.errors.experience[i]?.company?.message}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={inputCls}
                  placeholder="Start date"
                  {...form.register(`experience.${i}.startDate`)}
                />
                <input
                  className={inputCls}
                  placeholder="End date (or 'Present')"
                  {...form.register(`experience.${i}.endDate`)}
                />
              </div>
              <textarea
                className={inputCls}
                rows={3}
                placeholder="Description"
                {...form.register(`experience.${i}.description`)}
              />
              <button
                type="button"
                onClick={() => expArray.remove(i)}
                className="type-label inline-flex items-center gap-2 self-end text-mute transition-colors hover:text-state-error"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
                Remove
              </button>
            </li>
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
          className="type-label mt-4 inline-flex items-center gap-2 rounded-pill border border-hairline-strong px-5 py-2 text-ink transition-colors hover:border-ink"
        >
          <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          Add role
        </button>
      </fieldset>

      {/* Education */}
      <fieldset>
        <legend className="type-label uppercase tracking-wider text-mute mb-4">
          Education
        </legend>
        <ul className="flex flex-col gap-6">
          {eduArray.fields.map((field, i) => (
            <li
              key={field.id}
              className="flex flex-col gap-3 rounded-card border border-hairline bg-paper p-4"
            >
              <input
                className={inputCls}
                placeholder="School"
                {...form.register(`education.${i}.school`)}
              />
              {form.formState.errors.education?.[i]?.school && (
                <p className="type-caption text-state-error -mt-2">
                  {form.formState.errors.education[i]?.school?.message}
                </p>
              )}
              <input
                className={inputCls}
                placeholder="Degree"
                {...form.register(`education.${i}.degree`)}
              />
              <input
                className={inputCls}
                placeholder="Field of study"
                {...form.register(`education.${i}.field`)}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={inputCls}
                  placeholder="Start date"
                  {...form.register(`education.${i}.startDate`)}
                />
                <input
                  className={inputCls}
                  placeholder="End date"
                  {...form.register(`education.${i}.endDate`)}
                />
              </div>
              <button
                type="button"
                onClick={() => eduArray.remove(i)}
                className="type-label inline-flex items-center gap-2 self-end text-mute transition-colors hover:text-state-error"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
                Remove
              </button>
            </li>
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
          className="type-label mt-4 inline-flex items-center gap-2 rounded-pill border border-hairline-strong px-5 py-2 text-ink transition-colors hover:border-ink"
        >
          <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          Add education
        </button>
      </fieldset>

      {/* Skills — comma-separated textarea, converted on blur */}
      <fieldset>
        <legend className="type-label uppercase tracking-wider text-mute mb-4">
          Skills
        </legend>
        <textarea
          className={inputCls}
          rows={3}
          placeholder="TypeScript, React, Convex (comma-separated)"
          defaultValue={profile.skills.join(", ")}
          onBlur={(e) =>
            form.setValue(
              "skills",
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </fieldset>

      {/* Actions */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="type-label rounded-pill bg-ink px-6 py-3 text-paper transition-colors hover:bg-ink-deep disabled:opacity-50"
        >
          {form.formState.isSubmitting ? "Saving…" : "Save and mark reviewed"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="type-label text-mute transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
