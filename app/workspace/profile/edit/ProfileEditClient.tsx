"use client";

import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { ProfileEditForm } from "@/components/profile/ProfileEditForm";
import { WorkspaceLoadingProfile } from "@/components/workspace/WorkspaceLoading";
import { WorkspacePageHeader } from "@/components/workspace/WorkspacePageHeader";
import { ArrowLeft } from "lucide-react";

export function ProfileEditClient() {
  return (
    <>
      <AuthLoading>
        <WorkspaceLoadingProfile />
      </AuthLoading>
      <Unauthenticated>
        <div className="fade-in-view flex flex-col gap-6">
          <h1 className="type-headline text-ink">Sign in to edit.</h1>
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
        <EditShell />
      </Authenticated>
    </>
  );
}

function EditShell() {
  const router = useRouter();
  const profile = useQuery(api.profiles.current);

  if (profile === undefined) return <WorkspaceLoadingProfile />;

  if (profile === null) {
    return (
      <div className="fade-in-view flex flex-col gap-6">
        <h1 className="type-headline text-ink">No profile yet.</h1>
        <p className="type-body text-body max-w-prose">
          You need to create a profile first.
        </p>
        <Link
          href="/workspace/profile"
          className="type-label self-start rounded-pill bg-ink px-6 py-3 text-paper transition-colors hover:bg-ink-deep"
        >
          Start your profile
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <WorkspacePageHeader
        eyebrow="Profile"
        title="Edit profile"
        lede="Update your background. Changes save when you tap the bar that appears at the bottom."
        actions={
          <Link
            href="/workspace/profile"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mute transition-colors hover:text-ink"
          >
            <ArrowLeft
              className="h-3.5 w-3.5"
              strokeWidth={1.75}
              aria-hidden
            />
            Back to profile
          </Link>
        }
      />
      <ProfileEditForm
        profile={profile}
        onDone={() => router.push("/workspace/profile")}
      />
    </div>
  );
}
