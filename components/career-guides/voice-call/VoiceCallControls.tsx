"use client";

import { Mic, MicOff, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  callState: "idle" | "connecting" | "connected" | "ended" | "error";
  isMuted: boolean;
  isProcessing: boolean;
  onToggleMute: () => void;
  onEndCall: () => void;
  onClose: () => void;
};

/**
 * Two-state control bar matching V1's compact circular pattern, minus the
 * audio-out toggle (we don't expose remote-stream gain control yet).
 *
 *   - connecting / connected → Mute + End
 *   - ended / error          → Close
 *
 * No "Start call" — the modal is opened from the sidebar tile already in
 * connecting state, so a separate start affordance would be redundant.
 */
export function VoiceCallControls({
  callState,
  isMuted,
  isProcessing,
  onToggleMute,
  onEndCall,
  onClose,
}: Props) {
  const isLive = callState === "connecting" || callState === "connected";
  const isTerminal = callState === "ended" || callState === "error";

  return (
    <div className="flex justify-center">
      {isLive && (
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={onToggleMute}
            aria-pressed={isMuted}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            className={cn(
              "h-14 w-14 rounded-full border transition-colors duration-200",
              isMuted
                ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                : "border-hairline bg-paper-raised text-mute hover:text-ink",
            )}
          >
            {isMuted ? (
              <MicOff className="mx-auto h-5 w-5" strokeWidth={1.75} />
            ) : (
              <Mic className="mx-auto h-5 w-5" strokeWidth={1.75} />
            )}
          </button>

          <button
            type="button"
            onClick={onEndCall}
            aria-label="End call"
            className="h-14 w-14 rounded-full bg-red-600 text-white transition-colors duration-200 hover:bg-red-700"
          >
            <PhoneOff className="mx-auto h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {isTerminal && (
        <button
          type="button"
          onClick={onClose}
          disabled={isProcessing}
          aria-label="Close"
          className="h-14 w-14 rounded-full border border-hairline bg-paper-raised text-mute transition-colors duration-200 hover:text-ink disabled:opacity-50"
        >
          <PhoneOff className="mx-auto h-6 w-6" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
