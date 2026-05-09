"use client";

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { UploadCard } from "@/components/profile/UploadCard";
import { ProfileView } from "@/components/profile/ProfileView";
import { ReviewCallout } from "@/components/profile/ReviewCallout";
import { GuidesForYou } from "@/components/profile/GuidesForYou";
import { LocationStep } from "@/components/profile/LocationStep";
import { WorkspacePageShell } from "@/components/workspace/WorkspacePageShell";
import { WorkspaceLoadingProfile } from "@/components/workspace/WorkspaceLoading";
import { GetStartedSidebarPill } from "@/components/profile/GetStartedSidebarPill";

// Re-export under the local name the rest of this file already references,
// so the swap is contained.
const ProfileLoadingSkeleton = WorkspaceLoadingProfile;

export default function ProfilePage() {
  return (
    <WorkspacePageShell>
      <AuthLoading>
        <ProfileLoadingSkeleton />
      </AuthLoading>
      <Unauthenticated>
        <div className="fade-in-view flex flex-col gap-6">
          <h1 className="type-headline text-ink">Sign in to start.</h1>
          <p className="type-body text-body max-w-prose">
            Your profile is the foundation. Sign in and we&rsquo;ll get you
            reading your résumé in seconds.
          </p>
          <SignInButton mode="modal">
            <button
              type="button"
              className="type-label self-start rounded-pill bg-ink px-6 py-3 text-paper transition-colors hover:bg-ink-deep"
            >
              Sign in
            </button>
          </SignInButton>
        </div>
      </Unauthenticated>
      <Authenticated>
        <GetStartedSidebarPill />
        <ProfileShell />
      </Authenticated>
    </WorkspacePageShell>
  );
}

function ProfileShell() {
  const profile = useQuery(api.profiles.current);
  const clear = useMutation(api.profiles.clear);

  if (profile === undefined) {
    return <ProfileLoadingSkeleton />;
  }

  if (profile === null) {
    return <UploadCard />;
  }

  // Step 2 of profile setup: the user must confirm their location
  // before the rest of the profile UI unlocks. Pre-filled with whatever
  // the LLM extracted from the CV/LinkedIn — the user just confirms or
  // edits. Once confirmed, locationConfirmedAt is set and we never come
  // back through this gate for this profile.
  if (profile.locationConfirmedAt === undefined) {
    return <LocationStep initialLocation={profile.location ?? null} />;
  }

  const fieldCount =
    Number(!!profile.name) +
    Number(!!profile.headline) +
    Number(!!profile.summary) +
    Number(!!profile.location) +
    profile.experience.length +
    profile.education.length +
    profile.skills.length;

  function handleReupload() {
    const confirmed = window.confirm(
      "This will replace what we noticed. Continue?",
    );
    if (confirmed) {
      void clear({});
    }
  }

  return (
    <div className="fade-in-view flex flex-col gap-10">
      {!profile.reviewed && (
        <ReviewCallout
          fieldCount={fieldCount}
          onReupload={handleReupload}
        />
      )}
      <ProfileView profile={profile} />
      <GuidesForYou />
    </div>
  );
}
