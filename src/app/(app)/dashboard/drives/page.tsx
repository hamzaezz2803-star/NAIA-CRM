import React from "react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchLeadsAction, fetchCompaniesAction } from "@/features/crm/actions";
import { DrivesDashboard } from "@/features/drives/drives-dashboard";

export default async function DrivesPage() {
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
