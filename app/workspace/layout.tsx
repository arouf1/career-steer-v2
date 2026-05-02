import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar";
import { WorkspaceMain } from "@/components/workspace/WorkspaceMain";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <WorkspaceSidebar />
      {/* Inset matches the sidebar's paper-raised so the topbar reads as one
          continuous frame with the sidebar. WorkspaceMain flips to lighter
          paper and adds rounded-tl only when the sidebar is expanded. */}
      <SidebarInset className="bg-sidebar">
        <WorkspaceTopBar />
        <WorkspaceMain>{children}</WorkspaceMain>
      </SidebarInset>
    </SidebarProvider>
  );
}
