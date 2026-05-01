"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useStreamingUIMessages } from "@convex-dev/agent/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { OutreachType } from "@/lib/ai/prompts/outreach";

type Args = {
  personId: Id<"key_people">;
};

export function useOutreachDraft({ personId }: Args) {
  const [outreachType, setOutreachType] = useState<OutreachType | null>(null);
  const [customIntent, setCustomIntent] = useState("");
  const [editedMessage, setEditedMessage] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const lastErrorRef = useRef<number | null>(null);

  const startOutreach = useMutation(api.peopleOutreach.startOutreach);

  // Most recent finished draft for this person — used to render the
  // previous result on revisit without re-streaming.
  const lastDraft = useQuery(api.peopleOutreach.getMostRecentDraftForPerson, {
    personId,
  });

  const streamingMessages = useStreamingUIMessages(
    api.peopleOutreach.listStreams,
    threadId ? { threadId } : "skip",
  );

  const record = useQuery(
    api.peopleOutreach.getOutreach,
    threadId ? { threadId } : "skip",
  );

  const streamedText = useMemo(() => {
    if (!streamingMessages?.length) return "";
    return streamingMessages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.parts)
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  }, [streamingMessages]);

  // Pick the live source of truth for what the textarea should contain.
  // Priority: user edits > active stream > finished thread > restored draft.
  const baseMessage =
    streamedText.length > 0
      ? streamedText
      : record?.status === "done" && record.finalMessage
        ? record.finalMessage
        : !threadId && lastDraft?.finalMessage
          ? lastDraft.finalMessage
          : "";
  const message = editedMessage !== null ? editedMessage : baseMessage;

  const isGenerating =
    isStarting ||
    (threadId !== null &&
      record?.status !== "done" &&
      record?.status !== "error");

  // If the user lands with a previously drafted thread for this person, sync
  // the active outreach type so the intent button highlights correctly.
  // We don't touch threadId so a "Try again" still creates a new thread.
  useEffect(() => {
    if (threadId !== null) return;
    if (lastDraft?.outreachType && !outreachType) {
      setOutreachType(lastDraft.outreachType as OutreachType);
    }
  }, [lastDraft?.outreachType, outreachType, threadId]);

  // Surface server-side errors once per generation.
  useEffect(() => {
    if (record?.status !== "error") return;
    const key = record._creationTime ?? 0;
    if (lastErrorRef.current === key) return;
    lastErrorRef.current = key;
    setActionError(record.error ?? "Failed to draft message. Try again.");
  }, [record]);

  const generate = useCallback(
    async (typeOverride?: OutreachType) => {
      const type = typeOverride ?? outreachType;
      if (!type) return;
      if (type === "custom" && !customIntent.trim()) {
        setActionError("Add a short note about your intent first.");
        return;
      }
      setEditedMessage(null);
      setActionError(null);
      setIsStarting(true);
      try {
        const res = await startOutreach({
          personId,
          outreachType: type,
          customIntent: type === "custom" ? customIntent.trim() : undefined,
        });
        if (!res.ok) {
          if (res.reason === "rate-limited") {
            setActionError(
              "You've hit the outreach drafting limit. Try again in a bit.",
            );
          } else if (res.reason === "not-found") {
            setActionError("That person is no longer available.");
          } else {
            setActionError("Sign in to draft a message.");
          }
          return;
        }
        setThreadId(res.threadId);
      } catch {
        setActionError("Failed to draft message. Try again.");
      } finally {
        setIsStarting(false);
      }
    },
    [customIntent, outreachType, personId, startOutreach],
  );

  const selectOutreachType = useCallback(
    (type: OutreachType) => {
      setOutreachType(type);
      if (type !== "custom") {
        void generate(type);
      }
    },
    [generate],
  );

  const setMessage = useCallback(
    (value: string | ((prev: string) => string)) => {
      if (typeof value === "function") {
        setEditedMessage((prev) => value(prev ?? baseMessage));
      } else {
        setEditedMessage(value);
      }
    },
    [baseMessage],
  );

  return {
    outreachType,
    selectOutreachType,
    customIntent,
    setCustomIntent,
    message,
    setMessage,
    isGenerating,
    generate,
    actionError,
    clearError: () => setActionError(null),
    hasDraft: message.length > 0,
  };
}
