"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  User,
  Compass,
  Briefcase,
  Bookmark,
  BookOpen,
  ArrowUpRight,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupContent,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const items = [
  { title: "Profile", url: "/workspace/profile", icon: User, external: false },
  { title: "Career Compass", url: "/workspace/career-compass", icon: Compass, external: false },
  { title: "Jobs", url: "/workspace/jobs", icon: Briefcase, external: false },
  { title: "Saved guides", url: "/workspace/saved-guides", icon: Bookmark, external: false },
  { title: "Career guides", url: "/career-guides", icon: BookOpen, external: true },
] as const;

export function WorkspaceSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      {/* h-14 spacer aligns nav items with the topbar baseline. The trigger
          appears only when collapsed — when expanded, the topbar carries the
          collapse affordance instead. */}
      <SidebarHeader className="h-14 flex items-center justify-center px-2">
        <SidebarTrigger className="group-data-[state=expanded]:hidden" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="pt-1">
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active =
                  !item.external &&
                  (pathname === item.url || pathname.startsWith(item.url + "/"));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                        {item.external && (
                          <ArrowUpRight className="ml-auto size-3.5 opacity-60" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {/* UserButton lives in the top bar; footer reserved for future settings link. */}
      </SidebarFooter>
    </Sidebar>
  );
}
