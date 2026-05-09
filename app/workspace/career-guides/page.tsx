// app/workspace/career-guides/page.tsx
//
// Workspace-native mirror of the public /career-guides index. Same search
// + generate experience as the public surface, but wrapped in the workspace
// shell so navigation from the sidebar doesn't bounce the user out of the
// workspace chrome. Guides themselves still resolve at /career-guides/[slug]
// (the public reading view) — moving the detail surface into the workspace
// is a larger refactor and out of scope here.

import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { CareerGuidesIndexClient } from "@/components/career-guides/CareerGuidesIndexClient";
import { WorkspacePageShell } from "@/components/workspace/WorkspacePageShell";
import { WorkspacePageHeader } from "@/components/workspace/WorkspacePageHeader";

export const metadata: Metadata = {
  title: "Career guides",
  description: "Explore and generate career guides without leaving the workspace.",
};

export default async function WorkspaceCareerGuidesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const guides = await fetchQuery(api.careerGuides.listAll, {});

  return (
    <WorkspacePageShell>
      <div className="fade-in-view flex flex-col gap-12">
        <WorkspacePageHeader
          eyebrow="Career guides"
          title={
            <>
              The honest guide to{" "}
              <span className="text-ink-soft">any job.</span>
            </>
          }
          lede="Search the library, or type a role we don't cover yet — we'll write it."
        />
        <CareerGuidesIndexClient guides={guides} />
      </div>
    </WorkspacePageShell>
  );
}
