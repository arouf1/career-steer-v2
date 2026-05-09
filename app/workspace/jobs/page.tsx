// app/workspace/jobs/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { JobSearchClient } from "./JobSearchClient";
import { WorkspacePageShell } from "@/components/workspace/WorkspacePageShell";

export const metadata = {
  title: "Jobs",
  description: "Search live job listings via Google Jobs.",
};

export default async function JobsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return (
    <WorkspacePageShell>
      <JobSearchClient />
    </WorkspacePageShell>
  );
}
