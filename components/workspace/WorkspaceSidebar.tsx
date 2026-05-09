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
  X,
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
  useSidebar,
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
  const { isMobile, setOpenMobile } = useSidebar();

  const isOn = (url: string) =>
    pathname === url || pathname.startsWith(url + "/");

  // Close the mobile sheet on navigation. Desktop is no-op (the sidebar
  // is a persistent rail there). Wired onto every nav-item Link so any
  // route change collapses the sheet automatically.
  const handleNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      {/* h-14 spacer aligns nav items with the topbar baseline.
          - Desktop collapsed: PanelLeft trigger appears at the left to expand
          - Desktop expanded: header is empty (topbar carries the collapse)
          - Mobile open (sheet): X close button at top-right */}
      <SidebarHeader className="h-14 flex items-center justify-between px-2">
        <SidebarTrigger className="group-data-[state=expanded]:hidden md:flex hidden" />
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpenMobile(false)}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-mute transition-colors hover:bg-paper-raised hover:text-ink md:hidden"
        >
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </button>
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
                      <Link href={item.url} onClick={handleNavigate}>
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
                              <Link href={child.url} onClick={handleNavigate}>
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
