"use client";

import { useMemo, useState } from "react";
import { useAction } from "convex/react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  IdCard,
  Link as LinkIcon,
  UploadCloud,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { extractText } from "@/lib/client/extract-text";
import { linkedinUrlSchema } from "@/lib/profiles/linkedin";

type Mode = "cv" | "linkedin";

type Status =
  | { kind: "idle" }
  | { kind: "extracting" }
  | { kind: "parsing" }
  | { kind: "linkedin-importing" }
  | { kind: "error"; message: string };

const ERROR_COPY: Record<string, string> = {
  UNSUPPORTED_TYPE: "We can read PDF and DOCX. Try one of those.",
  TOO_LARGE: "That file's a bit large. Try a copy under 5 MB.",
  EXTRACTION_FAILED:
    "We couldn't read this file. It might be a scan, try exporting a fresh PDF.",
  TEXT_TOO_LONG:
    "Your résumé is unusually long. Trim to the highlights and try again.",
  RATE_LIMIT:
    "You've parsed five résumés today. Take a breath; tomorrow we'll be ready again.",
  PARSE_FAILED:
    "Something on our side gave up. Try again, or wait a moment if it keeps happening.",
  INVALID_LINKEDIN_URL:
    "That doesn't look like a LinkedIn profile URL. It should contain '/in/your-handle'.",
  PRIVATE_PROFILE:
    "Your LinkedIn profile is set to private. Make it public for a moment, or upload your CV instead.",
  EXA_FAILED:
    "We couldn't reach LinkedIn just now. Try again in a moment.",
};

export function UploadCard() {
  const parseUpload = useAction(api.profiles.parseUpload);
  const parseLinkedIn = useAction(api.profiles.parseLinkedIn);
  const [mode, setMode] = useState<Mode>("cv");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragActive, setDragActive] = useState(false);
  const [linkedinInput, setLinkedinInput] = useState("");

  const isInFlight =
    status.kind === "extracting" ||
    status.kind === "parsing" ||
    status.kind === "linkedin-importing";

  // Validate the URL eagerly so we can show inline feedback and disable the
  // submit button. Empty input shows no icon, only validate once typing.
  const linkedinValidation = useMemo(() => {
    if (linkedinInput.trim().length === 0) return null;
    const res = linkedinUrlSchema.safeParse(linkedinInput.trim());
    return res.success ? { ok: true as const } : { ok: false as const };
  }, [linkedinInput]);

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

  async function onLinkedinSubmit() {
    if (isInFlight) return;
    if (!linkedinValidation?.ok) return;
    setStatus({ kind: "linkedin-importing" });
    const result = await parseLinkedIn({ url: linkedinInput.trim() });
    if (!result.ok) {
      setStatus({
        kind: "error",
        message: ERROR_COPY[result.error] ?? "Something went wrong.",
      });
      return;
    }
    setStatus({ kind: "idle" });
  }

  function handleDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!isInFlight) setDragActive(true);
  }
  function handleDragEnter(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!isInFlight) setDragActive(true);
  }
  function handleDragLeave(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }
  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !isInFlight) onFile(file);
  }

  function handleSwitchMode(next: Mode) {
    if (isInFlight) return;
    if (next === mode) return;
    setMode(next);
    if (status.kind === "error") setStatus({ kind: "idle" });
  }

  const cvBodyText =
    status.kind === "extracting"
      ? "Reading your résumé."
      : status.kind === "parsing"
        ? "Thinking about what we read. About ten seconds."
        : "Drop a résumé here and we'll read it carefully.";

  const linkedinBodyText =
    status.kind === "linkedin-importing"
      ? "Reading your LinkedIn profile. About fifteen seconds."
      : "Paste your public LinkedIn URL, we'll read it carefully.";

  return (
    <article className="w-full rounded-card border border-hairline bg-paper-raised p-6 sm:p-8">
      {/* Segmented toggle: CV / LinkedIn */}
      <div
        role="tablist"
        aria-label="Profile import source"
        className="mb-8 inline-flex w-full items-center gap-1 rounded-pill border border-hairline bg-paper p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "cv"}
          onClick={() => handleSwitchMode("cv")}
          disabled={isInFlight}
          className={`type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill px-4 py-2.5 transition-colors disabled:cursor-not-allowed ${
            mode === "cv"
              ? "bg-paper-raised text-ink"
              : "text-mute hover:text-ink"
          }`}
        >
          <FileText className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          Upload CV
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "linkedin"}
          onClick={() => handleSwitchMode("linkedin")}
          disabled={isInFlight}
          className={`type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill px-4 py-2.5 transition-colors disabled:cursor-not-allowed ${
            mode === "linkedin"
              ? "bg-paper-raised text-ink"
              : "text-mute hover:text-ink"
          }`}
        >
          <IdCard className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          LinkedIn
        </button>
      </div>

      {mode === "cv" ? (
        <label
          htmlFor="resume-upload"
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`block cursor-pointer rounded-card border bg-paper px-6 py-12 text-center transition-colors ${
            dragActive
              ? "border-solid border-ink"
              : "border-dashed border-hairline-strong hover:border-ink"
          }`}
        >
          <UploadCloud
            className="mx-auto mb-4 h-8 w-8 text-mute"
            aria-hidden="true"
            strokeWidth={1.25}
          />
          <h3 className="type-title text-ink">CV or career profile</h3>
          <p className="type-body mt-2 mx-auto max-w-sm text-body">
            {cvBodyText}
          </p>
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
      ) : (
        <div className="rounded-card border border-dashed border-hairline-strong bg-paper px-6 py-12 text-center">
          <LinkIcon
            className="mx-auto mb-4 h-8 w-8 text-mute"
            aria-hidden="true"
            strokeWidth={1.25}
          />
          <h3 className="type-title text-ink">LinkedIn profile</h3>
          <p className="type-body mt-2 mx-auto max-w-sm text-body">
            {linkedinBodyText}
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onLinkedinSubmit();
            }}
            className="mx-auto mt-6 flex w-full max-w-md flex-col gap-3"
          >
            <div className="relative w-full">
              <input
                type="url"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                placeholder="https://linkedin.com/in/your-handle"
                value={linkedinInput}
                onChange={(e) => setLinkedinInput(e.target.value)}
                disabled={isInFlight}
                aria-label="LinkedIn profile URL"
                aria-invalid={
                  linkedinValidation ? !linkedinValidation.ok : undefined
                }
                className="type-body w-full rounded-control border border-hairline-strong bg-paper-raised px-4 py-2.5 pr-10 text-ink outline-none transition-colors placeholder:text-mute focus:border-ink disabled:cursor-not-allowed disabled:opacity-60"
              />
              {linkedinValidation?.ok && (
                <CheckCircle2
                  className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-500/80"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
              )}
              {linkedinValidation && !linkedinValidation.ok && (
                <AlertCircle
                  className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-amber-500/80"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
              )}
            </div>
            <button
              type="submit"
              disabled={
                isInFlight || !linkedinValidation || !linkedinValidation.ok
              }
              className="type-label inline-flex items-center justify-center gap-2 self-center rounded-pill bg-ink px-6 py-2.5 text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status.kind === "linkedin-importing" ? "Reading…" : "Import"}
            </button>
          </form>

          <p className="type-caption mt-6 text-mute">
            Public profiles only, we don't sign in on your behalf.
          </p>
        </div>
      )}

      {status.kind === "error" && (
        <p role="alert" className="type-body mt-4 text-state-error">
          {status.message}
        </p>
      )}
    </article>
  );
}
