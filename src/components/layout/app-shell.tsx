"use client";

import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  FileText,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  PlugZap,
  Settings,
  Sparkles,
  Users,
  X,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  User as UserIcon,
  Activity,
  Building2,
  Clock,
  ListTodo,
  FolderOpen,
} from "lucide-react";

import {
  fetchLeadsAction,
  fetchCompaniesAction,
  fetchLeadsForTodoAction,
} from "@/features/crm/actions";
import { NotificationBell } from "./notification-bell";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, {
  useState,
  useEffect,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { NaiaFloatingAssistant } from "@/features/naia/naia-floating-assistant";
import { cn } from "@/lib/cn";
import type { AppSession } from "@/platform/auth/session";
import type { PlatformModule, PlatformModuleId } from "@/platform/core/modules";
import { hasPermission } from "@/platform/core/permissions";

const moduleIcons: Record<
  PlatformModuleId,
  ComponentType<{ className?: string }>
> = {
  dashboard: LayoutDashboard,
  naia: Sparkles,
  crm: Handshake,
  meetings: CalendarDays,
  proposals: FileText,
  projects: BriefcaseBusiness,
  hr: Users,
  finance: CircleDollarSign,
  automations: Bot,
  integrations: PlugZap,
  settings: Settings,
};

export function AppShell({
  children,
  modules,
  session,
}: {
  children: ReactNode;
  modules: PlatformModule[];
  session: AppSession;
}) {
  const pathname = usePathname();
  // Drive folders live in the cofounders-only shared drive; hide the entry
  // for roles without Docs Generator access.
  const canSeeDriveFolders = hasPermission(session.user.role, {
    module: "proposals",
    action: "read",
  });
  const [pipelineCount, setPipelineCount] = useState<number | null>(null);
  const [drivesCount, setDrivesCount] = useState<number | null>(null);
  const [followUpsCount, setFollowUpsCount] = useState<number | null>(null);
  const [todoCount, setTodoCount] = useState<number | null>(null);
  const [clientsCount, setClientsCount] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadCounts() {
      try {
        const [leads, companies, todoLeads] = await Promise.all([
          fetchLeadsAction(),
          fetchCompaniesAction(),
          fetchLeadsForTodoAction(),
        ]);

        if (isMounted) {
          const activeLeads = leads.filter(
            (l) => l.status !== "won" && l.status !== "dead-end",
          );
          setPipelineCount(activeLeads.length);

          const drives = [
            ...leads.filter((l) => getLeadDriveFolderUrl(l)),
            ...companies.filter((c) => c.driveFolderUrl),
          ];
          setDrivesCount(drives.length);

          setFollowUpsCount(activeLeads.length);
          setTodoCount(todoLeads.length);
          setClientsCount(companies.length);
        }
      } catch (err) {
        console.error("Failed to load crm navigation counts:", err);
      }
    }
    loadCounts();
    return () => {
      isMounted = false;
    };
  }, [pathname]);

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const isNaiaHomePage = pathname === "/naia" || pathname === "/dashboard/naia";
  const isFullBleedPage =
    pathname === "/dashboard/leads" ||
    pathname === "/crm" ||
    pathname === "/naia/crm" ||
    pathname === "/finance" ||
    pathname === "/projects" ||
    pathname === "/hr";

  // Profile Popover state
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    if (isDark) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTheme("dark");
    }

    // Close profile dropdown on outside click
    const handleClickOutside = (event: MouseEvent) => {
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle("dark");
    const newTheme = isDark ? "dark" : "light";
    localStorage.setItem("theme", newTheme);
    setTheme(newTheme);
  };

  return (
    <div
      className="min-h-screen transition-colors duration-200"
      style={{
        background: "var(--maison-page)",
        color: "var(--maison-text-primary)",
      }}
    >
      {isNaiaHomePage ? null : (
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 hidden lg:flex lg:flex-col transition-all duration-300",
            isCollapsed ? "w-20" : "w-[236px]",
          )}
        >
          <ShellSidebar
            modules={modules}
            pathname={pathname}
            isCollapsed={isCollapsed}
            onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
            showDriveFolders={canSeeDriveFolders}
            crmCounts={{
              pipeline: pipelineCount,
              drives: drivesCount,
              followUps: followUpsCount,
              todo: todoCount,
              clients: clientsCount,
            }}
          />
        </aside>
      )}

      {isNaiaHomePage ? null : (
        <>
          <div
            className={cn(
              "fixed inset-0 z-40 bg-black/40 transition lg:hidden",
              isMobileOpen ? "block" : "hidden",
            )}
            onClick={() => setIsMobileOpen(false)}
          />
          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 w-80 max-w-[88vw] transition-transform lg:hidden",
              isMobileOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <div
              className="flex h-16 items-center justify-between px-4"
              style={{ borderBottom: "1px solid var(--maison-sidebar-border)" }}
            >
              <Brand isCollapsed={false} />
              <Button
                aria-label="Close navigation"
                className="h-9 w-9 px-0 text-white/70 hover:text-white hover:bg-white/10"
                onClick={() => setIsMobileOpen(false)}
                variant="ghost"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <ShellSidebar
              modules={modules}
              onNavigate={() => setIsMobileOpen(false)}
              pathname={pathname}
              showBrand={false}
              isCollapsed={false}
              showDriveFolders={canSeeDriveFolders}
              crmCounts={{
                pipeline: pipelineCount,
                drives: drivesCount,
                followUps: followUpsCount,
                todo: todoCount,
                clients: clientsCount,
              }}
            />
          </aside>
        </>
      )}

      <div
        className={cn(
          "transition-all duration-300",
          !isNaiaHomePage && (isCollapsed ? "lg:pl-20" : "lg:pl-[236px]"),
        )}
      >
        {isNaiaHomePage ? null : (
          <header
            className="sticky top-0 z-20 flex h-[52px] items-center justify-between px-4 backdrop-blur md:px-6"
            style={{
              background: "var(--app-topbar-bg)",
              borderBottom: "1px solid var(--maison-border)",
            }}
          >
            <div className="flex items-center gap-3">
              <Button
                aria-label="Open navigation"
                className="h-9 w-9 px-0 lg:hidden"
                onClick={() => setIsMobileOpen(true)}
                variant="ghost"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div>
                <p
                  className="text-[11px] font-medium uppercase tracking-[0.08em]"
                  style={{ color: "var(--maison-text-muted)" }}
                >
                  QARIZMI · ESPACE INTERNE
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <Button
                aria-label="Toggle theme"
                className="h-9 w-9 px-0 hover:bg-[var(--maison-border-subtle)]"
                onClick={toggleTheme}
                variant="ghost"
              >
                {theme === "dark" ? (
                  <Sun
                    className="h-4.5 w-4.5"
                    style={{ color: "var(--maison-text-secondary)" }}
                  />
                ) : (
                  <Moon
                    className="h-4.5 w-4.5"
                    style={{ color: "var(--maison-text-secondary)" }}
                  />
                )}
              </Button>

              {/* Profile Dropdown */}
              <div className="relative ml-2" ref={profileRef}>
                <button
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-md px-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--maison-brass)]",
                    isProfileOpen
                      ? "bg-[var(--maison-border-subtle)]"
                      : "bg-transparent hover:bg-[var(--maison-border-subtle)]",
                  )}
                >
                  <span
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[10px] font-semibold"
                    style={{
                      background: "var(--maison-brass)",
                      color: "var(--maison-brass-text)",
                    }}
                  >
                    {session.user.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden sm:block">
                    <span
                      className="block text-[12px] font-medium"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {session.user.name}
                    </span>
                    <span
                      className="block text-[10px] capitalize"
                      style={{ color: "var(--maison-text-muted)" }}
                    >
                      {session.user.role}
                    </span>
                  </span>
                  <ChevronDown
                    className="hidden h-4 w-4 sm:block"
                    style={{ color: "var(--maison-text-muted)" }}
                  />
                </button>

                {isProfileOpen && (
                  <div
                    className="absolute right-0 mt-2 w-64 origin-top-right rounded-xl p-2 shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-200 z-50"
                    style={{
                      background: "var(--maison-card)",
                      border: "1px solid var(--maison-border)",
                    }}
                  >
                    <div className="mb-2 flex items-center gap-3 border-b border-stone-100 dark:border-stone-800 p-3">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                        style={{
                          background: "rgba(201,168,76,0.15)",
                          color: "var(--maison-brass-light)",
                        }}
                      >
                        {session.user.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-semibold"
                          style={{ color: "var(--maison-text-primary)" }}
                        >
                          {session.user.name}
                        </p>
                        <p
                          className="truncate text-xs"
                          style={{ color: "var(--maison-text-muted)" }}
                        >
                          {session.user.email}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Link
                        href="/dashboard/settings"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-700 hover:bg-stone-100 hover:text-stone-900 transition-colors"
                      >
                        <UserIcon className="h-4 w-4 text-stone-500" />
                        Profil & Paramètres
                      </Link>
                    </div>
                    <div className="mt-2 border-t border-stone-100 dark:border-stone-800 pt-2">
                      <form action="/auth/sign-out" method="post">
                        <button
                          type="submit"
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-700 dark:hover:text-red-300 transition-colors font-medium"
                        >
                          <LogOut className="h-4 w-4" />
                          Déconnexion
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>
        )}
        <main
          className={cn(
            "mx-auto w-full",
            isNaiaHomePage
              ? "max-w-none p-0"
              : isFullBleedPage
                ? "max-w-none px-3 py-3 md:px-4 lg:px-6"
                : "max-w-7xl px-4 py-8 md:px-6 lg:px-8",
          )}
          style={{ background: "var(--maison-page)" }}
        >
          {children}
        </main>
      </div>
      {isNaiaHomePage ? null : <NaiaFloatingAssistant />}
    </div>
  );
}

function ShellSidebar({
  modules,
  pathname,
  onNavigate,
  showBrand = true,
  isCollapsed = false,
  onToggleCollapse,
  showDriveFolders = true,
  crmCounts,
}: {
  modules: PlatformModule[];
  pathname: string;
  onNavigate?: () => void;
  showBrand?: boolean;
  showDriveFolders?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  crmCounts?: {
    pipeline: number | null;
    drives: number | null;
    followUps: number | null;
    todo: number | null;
    clients: number | null;
  };
}) {
  const isCrmActive =
    pathname.startsWith("/dashboard/leads") ||
    pathname.startsWith("/dashboard/drives") ||
    pathname.startsWith("/dashboard/follow-ups") ||
    pathname.startsWith("/dashboard/todo") ||
    pathname.startsWith("/dashboard/clients");

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={{ background: "var(--maison-sidebar)" }}
    >
      {showBrand ? (
        <div
          className="flex h-16 items-center justify-between px-5 transition-all"
          style={{ borderBottom: "1px solid var(--maison-sidebar-border)" }}
        >
          <Brand isCollapsed={isCollapsed} />
          {onToggleCollapse && (
            <Button
              variant="ghost"
              className={cn(
                "h-9 w-9 shrink-0 rounded-lg border border-white/10 text-white/60 hover:border-[#c9a84c]/40 hover:bg-[#c9a84c]/10 hover:text-[#c9a84c] transition-all",
                isCollapsed ? "mx-auto" : "",
              )}
              onClick={onToggleCollapse}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      ) : null}
      <nav
        className={cn(
          "flex-1 space-y-1 overflow-y-auto py-4",
          isCollapsed ? "px-3" : "px-3",
        )}
      >
        {modules.map((module) => {
          const Icon = moduleIcons[module.id];
          const isActive =
            pathname === module.href ||
            (module.id !== "dashboard" &&
              pathname.startsWith(`${module.href}/`));

          if (module.id === "crm") {
            return (
              <React.Fragment key={module.id}>
                <Link
                  className={cn(
                    "group flex w-full min-h-11 items-center gap-3 rounded-md py-2 text-[12.5px] font-medium transition text-left focus:outline-none",
                    isCollapsed ? "justify-center px-0" : "px-3",
                    isCrmActive
                      ? "text-[#E9F0F6] font-semibold"
                      : "text-[#8AA0B4] hover:text-[#E9F0F6] hover:bg-white/5",
                  )}
                  style={
                    isCrmActive
                      ? {
                          background:
                            "var(--maison-sidebar-active, rgba(201,168,76,0.10))",
                        }
                      : undefined
                  }
                  href={module.href}
                  onClick={onNavigate}
                  title={isCollapsed ? module.name : undefined}
                >
                  <Icon
                    className={cn(
                      "h-[15px] w-[15px] flex-none",
                      isCrmActive
                        ? "text-[#c9a84c]"
                        : "text-[#54697D] group-hover:text-white/70",
                    )}
                  />
                  {!isCollapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate">
                        {module.name}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-white/30 transition-transform duration-200 group-hover:text-white/50",
                          isCrmActive ? "rotate-180 text-[#c9a84c]/60" : "",
                        )}
                      />
                    </>
                  )}
                </Link>
                {/* CRM sub-links */}
                {isCrmActive && !isCollapsed && (
                  <div
                    className="ml-6 mt-1 space-y-0.5 pl-4"
                    style={{
                      borderLeft: "1px solid var(--maison-sidebar-border)",
                    }}
                  >
                    {[
                      {
                        href: "/dashboard/leads",
                        label: "Pipeline",
                        icon: Activity,
                        count: crmCounts?.pipeline,
                        show: true,
                      },
                      {
                        href: "/dashboard/drives",
                        label: "Dossiers Drive",
                        icon: FolderOpen,
                        count: crmCounts?.drives,
                        show: showDriveFolders,
                      },
                      {
                        href: "/dashboard/follow-ups",
                        label: "Suivi des relances",
                        icon: Clock,
                        count: crmCounts?.followUps,
                        show: true,
                      },
                      {
                        href: "/dashboard/todo",
                        label: "Tâches",
                        icon: ListTodo,
                        count: crmCounts?.todo,
                        show: true,
                      },
                      {
                        href: "/dashboard/clients",
                        label: "Clients",
                        icon: Building2,
                        count: crmCounts?.clients,
                        show: true,
                      },
                    ]
                      .filter((sub) => sub.show)
                      .map((sub) => {
                        const SubIcon = sub.icon;
                        const subActive =
                          pathname === sub.href ||
                          pathname.startsWith(`${sub.href}/`);
                        return (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            onClick={onNavigate}
                            className={cn(
                              "flex min-h-8 items-center gap-2 rounded-md px-3 py-1.5 text-[11px] font-medium transition w-full",
                              subActive
                                ? "text-[#E9F0F6] font-semibold"
                                : "text-[#6B8195] hover:text-[#B6C6D4] hover:bg-white/5",
                            )}
                            style={
                              subActive
                                ? { background: "rgba(201,168,76,0.08)" }
                                : undefined
                            }
                          >
                            <SubIcon
                              className={cn(
                                "h-3.5 w-3.5 shrink-0",
                                subActive ? "text-[#c9a84c]" : "text-[#54697D]",
                              )}
                            />
                            <span className="flex-1 truncate">{sub.label}</span>
                            {sub.count !== null && sub.count !== undefined && (
                              <span
                                className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[9px] font-semibold"
                                style={{
                                  background: subActive
                                    ? "rgba(201,168,76,0.18)"
                                    : "rgba(84,105,125,0.16)",
                                  color: subActive ? "#e0c07a" : "#6B8195",
                                }}
                              >
                                {sub.count}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                  </div>
                )}
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={module.id}>
              <Link
                className={cn(
                  "group flex min-h-11 items-center gap-3 rounded-md py-2 text-[12.5px] font-medium transition",
                  isCollapsed ? "justify-center px-0" : "px-3",
                  isActive
                    ? "text-[#E9F0F6] font-semibold"
                    : "text-[#8AA0B4] hover:text-[#E9F0F6] hover:bg-white/5",
                )}
                style={
                  isActive
                    ? {
                        background:
                          "var(--maison-sidebar-active, rgba(201,168,76,0.10))",
                      }
                    : undefined
                }
                href={module.href}
                onClick={onNavigate}
                title={isCollapsed ? module.name : undefined}
              >
                <Icon
                  className={cn(
                    "h-[15px] w-[15px] flex-none",
                    isActive
                      ? "text-[#c9a84c]"
                      : "text-[#54697D] group-hover:text-white/70",
                  )}
                />
                {!isCollapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate">
                      {module.name}
                    </span>
                    {module.id === "naia" && (
                      <span
                        className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={{
                          color: "#c9a84c",
                          background: "rgba(201,168,76,0.12)",
                          border: "1px solid rgba(201,168,76,0.35)",
                        }}
                      >
                        BÊTA
                      </span>
                    )}
                    {module.status !== "live" && (
                      <span
                        className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={{
                          color: "#6B8195",
                          background: "rgba(92,114,134,0.10)",
                        }}
                      >
                        {module.status === "guarded"
                          ? "BIENTÔT"
                          : module.status}
                      </span>
                    )}
                  </>
                )}
              </Link>
            </React.Fragment>
          );
        })}
      </nav>
      {!isCollapsed && (
        <div
          className="p-4 transition-opacity duration-300"
          style={{ borderTop: "1px solid var(--maison-sidebar-border)" }}
        >
          <p
            className="text-[15px] italic"
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              color: "#E9F0F6",
            }}
          >
            Qarizmi
          </p>
          <p
            className="mt-0.5 text-[9.5px] font-medium uppercase"
            style={{ letterSpacing: "0.14em", color: "#5C7286" }}
          >
            AI · DATA · STRATEGY
          </p>
        </div>
      )}
    </div>
  );
}

function getLeadDriveFolderUrl(lead: {
  driveFolderUrl?: string;
  notes?: string;
}) {
  return lead.driveFolderUrl ?? extractDriveLinkFromNotes(lead.notes);
}

function extractDriveLinkFromNotes(notes?: string) {
  const match = (notes ?? "").match(
    /\[Google Drive Folder:[^\]]*\]\((https:\/\/[^)]+)\)/,
  );

  return match?.[1] ?? undefined;
}

function Brand({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <Link
      className={cn(
        "flex items-center gap-3 overflow-hidden",
        isCollapsed ? "hidden" : "flex",
      )}
      href="/dashboard"
    >
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-white shadow-sm">
        <Image
          alt="NAIA-os Logo"
          aria-hidden="true"
          className="h-6 w-6 object-contain"
          height={24}
          priority
          src="/brand/naia-os-q.png"
          width={24}
        />
      </span>
      {!isCollapsed && (
        <span className="whitespace-nowrap transition-opacity duration-300">
          <span
            className="block text-[13.5px] font-bold"
            style={{ color: "#E9F0F6" }}
          >
            NAIA-os
          </span>
          <span
            className="block text-[10.5px] font-medium"
            style={{ color: "#5C7286" }}
          >
            Plateforme interne
          </span>
        </span>
      )}
    </Link>
  );
}
