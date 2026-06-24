"use client";

import React, { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  FolderOpen,
  ExternalLink,
  Loader2,
  Building2,
  FileText,
  Plus,
} from "lucide-react";
import { fetchCompaniesAction } from "@/features/crm/actions";
import type { CrmCompanySummary } from "@/features/crm/contracts";

export default function DocumentsPage() {
  const [companies, setCompanies] = useState<CrmCompanySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchCompaniesAction().then((data) => {
      setCompanies(data);
      setIsLoading(false);
    });
  }, []);

  const withDrive = companies.filter((c) => c.driveFolderUrl);
  const withoutDrive = companies.filter((c) => !c.driveFolderUrl);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="CRM · Documents"
        title="Dossiers clients"
        description="Accédez aux dossiers Google Drive synchronisés pour chaque entreprise cliente."
        actions={<StatusBadge status="ready-for-build" />}
      />

      {/* Google Drive connection notice */}
      <div className="rounded-lg border border-teal-200 bg-teal-50 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-teal-100 text-teal-700">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-teal-900">
              Intégration Google Drive
            </h3>
            <p className="mt-1 text-sm leading-6 text-teal-700">
              Les dossiers Drive sont créés automatiquement depuis la fiche
              lead. Configurez votre connexion Google dans{" "}
              <span className="font-medium">Paramètres → Intégrations</span>.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
          <span className="ml-3 text-sm text-stone-500">
            Chargement des dossiers…
          </span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Companies with Drive folders */}
          {withDrive.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-500">
                Dossiers Drive disponibles ({withDrive.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {withDrive.map((company) => (
                  <a
                    key={company.id}
                    href={company.driveFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    id={`drive-link-${company.id}`}
                    className="group flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md"
                  >
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-teal-50 text-teal-700 group-hover:bg-teal-100">
                      <FolderOpen className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-stone-950">
                        {company.name}
                      </p>
                      <p className="truncate text-xs text-stone-400">
                        Google Drive
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 flex-none text-stone-400 group-hover:text-teal-600" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Companies without Drive folders */}
          {withoutDrive.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-500">
                Entreprises sans dossier Drive ({withoutDrive.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {withoutDrive.map((company) => (
                  <div
                    key={company.id}
                    className="flex items-center gap-3 rounded-lg border border-dashed border-stone-200 bg-stone-50 p-4"
                  >
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-stone-100 text-stone-500">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-stone-700">
                        {company.name}
                      </p>
                      <p className="text-xs text-stone-400">
                        Pas de dossier Drive
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {companies.length === 0 && (
            <div className="rounded-lg border border-stone-200 bg-white p-12 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-stone-100">
                <FileText className="h-6 w-6 text-stone-400" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-stone-950">
                Aucune entreprise enregistrée
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-stone-500">
                Créez des leads dans le pipeline CRM. Les entreprises associées
                apparaîtront ici avec leurs dossiers Google Drive.
              </p>
              <div className="mt-6">
                <a
                  href="/dashboard/leads"
                  className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-800"
                >
                  <Plus className="h-4 w-4" />
                  Aller au pipeline CRM
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
