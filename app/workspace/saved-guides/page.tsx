// app/workspace/saved-guides/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SavedGuidesClient } from "./SavedGuidesClient";

export const metadata = {
  title: "Saved guides",
  description: "Career guides you've bookmarked from Career Compass.",
};

export default async function SavedGuidesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SavedGuidesClient />
    </div>
  );
}
