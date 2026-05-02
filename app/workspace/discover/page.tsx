// app/workspace/discover/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DiscoverCanvas } from "./DiscoverCanvas";
import { DiscoverMobile } from "./DiscoverMobile";

export const metadata = {
  title: "Discover",
  description: "Career guides matched to you, arranged by direction and fit.",
};

export default async function DiscoverPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Render both — Tailwind responsive classes hide the wrong one per breakpoint.
  return (
    <div className="h-[calc(100vh-3.5rem)]">
      <div className="hidden md:block h-full">
        <DiscoverCanvas />
      </div>
      <div className="md:hidden h-full">
        <DiscoverMobile />
      </div>
    </div>
  );
}
