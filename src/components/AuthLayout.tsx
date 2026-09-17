import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { LOGIN_PATH } from "@/const";
import { useIsMobile } from "@/hooks/use-mobile";
import { LayoutDashboard, LogIn, LogOut, PanelLeft, Presentation, Users } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { PeIconOrb, PeWordmark, SuiteMasthead } from "@/components/programs";
import { AuthLayoutSkeleton } from "./AuthLayoutSkeleton";

const menuItems = [
  { icon: LayoutDashboard, label: "Page 1", path: "/" },
  { icon: Users, label: "Page 2", path: "/some-path" },
  { icon: Presentation, label: "Presentation Center", path: "/presentation-center" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { isLoading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (isLoading) {
    return <AuthLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div
        className="odm-canvas flex flex-col min-h-screen"
        style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}
      >
        <SuiteMasthead suiteTitle="Program Oversight Center" />

        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <section
            className="pe-card w-full"
            style={{ maxWidth: 420, padding: "26px 24px 24px" }}
          >
            <div
              className="flex flex-col items-center gap-5"
              style={{ textAlign: "center" }}
            >
              <PeIconOrb icon={LogIn} tone="blue" size="lg" />

              <div className="flex flex-col items-center gap-3">
                <h1
                  style={{
                    margin: 0,
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: "-0.3px",
                    color: "var(--pe-text-strong)",
                  }}
                >
                  Sign in to continue
                </h1>
                <p
                  style={{
                    margin: 0,
                    maxWidth: 300,
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: "var(--pe-text-muted)",
                  }}
                >
                  Access to this dashboard requires authentication. Continue to
                  launch the login flow.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  window.location.href = LOGIN_PATH;
                }}
                className="pe-btn pe-btn--primary pe-focusable"
                style={{ width: "100%", padding: "10px 16px", fontSize: 13.5 }}
              >
                Sign in
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <AuthLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </AuthLayoutContent>
    </SidebarProvider>
  );
}

type AuthLayoutContentProps = {
  children: ReactNode;
  setSidebarWidth: (width: number) => void;
};

function AuthLayoutContent({
  children,
  setSidebarWidth,
}: AuthLayoutContentProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location.pathname);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"

        >
          <SidebarHeader
            className="h-16 justify-center"
            style={{ borderBottom: "1px solid var(--pe-border)" }}
          >
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors pe-focusable shrink-0"
                aria-label="Toggle navigation"
                style={{ color: "var(--pe-text-muted)" }}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              {!isCollapsed ? (
                <div className="flex flex-col gap-0.5 min-w-0">
                  {/* Suite identity lives in the shell, not in each module. */}
                  <PeWordmark size="sm" tagline={false} />
                  <span
                    className="font-semibold tracking-tight truncate"
                    style={{ fontSize: 10.5, color: "var(--pe-text-faint)" }}
                  >
                    Navigation
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location.pathname === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => navigate(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal pe-focusable`}
                      style={
                        isActive
                          ? {
                              background: "var(--pe-blue-soft)",
                              color: "var(--pe-blue-ink)",
                              fontWeight: 600,
                            }
                          : { color: "var(--pe-text)" }
                      }
                    >
                      <item.icon
                        className="h-4 w-4"
                        style={{
                          color: isActive ? "var(--pe-blue)" : "var(--pe-text-muted)",
                        }}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter
            className="p-3"
            style={{ borderTop: "1px solid var(--pe-border)" }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center pe-focusable"
                  style={{ color: "var(--pe-text)" }}
                >
                  <Avatar
                    className="h-9 w-9 border shrink-0"
                    style={{ borderColor: "var(--pe-border)" }}
                  >
                    <AvatarFallback
                      className="text-xs font-medium"
                      style={{
                        background: "var(--pe-blue-soft)",
                        color: "var(--pe-blue-ink)",
                      }}
                    >
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p
                      className="text-sm font-medium truncate leading-none"
                      style={{ color: "var(--pe-text-strong)" }}
                    >
                      {user?.name || "-"}
                    </p>
                    <p
                      className="text-xs truncate mt-1.5"
                      style={{ color: "var(--pe-text-muted)" }}
                    >
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-pe-blue/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset style={{ background: "var(--pe-bg)" }}>
        {isMobile && (
          <div className="flex border-b border-pe-border h-14 items-center justify-between bg-white/95 px-2 backdrop-blur supports-backdrop-filter:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span
                    className="tracking-tight"
                    style={{ color: "var(--pe-text-strong)" }}
                  >
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
