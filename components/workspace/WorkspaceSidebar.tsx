"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Compass, Bookmark, BookOpen, ArrowUpRight, ShipWheel } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar";

const items = [
  { title: "Profile", url: "/workspace/profile", icon: User, external: false },
  { title: "Discover", url: "/workspace/discover", icon: Compass, external: false },
  { title: "Saved guides", url: "/workspace/saved-guides", icon: Bookmark, external: false },
  { title: "Career guides", url: "/career-guides", icon: BookOpen, external: true },
] as const;

export function WorkspaceSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 px-2 py-2">
          <ShipWheel className="size-5 text-ink" />
          <span className="font-logo text-lg font-medium text-ink group-data-[collapsible=icon]:hidden">
            Career Steer
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active =
                  !item.external &&
                  (pathname === item.url || pathname.startsWith(item.url + "/"));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={active}>
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
