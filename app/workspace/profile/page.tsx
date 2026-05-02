"use client";

import { useState } from "react";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { SiteNav } from "@/components/site/SiteNav";
import { UploadCard } from "@/components/profile/UploadCard";
import { ProfileView } from "@/components/profile/ProfileView";
import { ProfileEditForm } from "@/components/profile/ProfileEditForm";
import { ReviewCallout } from "@/components/profile/ReviewCallout";
import { GuidesForYou } from "@/components/profile/GuidesForYou";

export default function ProfilePage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-5xl px-6 py-12 md:py-20">
        <AuthLoading>
          <p className="type-body text-mute">Loading…</p>
        </AuthLoading>
        <Unauthenticated>
          <div className="flex flex-col gap-6">
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
          <ProfileShell />
        </Authenticated>
      </main>
    </>
  );
}

function ProfileShell() {
  const profile = useQuery(api.profiles.current);
  const clear = useMutation(api.profiles.clear);
  const [editing, setEditing] = useState(false);

  if (profile === undefined) {
    return <p className="type-body text-mute">Loading…</p>;
  }

  if (profile === null) {
    return <UploadCard />;
  }

  if (editing) {
    return <ProfileEditForm profile={profile} onDone={() => setEditing(false)} />;
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
    <div className="flex flex-col gap-10">
      {!profile.reviewed && (
        <ReviewCallout
          fieldCount={fieldCount}
          onEdit={() => setEditing(true)}
          onReupload={handleReupload}
        />
      )}
      <ProfileView profile={profile} onEdit={() => setEditing(true)} />
      <GuidesForYou />
    </div>
  );
}
