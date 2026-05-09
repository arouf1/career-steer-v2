"use client";

import { Loader2, Search, Sparkles, Phone, AlertCircle } from "lucide-react";

export type PrepStatus =
  | "researching"
  | "synthesizing"
  | "minting_token"
  | "ready"
  | "failed";

type Props = {
  status: PrepStatus;
  detail?: string;
  error?: string;
  companyName?: string;
};

const STEPS: Array<{
  status: PrepStatus;
  label: (companyName?: string) => string;
  Icon: typeof Loader2;
}> = [
  {
    status: "researching",
    label: (c) => (c ? `Reviewing how ${c} interviews for this role…` : "Reviewing how this company interviews for this role…"),
    Icon: Search,
  },
  {
    status: "synthesizing",
    label: () => "Tuning your interviewer…",
    Icon: Sparkles,
  },
  {
    status: "minting_token",
    label: () => "Connecting…",
    Icon: Phone,
  },
];

const ORDER: Record<PrepStatus, number> = {
  researching: 0,
  synthesizing: 1,
  minting_token: 2,
  ready: 3,
  failed: -1,
};

export function InterviewPrepProgress({ status, detail, error, companyName }: Props) {
  if (status === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-mute" strokeWidth={1.5} />
        <p className="text-sm text-ink">We couldn&apos;t prepare your interviewer.</p>
        {error && <p className="text-[12px] text-mute">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-6">
      {STEPS.map((step) => {
        const idx = ORDER[step.status];
        const cur = ORDER[status];
        const done = cur > idx;
        const active = cur === idx;
        const upcoming = cur < idx;
        return (
          <div key={step.status} className="flex items-center gap-3">
            <span
              aria-hidden
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
                done ? "bg-ink/10" : active ? "bg-ink" : "bg-paper-raised"
              }`}
            >
              {active ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-paper" strokeWidth={2} />
              ) : (
                <step.Icon
                  className={`h-3.5 w-3.5 ${done ? "text-ink" : "text-mute"}`}
                  strokeWidth={1.75}
                />
              )}
            </span>
            <p
              className={`text-[13px] ${
                upcoming ? "text-mute" : "text-ink"
              }`}
            >
              {step.label(companyName ?? detail)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
