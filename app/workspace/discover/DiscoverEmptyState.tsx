// app/workspace/discover/DiscoverEmptyState.tsx
"use client";
import { Compass } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export function DiscoverGenerating() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <Compass className="size-16 animate-pulse text-ink/40" />
      <div className="space-y-2">
        <h2 className="text-lg font-medium text-ink">Building your discover canvas</h2>
        <p className="text-sm text-ink/60">This should only take a moment.</p>
      </div>
      <div className="flex w-full max-w-3xl gap-4">
        <Skeleton className="h-32 flex-1 rounded-lg" />
        <Skeleton className="h-32 flex-1 rounded-lg" />
        <Skeleton className="h-32 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

export function DiscoverFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-medium text-ink">We couldn&apos;t build your canvas</h2>
      <p className="max-w-sm text-sm text-ink/60">
        Something went wrong while matching you to guides. Try again — if it keeps failing, head to your profile and make sure it&apos;s complete.
      </p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}
