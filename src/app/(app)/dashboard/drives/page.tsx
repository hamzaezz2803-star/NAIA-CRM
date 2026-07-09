import React from "react";
import { redirect } from "next/navigation";

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
      {/* Header section matches Pipeline page header exactly */}
      <div
        className="flex flex-col gap-2 border-b pb-4"
        style={{ borderColor: "var(--maison-border)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--maison-brass)" }}
            >
              CRM & Google Workspace
            </p>
            <h1
              className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl font-serif"
              style={{
                fontFamily: "var(--font-playfair), Georgia, serif",
                color: "var(--maison-text-primary)",
              }}
            >
              Dossiers Drive
            </h1>
            <p
              className="mt-1 text-xs"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              Consultez l&apos;ensemble des dossiers de stockage partagés créés
              automatiquement sur Google Drive pour vos prospects et comptes
              clients.
            </p>
          </div>
          <StatusBadge status="live" />
        </div>
      </div>

      <DrivesDashboard initialLeads={leads} initialCompanies={companies} />
    </div>
  );
}
