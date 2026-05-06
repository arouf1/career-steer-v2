"use client";

import { SignInButton } from "@clerk/nextjs";
import { Search, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Props = {
  guideTitle: string;
  variant: "anonymous" | "signed-in";
  onSearchLive?: () => void;
  searchLivePending?: boolean;
  signInRedirectUrl: string;
};

export function JobsForGuideEmpty({
  guideTitle,
  variant,
  onSearchLive,
  searchLivePending,
  signInRedirectUrl,
}: Props) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Briefcase
          className="mt-0.5 size-5 text-muted-foreground"
          aria-hidden
        />
        <div>
          <p className="text-sm font-medium">
            No cached postings for {guideTitle} yet
          </p>
          <p className="text-xs text-muted-foreground">
            {variant === "anonymous"
              ? "Sign in and we'll search live for jobs near you."
              : "Search live to pull fresh postings into the cache."}
          </p>
        </div>
      </div>
      {variant === "anonymous" ? (
        <SignInButton mode="modal" forceRedirectUrl={signInRedirectUrl}>
          <Button size="sm">Sign in to search</Button>
        </SignInButton>
      ) : (
        <Button size="sm" onClick={onSearchLive} disabled={searchLivePending}>
          <Search className="mr-1.5 size-4" aria-hidden />
          {searchLivePending ? "Searching…" : "Search live"}
        </Button>
      )}
    </Card>
  );
}
