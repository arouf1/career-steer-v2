"use client";

import { useEffect } from "react";
import { useStateMachineInput } from "@rive-app/react-webgl2";

type Props = {
  RiveComponent: React.ComponentType<{ className: string }>;
  rive: unknown; // Rive instance — typed as unknown because the SDK doesn't export the runtime type cleanly
};

/**
 * Halo animation for the active call. The .riv file lives at
 * /halo-2.0.riv and was lifted directly from V1. The state machine is
 * named "default"; the listening / thinking / speaking inputs are driven
 * by the parent (DeepDiveCallDialog) so this file only handles the
 * imperative-handle setup and the colour-mode hook.
 */
export function VoiceCallAnimation({ RiveComponent, rive }: Props) {
  const colorModeInput = useStateMachineInput(
    rive as Parameters<typeof useStateMachineInput>[0],
    "default",
    "color",
  );

  // Push light/dark mode into the Rive state machine. Rive's input is an
  // imperative handle — `.value =` is the documented setter and is intended
  // to be called from a useEffect. The eslint-react-hooks immutability rule
  // can't distinguish this from mutating React state, hence the suppression.
  useEffect(() => {
    if (!colorModeInput || typeof window === "undefined") return;
    const isDark = document.documentElement.classList.contains("dark");
    // eslint-disable-next-line react-hooks/immutability
    colorModeInput.value = isDark ? 3 : 1;
  }, [colorModeInput]);

  useEffect(() => {
    if (!colorModeInput || typeof window === "undefined") return;
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      // eslint-disable-next-line react-hooks/immutability
      colorModeInput.value = isDark ? 3 : 1;
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [colorModeInput]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-6">
      <div className="relative flex h-56 w-56 items-center justify-center">
        <div className="absolute inset-2 rounded-full bg-ink/[0.04]" />
        <RiveComponent className="relative z-10 h-full w-full" />
      </div>
    </div>
  );
}
