"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LocationCombobox } from "@/components/profile/LocationCombobox";

type Props = {
  initialLocation: string | null | undefined;
};

export function LocationStep({ initialLocation }: Props) {
  const confirmLocation = useMutation(api.profiles.confirmLocation);
  const [value, setValue] = useState<string | null>(initialLocation ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value?.trim() ?? "";
  const canSubmit = trimmed.length > 0 && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await confirmLocation({ location: trimmed });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save your location.",
      );
      setSubmitting(false);
    }
  };

  return (
    <section
      role="region"
      aria-label="Confirm your location"
      className="rounded-card border border-hairline bg-paper-raised p-6 sm:p-8"
    >
      <p className="type-caption uppercase tracking-[0.18em] text-mute">
        Step 2 of 2
      </p>
      <h2 className="type-headline text-ink mt-3">
        Where are you based?
      </h2>
      <p className="type-body text-body mt-4 max-w-prose">
        We use this to ground salary ranges, learning paths, and role
        recommendations in your region. You can change it any time from your
        profile.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="type-label text-ink">Location</span>
          <LocationCombobox
            value={value}
            onChange={setValue}
            placeholder="City, country"
          />
        </label>

        {error && (
          <p role="alert" className="type-caption text-state-error">
            {error}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="type-label rounded-pill bg-ink px-5 py-2.5 text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </div>
      </form>
    </section>
  );
}
