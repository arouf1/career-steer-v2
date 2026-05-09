import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ProfileEditClient } from "./ProfileEditClient";
import { WorkspacePageShell } from "@/components/workspace/WorkspacePageShell";

export const metadata = {
  title: "Edit profile",
  description: "Update your profile.",
};

export default async function EditProfilePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return (
    <WorkspacePageShell>
      <ProfileEditClient />
    </WorkspacePageShell>
  );
}
