// app/workspace/career-compass/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DiscoverCanvas } from "./DiscoverCanvas";
import { MobileShell } from "./mobile/MobileShell";

export const metadata = {
  title: "Career Compass",
  description: "Career guides matched to you, arranged by direction and fit.",
};

export default async function CareerCompassPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Render both — Tailwind responsive classes hide the wrong one per breakpoint.
  // h-full chains through main → SidebarInset → SidebarProvider's min-h-svh.
  // Stays correct whether or not the topbar is rendered (collapsed sidebar
  // hides the topbar but main still fills the inset).
  return (
    <div className="h-full">
      <div className="hidden md:block h-full">
        <DiscoverCanvas />
      </div>
      <div className="md:hidden h-full">
        <MobileShell />
      </div>
    </div>
  );
}
