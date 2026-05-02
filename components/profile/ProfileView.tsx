"use client";

import { Pencil, Trash2 } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";

type Props = {
  profile: Doc<"profiles">;
  onEdit: () => void;
};

export function ProfileView({ profile, onEdit }: Props) {
  const name = profile.name || null;
  const headline = profile.headline || null;
  const summary = profile.summary || null;
  const location = profile.location || null;

  return (
    <article className="flex flex-col gap-24">
      <header className="flex flex-col gap-3">
        {name && (
          <h1 className="type-display text-ink">{name}</h1>
        )}
        {headline && (
          <p className="type-body-lg text-body">{headline}</p>
        )}
        {location && (
          <p className="type-caption text-mute">{location}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onEdit}
            className="type-label inline-flex items-center gap-2 rounded-pill border border-hairline-strong px-5 py-2 text-ink transition-colors hover:border-ink"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
            Edit profile
          </button>
          <DeleteAccountDialog
            trigger={
              <button
                type="button"
                className="type-label inline-flex items-center gap-2 rounded-pill border border-state-error/40 px-5 py-2 text-state-error transition-colors hover:border-state-error hover:bg-state-error/5"
              >
                <Trash2
                  className="h-4 w-4"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
                Delete account
              </button>
            }
          />
        </div>
      </header>

      {summary && (
        <section>
          <h2 className="type-label uppercase tracking-wider text-mute">
            Summary
          </h2>
          <p className="type-body-lg text-body mt-4 max-w-prose">{summary}</p>
        </section>
      )}

      {profile.experience.length > 0 && (
        <section>
          <h2 className="type-label uppercase tracking-wider text-mute">
            Experience
          </h2>
          <ul className="mt-6 flex flex-col gap-10">
            {profile.experience.map((entry, i) => (
              <li key={i} className="flex flex-col gap-1">
                <p className="type-title text-ink">
                  {entry.title}
                  <span className="text-body"> &middot; {entry.company}</span>
                </p>
                {(entry.startDate || entry.endDate) && (
                  <p className="type-caption text-mute mt-0.5">
                    {entry.startDate ?? "—"}{" "}
                    &ndash;{" "}
                    {entry.endDate ?? "Present"}
                  </p>
                )}
                {entry.description && (
                  <p className="type-body text-body mt-2 max-w-prose">
                    {entry.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.education.length > 0 && (
        <section>
          <h2 className="type-label uppercase tracking-wider text-mute">
            Education
          </h2>
          <ul className="mt-6 flex flex-col gap-8">
            {profile.education.map((entry, i) => (
              <li key={i} className="flex flex-col gap-1">
                <p className="type-title text-ink">{entry.school}</p>
                {(entry.degree || entry.field) && (
                  <p className="type-body text-body">
                    {[entry.degree, entry.field].filter(Boolean).join(", ")}
                  </p>
                )}
                {(entry.startDate || entry.endDate) && (
                  <p className="type-caption text-mute mt-0.5">
                    {entry.startDate ?? "—"}{" "}
                    &ndash;{" "}
                    {entry.endDate ?? "—"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.skills.length > 0 && (
        <section>
          <h2 className="type-label uppercase tracking-wider text-mute">
            Skills
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {profile.skills.map((skill) => (
              <li
                key={skill}
                className="type-caption rounded-pill border border-hairline bg-paper px-3 py-1 text-body"
              >
                {skill}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
