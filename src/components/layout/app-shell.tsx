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
import { StatusBadge } from "@/components/ui/status-badge";
import { NaiaFloatingAssistant } from "@/features/naia/naia-floating-assistant";
import { cn } from "@/lib/cn";
import type { AppSession } from "@/platform/auth/session";
import type { PlatformModule, PlatformModuleId } from "@/platform/core/modules";

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
    <div className="min-h-screen bg-stone-50 text-stone-950 transition-colors duration-200">
      {isNaiaHomePage ? null : (
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 hidden border-r border-stone-200 bg-white lg:flex lg:flex-col transition-all duration-300",
            isCollapsed ? "w-20" : "w-72",
          )}
        >
          <ShellSidebar
            modules={modules}
            pathname={pathname}
            isCollapsed={isCollapsed}
            onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
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
              "fixed inset-0 z-40 bg-stone-950/30 transition lg:hidden",
              isMobileOpen ? "block" : "hidden",
            )}
            onClick={() => setIsMobileOpen(false)}
          />
          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 w-80 max-w-[88vw] border-r border-stone-200 bg-white transition-transform lg:hidden",
              isMobileOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <div className="flex h-16 items-center justify-between border-b border-stone-200 px-4">
              <Brand isCollapsed={false} />
              <Button
                aria-label="Close navigation"
                className="h-9 w-9 px-0"
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
          !isNaiaHomePage && (isCollapsed ? "lg:pl-20" : "lg:pl-72"),
        )}
      >
        {isNaiaHomePage ? null : (
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-stone-200 bg-white/92 px-4 backdrop-blur md:px-6">
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
                <p className="text-sm font-semibold text-stone-950">
                  {session.organization.name}
                </p>
                <p className="hidden text-xs text-stone-500 sm:block">
                  Signed in with Supabase
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <Button
                aria-label="Toggle theme"
                className="h-9 w-9 px-0"
                onClick={toggleTheme}
                variant="ghost"
              >
                {theme === "dark" ? (
                  <Sun className="h-4.5 w-4.5" />
                ) : (
                  <Moon className="h-4.5 w-4.5" />
                )}
              </Button>

              {/* Profile Dropdown */}
              <div className="relative ml-2" ref={profileRef}>
                <button
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="flex h-10 items-center gap-2 rounded-md px-2 text-left transition hover:bg-stone-100 dark:hover:bg-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-stone-950 dark:bg-stone-200 text-xs font-semibold text-white dark:text-stone-950">
                    {session.user.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden sm:block">
                    <span className="block text-sm font-medium text-stone-950">
                      {session.user.name}
                    </span>
                    <span className="block text-xs capitalize text-stone-500">
                      {session.user.role}
                    </span>
                  </span>
                  <ChevronDown className="hidden h-4 w-4 text-stone-500 sm:block" />
                </button>

                {isProfileOpen && (
                  <div className="absolute right-0 mt-2 w-64 origin-top-right rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-2 shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-200 z-50">
                    <div className="mb-2 flex items-center gap-3 border-b border-stone-100 dark:border-stone-800 p-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/50 text-sm font-bold text-teal-800 dark:text-teal-400">
                        {session.user.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                          {session.user.name}
                        </p>
                        <p className="truncate text-xs text-stone-500">
                          {session.user.email}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Link
                        href="/dashboard/settings"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-900 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
                      >
                        <UserIcon className="h-4 w-4 text-stone-500 dark:text-stone-400" />
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
                ? "max-w-none px-2 py-3 md:px-3 lg:px-4"
                : "max-w-7xl px-4 py-8 md:px-6 lg:px-8",
          )}
        >
          {children}
        </main>
      </div>
      <NaiaFloatingAssistant />
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
  crmCounts,
}: {
  modules: PlatformModule[];
  pathname: string;
  onNavigate?: () => void;
  showBrand?: boolean;
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
    <div className="flex min-h-0 flex-1 flex-col">
      {showBrand ? (
        <div className="flex h-16 items-center justify-between border-b border-stone-200 px-5 transition-all">
          <Brand isCollapsed={isCollapsed} />
          {onToggleCollapse && (
            <Button
              variant="ghost"
              className={cn(
                "h-10 w-10 text-stone-700 dark:text-stone-300 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 shrink-0 shadow-sm border border-stone-200 dark:border-stone-700",
                isCollapsed ? "mx-auto" : "",
              )}
              onClick={onToggleCollapse}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
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
            pathname === module.href || pathname.startsWith(`${module.href}/`);

          if (module.id === "crm") {
            return (
              <React.Fragment key={module.id}>
                <Link
                  className={cn(
                    "group flex w-full min-h-11 items-center gap-3 rounded-md py-2 text-sm font-medium transition text-left focus:outline-none",
                    isCollapsed ? "justify-center px-0" : "px-3",
                    isCrmActive
                      ? "bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-400"
                      : "text-stone-700 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white",
                  )}
                  href={module.href}
                  onClick={onNavigate}
                  title={isCollapsed ? module.name : undefined}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5 flex-none",
                      isCrmActive
                        ? "text-teal-700 dark:text-teal-400"
                        : "text-stone-500 group-hover:text-stone-700 dark:text-stone-400 dark:group-hover:text-stone-300",
                    )}
                  />
                  {!isCollapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate">
                        {module.name}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-stone-400 transition-transform duration-200 group-hover:text-stone-600 dark:group-hover:text-stone-300",
                          isCrmActive ? "rotate-180" : "",
                        )}
                      />
                    </>
                  )}
                </Link>
                {/* CRM sub-links */}
                {isCrmActive && !isCollapsed && (
                  <div className="ml-6 mt-1 space-y-0.5 pl-4 border-l border-stone-200 dark:border-stone-800">
                    {[
                      {
                        href: "/dashboard/leads",
                        label: "Pipeline",
                        icon: Activity,
                        count: crmCounts?.pipeline,
                      },
                      {
                        href: "/dashboard/drives",
                        label: "Dossiers Drive",
                        icon: FolderOpen,
                        count: crmCounts?.drives,
                      },
                      {
                        href: "/dashboard/follow-ups",
                        label: "Suivi des relances",
                        icon: Clock,
                        count: crmCounts?.followUps,
                      },
                      {
                        href: "/dashboard/todo",
                        label: "Tâches (Todo)",
                        icon: ListTodo,
                        count: crmCounts?.todo,
                      },
                      {
                        href: "/dashboard/clients",
                        label: "Clients",
                        icon: Building2,
                        count: crmCounts?.clients,
                      },
                    ].map((sub) => {
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
                            "flex min-h-8 items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition w-full",
                            subActive
                              ? "bg-teal-50 text-teal-800 dark:bg-teal-950/30 dark:text-teal-400"
                              : "text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white",
                          )}
                        >
                          <SubIcon
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              subActive
                                ? "text-teal-700 dark:text-teal-400"
                                : "text-stone-400",
                            )}
                          />
                          <span className="flex-1 truncate">{sub.label}</span>
                          {sub.count !== null && sub.count !== undefined && (
                            <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-1 ring-rose-350">
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
                  "group flex min-h-11 items-center gap-3 rounded-md py-2 text-sm font-medium transition",
                  isCollapsed ? "justify-center px-0" : "px-3",
                  isActive
                    ? "bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-400"
                    : "text-stone-700 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white",
                )}
                href={module.href}
                onClick={onNavigate}
                title={isCollapsed ? module.name : undefined}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 flex-none",
                    isActive
                      ? "text-teal-700 dark:text-teal-400"
                      : "text-stone-500 group-hover:text-stone-700 dark:text-stone-400 dark:group-hover:text-stone-300",
                  )}
                />
                {!isCollapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate">
                      {module.name}
                    </span>
                    <span className="hidden md:inline">
                      <StatusBadge status={module.status} />
                    </span>
                  </>
                )}
              </Link>
            </React.Fragment>
          );
        })}
      </nav>
      {!isCollapsed && (
        <div className="border-t border-stone-200 p-4 transition-opacity duration-300">
          <p className="text-xs font-medium uppercase text-stone-500">
            Platform
          </p>
          <p className="mt-2 text-sm leading-5 text-stone-600">
            Modular monolith foundation for internal operations and AI-assisted
            work.
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
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#ffffff] border border-stone-200 dark:border-none shadow-sm">
        <Image
          alt="NAIA-os Logo"
          aria-hidden="true"
          className="h-7 w-7 object-contain"
          height={28}
          priority
          src="/brand/naia-os-q.png"
          width={28}
        />
      </span>
      {!isCollapsed && (
        <span className="whitespace-nowrap transition-opacity duration-300">
          <span className="block text-sm font-bold text-stone-950">
            NAIA-os
          </span>
          <span className="block text-xs font-medium text-stone-500">
            Internal platform
          </span>
        </span>
      )}
    </Link>
  );
}
