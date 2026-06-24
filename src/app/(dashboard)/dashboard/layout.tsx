import { AppShell } from "@/components/layout/app-shell";
import { getAppSession } from "@/platform/auth/session";
import { platformModules } from "@/platform/core/modules";
import type { ReactNode } from "react";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getAppSession();

  return (
    <AppShell modules={platformModules} session={session}>
      {children}
    </AppShell>
  );
}
