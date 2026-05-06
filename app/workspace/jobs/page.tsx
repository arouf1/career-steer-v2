// app/workspace/jobs/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { JobSearchClient } from "./JobSearchClient";

export const metadata = {
  title: "Jobs",
  description: "Search live job listings via Google Jobs.",
};

export default async function JobsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return (
    <div className="mx-auto max-w-4xl px-6 py-10 sm:py-14">
      <JobSearchClient />
    </div>
  );
}
