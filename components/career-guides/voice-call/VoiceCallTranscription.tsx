"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Props = {
  messages: TranscriptMessage[];
  currentAssistantUtterance: string;
  callState: "idle" | "connecting" | "connected" | "ended" | "error";
};

/**
 * Live transcript view — rendered as the modal centerpiece when the user
 * toggles away from the Rive animation. Each completed message is shown as
 * a labelled line; the in-flight assistant utterance streams in with a
 * blinking caret.
 */
export function VoiceCallTranscription({
  messages,
  currentAssistantUtterance,
  callState,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveText = currentAssistantUtterance.trim();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, liveText]);

  if (callState !== "connected" && callState !== "connecting") {
    return null;
  }

  const hasContent = messages.length > 0 || liveText.length > 0;

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-2">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="h-full"
      >
        <div
          ref={scrollRef}
          className="bg-paper-raised border-hairline h-full max-h-[280px] overflow-y-auto rounded-card border p-4"
          aria-live="polite"
        >
          {!hasContent ? (
            <p className="text-center text-[13px] text-mute">
              Say hi to start. Live captions will appear here.
            </p>
          ) : (
            <div className="space-y-2.5">
              {messages.map((m) => (
                <div key={m.id} className="text-[13px] leading-relaxed">
                  <span
                    className={cn(
                      "font-medium",
                      m.role === "user" ? "text-ink" : "text-ink/55",
                    )}
                  >
                    {m.role === "user" ? "You" : "Adviser"}:
                  </span>{" "}
                  <span className="text-ink/65">{m.content}</span>
                </div>
              ))}
              {liveText.length > 0 && (
                <div className="text-[13px] leading-relaxed">
                  <span className="font-medium text-ink/55">Adviser:</span>{" "}
                  <span className="text-ink/65">
                    {liveText}
                    <motion.span
                      animate={{ opacity: [1, 0] }}
                      transition={{ repeat: Infinity, duration: 0.8 }}
                      className="ml-0.5 inline-block text-ink/30"
                    >
                      |
                    </motion.span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
