"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { FileText, IdCard, UploadCloud } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { extractText } from "@/lib/client/extract-text";

type Status =
  | { kind: "idle" }
  | { kind: "extracting" }
  | { kind: "parsing" }
  | { kind: "error"; message: string };

const ERROR_COPY: Record<string, string> = {
  UNSUPPORTED_TYPE: "We can read PDF and DOCX. Try one of those.",
  TOO_LARGE: "That file's a bit large. Try a copy under 5 MB.",
  EXTRACTION_FAILED:
    "We couldn't read this file. It might be a scan — try exporting a fresh PDF.",
  TEXT_TOO_LONG:
    "Your résumé is unusually long. Trim to the highlights and try again.",
  RATE_LIMIT:
    "You've parsed five résumés today. Take a breath; tomorrow we'll be ready again.",
  PARSE_FAILED:
    "Something on our side gave up. Try again — or wait a moment if it keeps happening.",
};

export function UploadCard() {
  const parseUpload = useAction(api.profiles.parseUpload);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onFile(file: File) {
    setStatus({ kind: "extracting" });
    const extracted = await extractText(file);
    if (!extracted.ok) {
      setStatus({
        kind: "error",
        message: ERROR_COPY[extracted.error] ?? "Couldn't read that file.",
      });
      return;
    }
    setStatus({ kind: "parsing" });
    const result = await parseUpload({
      text: extracted.text,
      sourceFormat: extracted.sourceFormat,
    });
    if (!result.ok) {
      setStatus({
        kind: "error",
        message: ERROR_COPY[result.error] ?? "Something went wrong.",
      });
      return;
    }
    setStatus({ kind: "idle" });
  }

  const bodyText =
    status.kind === "extracting"
      ? "Reading your résumé."
      : status.kind === "parsing"
        ? "Thinking about what we read. About ten seconds."
        : "Drop a résumé here and we'll read it carefully.";

  const isInFlight = status.kind === "extracting" || status.kind === "parsing";

  return (
    <article className="w-full rounded-card border border-hairline bg-paper-raised p-6 sm:p-8">
      {/* Segmented toggle: CV (active) / LinkedIn (placeholder) */}
      <div className="mb-8 inline-flex w-full items-center gap-1 rounded-pill border border-hairline bg-paper p-1">
        <span className="type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill bg-paper-raised px-4 py-2.5 text-ink">
          <FileText className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          Upload CV
        </span>
        <span
          aria-disabled="true"
          className="type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill px-4 py-2.5 text-mute opacity-60"
          title="Coming soon"
        >
          <IdCard className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          LinkedIn
        </span>
      </div>

      {/* Drop zone — the entire label is the affordance, no separate Browse button */}
      <label
        htmlFor="resume-upload"
        className="block cursor-pointer rounded-card border border-dashed border-hairline-strong bg-paper px-6 py-12 text-center transition-colors hover:border-ink"
      >
        <UploadCloud
          className="mx-auto mb-4 h-8 w-8 text-mute"
          aria-hidden="true"
          strokeWidth={1.25}
        />
        <h3 className="type-title text-ink">CV or career profile</h3>
        <p className="type-body mt-2 mx-auto max-w-sm text-body">{bodyText}</p>
        <p className="type-caption mt-6 text-mute">Supports PDF and DOCX.</p>
        <input
          id="resume-upload"
          type="file"
          accept=".pdf,.docx"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
          disabled={isInFlight}
        />
      </label>

      {status.kind === "error" && (
        <p role="alert" className="type-body mt-4 text-state-error">
          {status.message}
        </p>
      )}
    </article>
  );
}
