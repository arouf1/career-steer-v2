"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type KeyPeopleState =
  | "anonymous"
  | "idle"
  | "running"
  | "ready"
  | "failed";

export function useKeyPeople(guideId: Id<"career_guides">) {
  const result = useQuery(api.people.listForGuide, { guideId });
  const trigger = useMutation(api.people.triggerSearch);
  const [retryAfterMs, setRetryAfterMs] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setActionError(null);
    setRetryAfterMs(null);
    const res = await trigger({ guideId });
    if (!res.ok) {
      if (res.reason === "rate-limited") {
        setRetryAfterMs(res.retryAfterMs ?? 60_000);
      } else if (res.reason === "anonymous") {
        setActionError("Sign in to find people in this field.");
      }
    }
  }, [guideId, trigger]);

  return {
    loading: result === undefined,
    state: (result?.state ?? "anonymous") as KeyPeopleState,
    people: result?.people ?? [],
    serverError: result?.error ?? null,
    actionError,
    retryAfterMs,
    search,
  };
}
