// components/workspace/conversations/ConversationTranscript.tsx
//
// Scrollable chat-bubble panel for a voice conversation transcript.
// User messages: right-aligned, bg-ink / text-paper.
// Assistant messages: left-aligned, bg-paper-raised / text-ink.
// Each bubble shows the message body, a small time footer, and optional
// grounding-citation links below the body.

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GroundingCitation = {
  url: string;
  title?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  transcriptConfidence?: number;
  groundingCitations?: GroundingCitation[];
};

type Props = {
  messages: Message[];
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Citation({ citation }: { citation: GroundingCitation }) {
  const display = citation.title ?? (() => {
    try {
      return new URL(citation.url).hostname;
    } catch {
      return citation.url;
    }
  })();

  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block truncate text-[10px] text-mute underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
    >
      {display}
    </a>
  );
}

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "flex max-w-[75%] flex-col gap-1.5 rounded-card px-4 py-3",
          isUser
            ? "rounded-tr-control bg-ink text-paper"
            : "rounded-tl-control bg-paper-raised text-ink",
        )}
      >
        {/* Message body */}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>

        {/* Grounding citations */}
        {message.groundingCitations && message.groundingCitations.length > 0 && (
          <div
            className={cn(
              "mt-1 flex flex-col gap-0.5 border-t pt-1.5",
              isUser ? "border-paper/20" : "border-hairline",
            )}
          >
            {message.groundingCitations.map((c, i) => (
              <Citation key={`${c.url}-${i}`} citation={c} />
            ))}
          </div>
        )}

        {/* Timestamp footer */}
        <span
          className={cn(
            "mt-0.5 self-end text-[10px] leading-none",
            isUser ? "text-paper/50" : "text-mute",
          )}
        >
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConversationTranscript({ messages, className }: Props) {
  if (messages.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <p className="text-sm text-mute">No transcript captured for this conversation.</p>
      </div>
    );
  }

  return (
    <ScrollArea className={cn("max-h-[60vh] w-full", className)}>
      <div className="flex flex-col gap-3 px-4 py-4">
        {messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}
      </div>
    </ScrollArea>
  );
}
