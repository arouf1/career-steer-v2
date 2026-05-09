// app/workspace/saved-guides/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SavedGuidesClient } from "./SavedGuidesClient";
import { WorkspacePageShell } from "@/components/workspace/WorkspacePageShell";

export const metadata = {
  title: "Saved guides",
  description: "Career guides you've bookmarked from Career Compass.",
};

export default async function SavedGuidesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return (
    <WorkspacePageShell>
      <SavedGuidesClient />
    </WorkspacePageShell>
  );
}
