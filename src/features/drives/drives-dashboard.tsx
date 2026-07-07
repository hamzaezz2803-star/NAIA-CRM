"use client";

import React, { useState, useMemo } from "react";
import {
  FolderOpen,
  Search,
  Building2,
  Briefcase,
  Layers,
  FolderDot,
} from "lucide-react";
import type {
  CrmLeadSummary,
  CrmCompanySummary,
} from "@/features/crm/contracts";

type DrivesDashboardProps = {
  initialLeads: CrmLeadSummary[];
  initialCompanies: CrmCompanySummary[];
};

type DriveItem = {
  id: string;
  type: "lead" | "company";
  title: string;
  driveFolderUrl: string;
  companyName: string;
  contactName?: string;
  subtitle?: string;
  createdAt?: string;
};

export function DrivesDashboard({
  initialLeads,
  initialCompanies,
}: DrivesDashboardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "leads" | "companies">(
    "all",
  );

  // Format and filter items that have valid driveFolderUrl
  const allDriveItems = useMemo(() => {
    const items: DriveItem[] = [];

    // Add Leads with Google Drive Folder URLs
    initialLeads.forEach((lead) => {
      const driveFolderUrl = getLeadDriveFolderUrl(lead);

      if (driveFolderUrl) {
        // Extract company and contact from notes if undefined
        const noteLines = (lead.notes ?? "").split("\n");
        const companyName =
          noteLines
            .find((l) => l.startsWith("Entreprise:"))
            ?.replace("Entreprise:", "")
            .trim() ||
          lead.companyName ||
          "Entreprise non spécifiée";

        const contactName =
          noteLines
            .find((l) => l.startsWith("Contact:"))
            ?.replace("Contact:", "")
            .trim() || lead.contactName;

        items.push({
          id: lead.id,
          type: "lead",
          title: lead.topic,
          driveFolderUrl,
          companyName,
          contactName,
          subtitle: "Dossier d'Opportunité / Prospect",
          createdAt: lead.createdAt,
        });
      }
    });

    // Add Companies with Google Drive Folder URLs
    initialCompanies.forEach((company) => {
      if (company.driveFolderUrl) {
        items.push({
          id: company.id,
          type: "company",
          title: company.name,
          driveFolderUrl: company.driveFolderUrl,
          companyName: company.name,
          subtitle: "Dossier Compte / Entreprise",
        });
      }
    });

    return items;
  }, [initialLeads, initialCompanies]);

  // Apply tab filters and search term
  const filteredItems = useMemo(() => {
    return allDriveItems.filter((item) => {
      // 1. Tab filter
      if (activeTab === "leads" && item.type !== "lead") return false;
      if (activeTab === "companies" && item.type !== "company") return false;

      // 2. Search term filter
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        item.title.toLowerCase().includes(term) ||
        item.companyName.toLowerCase().includes(term) ||
        (item.contactName && item.contactName.toLowerCase().includes(term))
      );
    });
  }, [allDriveItems, activeTab, searchTerm]);

  // Compute summary stats
  const stats = useMemo(() => {
    const total = allDriveItems.length;
    const leadsCount = allDriveItems.filter((i) => i.type === "lead").length;
    const companiesCount = allDriveItems.filter(
      (i) => i.type === "company",
    ).length;
    return { total, leadsCount, companiesCount };
  }, [allDriveItems]);

  return (
    <div className="space-y-6">
      {/* Summary Statistics Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Stat 1: Total */}
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-750 dark:bg-teal-950/50 dark:text-teal-400">
              <FolderOpen className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-bold text-stone-950 dark:text-stone-50">
                {stats.total}
              </p>
              <p className="text-xs text-stone-500">Dossiers Drive au total</p>
            </div>
          </div>
        </div>

        {/* Stat 2: Leads */}
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-450">
              <Briefcase className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-bold text-stone-950 dark:text-stone-50">
                {stats.leadsCount}
              </p>
              <p className="text-xs text-stone-500">Dossiers Opportunités</p>
            </div>
          </div>
        </div>

        {/* Stat 3: Companies */}
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-indigo-50 text-indigo-650 dark:bg-indigo-950/50 dark:text-indigo-400">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-bold text-stone-950 dark:text-stone-50">
                {stats.companiesCount}
              </p>
              <p className="text-xs text-stone-500">Dossiers Entreprises</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar & Filters Card */}
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950 space-y-4">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          {/* Tab Selector */}
          <div className="flex bg-stone-100 p-0.5 rounded-lg dark:bg-stone-900 w-full md:w-auto">
            <button
              onClick={() => setActiveTab("all")}
              className={`flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "all"
                  ? "bg-white text-stone-950 shadow-sm dark:bg-stone-850 dark:text-stone-50"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Tous
            </button>
            <button
              onClick={() => setActiveTab("leads")}
              className={`flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "leads"
                  ? "bg-white text-stone-950 shadow-sm dark:bg-stone-850 dark:text-stone-50"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
              }`}
            >
              <Briefcase className="h-3.5 w-3.5 text-blue-500" />
              Opportunités
            </button>
            <button
              onClick={() => setActiveTab("companies")}
              className={`flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "companies"
                  ? "bg-white text-stone-950 shadow-sm dark:bg-stone-850 dark:text-stone-50"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
              }`}
            >
              <Building2 className="h-3.5 w-3.5 text-indigo-500" />
              Entreprises
            </button>
          </div>

          {/* Search Input */}
          <div className="relative w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Rechercher par sujet, entreprise ou contact..."
              className="min-h-10 w-full rounded-md border border-stone-200 bg-white pl-9 pr-4 text-xs text-slate-950 outline-none transition focus:border-teal-500 dark:border-stone-850 dark:bg-stone-950 dark:text-slate-50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Grid of Drive Cards */}
      {filteredItems.length === 0 ? (
        <div className="rounded-lg border border-stone-200 border-dashed bg-white py-16 text-center shadow-sm dark:border-stone-850 dark:bg-stone-950/20">
          <FolderDot className="mx-auto h-10 w-10 text-stone-300 dark:text-stone-800" />
          <h3 className="mt-4 text-xs font-bold text-stone-900 dark:text-stone-100">
            Aucun dossier Drive trouvé
          </h3>
          <p className="mt-1 text-xs text-stone-500">
            {searchTerm
              ? "Essayez de reformuler votre recherche."
              : "Les dossiers partagés s'affichent automatiquement une fois créés depuis NAIA ou CRM."}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <div
              key={`${item.type}-${item.id}`}
              className="group relative flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-stone-850 dark:bg-stone-950/50 hover:border-stone-300 dark:hover:border-stone-750"
            >
              <div>
                {/* Header: Title + Type Badge */}
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-bold text-stone-950 dark:text-stone-50 group-hover:text-teal-650 transition-colors line-clamp-1">
                    {item.title}
                  </h3>
                  {item.type === "lead" ? (
                    <span className="inline-flex shrink-0 items-center rounded-md border border-blue-100 bg-blue-50/50 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-400">
                      Opportunité
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center rounded-md border border-indigo-100 bg-indigo-50/50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:border-indigo-900/30 dark:bg-indigo-950/20 dark:text-indigo-400">
                      Entreprise
                    </span>
                  )}
                </div>

                <p className="text-[10px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mt-1">
                  {item.subtitle}
                </p>

                {/* Details Section */}
                <div className="mt-4 space-y-2 border-t border-stone-100 pt-3 dark:border-stone-850">
                  <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
                    <Building2 className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                    <span className="truncate font-semibold">
                      {item.companyName}
                    </span>
                  </div>

                  {item.contactName && (
                    <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
                      <span className="h-3.5 w-3.5 text-stone-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                        @
                      </span>
                      <span className="truncate">{item.contactName}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-5 pt-3 border-t border-stone-100 dark:border-stone-850">
                <a
                  href={item.driveFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-750 text-white text-xs font-bold shadow-sm transition"
                >
                  <FolderOpen className="h-4 w-4 shrink-0" />
                  <span>Ouvrir dans Google Drive ↗</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getLeadDriveFolderUrl(lead: CrmLeadSummary) {
  return lead.driveFolderUrl ?? extractDriveLinkFromNotes(lead.notes);
}

function extractDriveLinkFromNotes(notes?: string) {
  const match = (notes ?? "").match(
    /\[Google Drive Folder:[^\]]*\]\((https:\/\/[^)]+)\)/,
  );

  return match?.[1] ?? undefined;
}
