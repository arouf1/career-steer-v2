"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { useUser, useClerk } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const CONFIRM_PHRASE = "DELETE";

const DATA_CLASSES = [
  "Your résumé profile and AI enrichments",
  "Career paths, guide personalizations, and discover state",
  "Saved guides and discover reactions",
  "People search results and outreach drafts",
  "Your Clerk account and active sessions",
];

type Status =
  | { kind: "idle" }
  | { kind: "deleting-data" }
  | { kind: "closing-account" }
  | { kind: "signing-out" }
  | { kind: "error"; message: string }
  | { kind: "partial"; message: string };

interface Props {
  trigger: React.ReactNode;
}

export function DeleteAccountDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const router = useRouter();
  const deleteAccount = useMutation(api.users.deleteAccount);
  const { user } = useUser();
  const { signOut } = useClerk();

  const inFlight =
    status.kind === "deleting-data" ||
    status.kind === "closing-account" ||
    status.kind === "signing-out";

  const canConfirm = confirmInput === CONFIRM_PHRASE && !inFlight && !!user;

  function reset() {
    setConfirmInput("");
    setStatus({ kind: "idle" });
  }

  async function onConfirm() {
    if (!canConfirm || !user) return;

    // Step 1 — Convex cascade. If this throws, nothing is destroyed yet.
    setStatus({ kind: "deleting-data" });
    try {
      await deleteAccount({});
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't remove your data.";
      setStatus({ kind: "error", message });
      return;
    }

    // Step 2 — Clerk delete. If this fails, Convex data is already gone.
    // We surface a partial-success message and stop short of redirect so the
    // user actually reads it. The Clerk webhook is the safety net that runs
    // the Convex cascade idempotently when Clerk is eventually deleted.
    setStatus({ kind: "closing-account" });
    try {
      await user.delete();
    } catch {
      setStatus({
        kind: "partial",
        message:
          "Your data has been removed, but closing the sign-in account hit a snag. Please contact support to finish closing it.",
      });
      return;
    }

    // Step 3 — sign out + redirect home (Clerk session is already invalid,
    // this is belt-and-braces).
    setStatus({ kind: "signing-out" });
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      router.replace("/");
    }
  }

  function onOpenChange(next: boolean) {
    if (inFlight) return;
    setOpen(next);
    if (!next) reset();
  }

  const primaryLabel =
    status.kind === "deleting-data"
      ? "Removing your data…"
      : status.kind === "closing-account"
        ? "Closing account…"
        : status.kind === "signing-out"
          ? "Signing out…"
          : "Delete account";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="border border-hairline bg-paper-raised text-ink shadow-xl">
        <div className="flex flex-col gap-2">
          <DialogTitle className="type-title text-ink">
            Delete your account
          </DialogTitle>
          <DialogDescription className="type-body text-body">
            This is irreversible. Once you confirm, the following will be
            removed from career-steer:
          </DialogDescription>
        </div>

        <ul className="type-body space-y-1.5 rounded-card border border-hairline bg-paper p-4 text-body">
          {DATA_CLASSES.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true" className="text-mute">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2">
          <label htmlFor="delete-confirm" className="type-label text-ink">
            Type <span className="font-mono">{CONFIRM_PHRASE}</span> to confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            disabled={inFlight}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="delete-confirm-help"
            className="rounded-control border border-hairline-strong bg-paper px-3 py-2 type-body text-ink outline-none focus:border-ink disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p id="delete-confirm-help" className="type-caption text-mute">
            We use this to be sure. Cancel any time before confirming.
          </p>
        </div>

        {(status.kind === "error" || status.kind === "partial") && (
          <p role="alert" className="type-body text-state-error">
            {status.message}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={inFlight}
            className="type-label inline-flex items-center justify-center rounded-pill border border-hairline-strong px-5 py-2 text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="type-label inline-flex items-center justify-center rounded-pill bg-state-error px-5 py-2 text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {primaryLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
