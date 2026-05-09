"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  User,
  Compass,
  Briefcase,
  Bookmark,
  BookOpen,
  MessagesSquare,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarGroup,
  SidebarGroupContent,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const items = [
  { title: "Profile", url: "/workspace/profile", icon: User },
  {
    title: "Career guides",
    url: "/workspace/career-guides",
    icon: BookOpen,
    children: [
      {
        title: "Saved guides",
        url: "/workspace/saved-guides",
        icon: Bookmark,
      },
    ],
  },
  { title: "Career Compass", url: "/workspace/career-compass", icon: Compass },
  { title: "Jobs", url: "/workspace/jobs", icon: Briefcase },
  {
    title: "Conversations",
    url: "/workspace/conversations",
    icon: MessagesSquare,
  },
] as const;

export function WorkspaceSidebar() {
  const pathname = usePathname();

  const isOn = (url: string) =>
    pathname === url || pathname.startsWith(url + "/");

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
                const active = isOn(item.url);
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
                      </Link>
                    </SidebarMenuButton>
                    {"children" in item && item.children.length > 0 && (
                      <SidebarMenuSub>
                        {item.children.map((child) => (
                          <SidebarMenuSubItem key={child.title}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={isOn(child.url)}
                              // Mirror the parent SidebarMenuButton's at-rest
                              // muted state + text-only active lift. Default
                              // sub-button renders full-strength text and an
                              // accent-coloured icon at rest, which reads as
                              // "selected" against the muted parent rows.
                              className={cn(
                                "text-[13px]",
                                "text-sidebar-foreground/70 [&>svg]:text-sidebar-foreground/70",
                                "hover:text-sidebar-foreground hover:[&>svg]:text-sidebar-foreground",
                                "data-[active=true]:bg-transparent data-[active=true]:font-medium",
                                "data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&>svg]:text-sidebar-accent-foreground",
                              )}
                            >
                              <Link href={child.url}>
                                <child.icon />
                                <span>{child.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
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
