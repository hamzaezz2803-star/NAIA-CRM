import React from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchLeadsAction, fetchCompaniesAction } from "@/features/crm/actions";
import { DrivesDashboard } from "@/features/drives/drives-dashboard";
import { getAppSession } from "@/platform/auth/session";
import { hasPermission } from "@/platform/core/permissions";

export default async function DrivesPage() {
  // Client folders live in the cofounders-only shared drive: owner-only.
  const session = await getAppSession();
  if (
    !hasPermission(session.user.role, { module: "proposals", action: "read" })
  ) {
    redirect("/dashboard");
  }

  const [leads, companies] = await Promise.all([
    fetchLeadsAction(),
    fetchCompaniesAction(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM & Google Workspace"
        title="Dossiers Drive"
        description="Consultez l'ensemble des dossiers de stockage partagés créés automatiquement sur Google Drive pour vos prospects et comptes clients."
        actions={<StatusBadge status="live" />}
      />

      <DrivesDashboard initialLeads={leads} initialCompanies={companies} />
    </div>
  );
}
