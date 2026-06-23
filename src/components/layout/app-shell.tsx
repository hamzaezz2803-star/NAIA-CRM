"use client";

import {
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  FileText,
  Handshake,
  LayoutDashboard,
  Menu,
  PlugZap,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";
import type { AppSession } from "@/platform/auth/session";
import type { PlatformModule, PlatformModuleId } from "@/platform/core/modules";

const moduleIcons: Record<
  PlatformModuleId,
  ComponentType<{ className?: string }>
> = {
  dashboard: LayoutDashboard,
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
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-stone-200 bg-white lg:flex lg:flex-col">
        <ShellSidebar modules={modules} pathname={pathname} />
      </aside>

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
          <Brand />
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
        />
      </aside>

      <div className="lg:pl-72">
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
                {session.isSupabaseConfigured
                  ? "Supabase project configured"
                  : "Local auth scaffold"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              aria-label="Notifications"
              className="h-9 w-9 px-0"
              variant="ghost"
            >
              <Bell className="h-4 w-4" />
            </Button>
            <button className="flex h-10 items-center gap-2 rounded-md px-2 text-left transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-stone-950 text-xs font-semibold text-white">
                AE
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
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function ShellSidebar({
  modules,
  pathname,
  onNavigate,
  showBrand = true,
}: {
  modules: PlatformModule[];
  pathname: string;
  onNavigate?: () => void;
  showBrand?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showBrand ? (
        <div className="flex h-16 items-center border-b border-stone-200 px-5">
          <Brand />
        </div>
      ) : null}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {modules.map((module) => {
          const Icon = moduleIcons[module.id];
          const isActive =
            pathname === module.href || pathname.startsWith(`${module.href}/`);

          return (
            <Link
              className={cn(
                "group flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                isActive
                  ? "bg-teal-50 text-teal-900"
                  : "text-stone-700 hover:bg-stone-100 hover:text-stone-950",
              )}
              href={module.href}
              key={module.id}
              onClick={onNavigate}
            >
              <Icon
                className={cn(
                  "h-4 w-4 flex-none",
                  isActive ? "text-teal-700" : "text-stone-500",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{module.name}</span>
              {module.status !== "planned" ? (
                <span className="hidden md:inline">
                  <StatusBadge status={module.status} />
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-stone-200 p-4">
        <p className="text-xs font-medium uppercase text-stone-500">Platform</p>
        <p className="mt-2 text-sm leading-5 text-stone-600">
          Modular monolith foundation for internal operations and AI-assisted
          work.
        </p>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link className="flex items-center gap-3" href="/dashboard">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-stone-950 text-sm font-semibold text-white">
        Q
      </span>
      <span>
        <span className="block text-sm font-semibold text-stone-950">
          Qarizmi OS
        </span>
        <span className="block text-xs text-stone-500">Internal platform</span>
      </span>
    </Link>
  );
}
