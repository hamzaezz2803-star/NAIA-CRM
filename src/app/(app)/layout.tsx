import { AppShell } from "@/components/layout/app-shell";
import { getAppSession } from "@/platform/auth/session";
import { platformModules } from "@/platform/core/modules";
import { canAccessModule } from "@/platform/core/permissions";
import type { ReactNode } from "react";

export default async function AuthenticatedAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getAppSession();
  const visibleModules = platformModules.filter((module) =>
    canAccessModule(session.user.role, module.id),
  );

  return (
    <AppShell modules={visibleModules} session={session}>
      {children}
    </AppShell>
  );
}
