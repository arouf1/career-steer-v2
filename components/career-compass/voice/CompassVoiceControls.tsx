"use client";

import { Mic, MicOff, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  isMuted: boolean;
  onToggleMute: () => void;
  onEndCall: () => void;
};

/**
 * Compact in-dock control pair for an active compass call. Sized for a 64px
 * dock — smaller than the modal call's circular buttons, but still big
 * enough to hit on touch.
 */
export function CompassVoiceControls({
  isMuted,
  onToggleMute,
  onEndCall,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggleMute}
        aria-pressed={isMuted}
        aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        // Sits on a bg-ink dock — idle/unmuted state uses a translucent paper
        // wash so the icon sits quietly; muted flips to a red wash so the
        // mute affordance is unmistakable mid-call.
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-200",
          isMuted
            ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
            : "bg-paper/10 text-paper/75 hover:bg-paper/15 hover:text-paper",
        )}
      >
        {isMuted ? (
          <MicOff className="h-3.5 w-3.5" strokeWidth={1.75} />
        ) : (
          <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        onClick={onEndCall}
        aria-label="End call"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white transition-colors duration-200 hover:bg-red-700"
      >
        <PhoneOff className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
