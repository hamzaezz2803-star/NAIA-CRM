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
      {/* Summary Statistics Cards styled as Maison premium cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Stat 1: Total */}
        <div
          className="rounded-xl p-4 flex items-center justify-between transition-shadow hover:shadow-sm"
          style={{
            background: "var(--maison-card)",
            border: "1px solid var(--maison-border)",
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{
                background: "rgba(201, 168, 76, 0.10)",
                color: "var(--maison-brass)",
              }}
            >
              <FolderOpen className="h-4 w-4" />
            </span>
            <div>
              <p
                className="text-xl font-bold leading-none"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {stats.total}
              </p>
              <p
                className="text-[10px] font-semibold mt-0.5"
                style={{ color: "var(--maison-text-muted)" }}
              >
                Dossiers Drive au total
              </p>
            </div>
          </div>
        </div>

        {/* Stat 2: Leads */}
        <div
          className="rounded-xl p-4 flex items-center justify-between transition-shadow hover:shadow-sm"
          style={{
            background: "var(--maison-card)",
            border: "1px solid var(--maison-border)",
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{
                background: "rgba(201, 168, 76, 0.10)",
                color: "var(--maison-brass)",
              }}
            >
              <Briefcase className="h-4 w-4" />
            </span>
            <div>
              <p
                className="text-xl font-bold leading-none"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {stats.leadsCount}
              </p>
              <p
                className="text-[10px] font-semibold mt-0.5"
                style={{ color: "var(--maison-text-muted)" }}
              >
                Dossiers Opportunités
              </p>
            </div>
          </div>
        </div>

        {/* Stat 3: Companies */}
        <div
          className="rounded-xl p-4 flex items-center justify-between transition-shadow hover:shadow-sm"
          style={{
            background: "var(--maison-card)",
            border: "1px solid var(--maison-border)",
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{
                background: "rgba(201, 168, 76, 0.10)",
                color: "var(--maison-brass)",
              }}
            >
              <Building2 className="h-4 w-4" />
            </span>
            <div>
              <p
                className="text-xl font-bold leading-none"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {stats.companiesCount}
              </p>
              <p
                className="text-[10px] font-semibold mt-0.5"
                style={{ color: "var(--maison-text-muted)" }}
              >
                Dossiers Entreprises
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar & Filters Card */}
      <div
        className="rounded-lg p-4 space-y-4"
        style={{
          background: "var(--maison-card)",
          border: "1px solid var(--maison-border)",
        }}
      >
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          {/* Tab Selector */}
          <div
            className="flex p-0.5 rounded-lg w-full md:w-auto"
            style={{
              background: "var(--maison-page)",
              border: "1px solid var(--maison-border)",
            }}
          >
            <button
              onClick={() => setActiveTab("all")}
              className={`flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition`}
              style={
                activeTab === "all"
                  ? {
                      background: "var(--maison-brass)",
                      color: "var(--maison-brass-text)",
                    }
                  : {
                      color: "var(--maison-text-secondary)",
                    }
              }
            >
              <Layers className="h-3.5 w-3.5" />
              Tous
            </button>
            <button
              onClick={() => setActiveTab("leads")}
              className={`flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition`}
              style={
                activeTab === "leads"
                  ? {
                      background: "var(--maison-brass)",
                      color: "var(--maison-brass-text)",
                    }
                  : {
                      color: "var(--maison-text-secondary)",
                    }
              }
            >
              <Briefcase className="h-3.5 w-3.5" />
              Opportunités
            </button>
            <button
              onClick={() => setActiveTab("companies")}
              className={`flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition`}
              style={
                activeTab === "companies"
                  ? {
                      background: "var(--maison-brass)",
                      color: "var(--maison-brass-text)",
                    }
                  : {
                      color: "var(--maison-text-secondary)",
                    }
              }
            >
              <Building2 className="h-3.5 w-3.5" />
              Entreprises
            </button>
          </div>

          {/* Search Input */}
          <div className="relative w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Rechercher par sujet, entreprise ou contact..."
              className="min-h-10 w-full rounded-md border pl-9 pr-4 text-xs outline-none transition"
              style={{
                borderColor: "var(--maison-border)",
                background: "var(--maison-page)",
                color: "var(--maison-text-primary)",
              }}
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <div
              key={`${item.type}-${item.id}`}
              className="group relative flex flex-col justify-between rounded-xl p-4 transition-all hover:shadow-md"
              style={{
                background: "var(--maison-card)",
                border: "1px solid var(--maison-border)",
              }}
            >
              <div>
                {/* Header: Title + Type Badge */}
                <div className="flex items-start justify-between gap-3">
                  <h3
                    className="text-xs font-bold transition-colors line-clamp-1 flex-1"
                    style={{ color: "var(--maison-text-primary)" }}
                  >
                    {item.title}
                  </h3>
                  {item.type === "lead" ? (
                    <span
                      className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                      style={{
                        background: "rgba(201, 168, 76, 0.08)",
                        color: "var(--maison-brass)",
                        border: "1px solid var(--maison-border)",
                      }}
                    >
                      Opportunité
                    </span>
                  ) : (
                    <span
                      className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                      style={{
                        background: "var(--maison-border-subtle)",
                        color: "var(--maison-text-secondary)",
                        border: "1px solid var(--maison-border)",
                      }}
                    >
                      Entreprise
                    </span>
                  )}
                </div>

                <p
                  className="text-[9px] font-semibold uppercase tracking-wider mt-1"
                  style={{ color: "var(--maison-text-muted)" }}
                >
                  {item.subtitle}
                </p>

                {/* Details Section */}
                <div
                  className="mt-3 space-y-1.5 border-t pt-2.5"
                  style={{ borderColor: "var(--maison-border)" }}
                >
                  <div
                    className="flex items-center gap-2 text-xs"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    <Building2 className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                    <span className="truncate font-semibold">
                      {item.companyName}
                    </span>
                  </div>

                  {item.contactName && (
                    <div
                      className="flex items-center gap-2 text-xs"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      <span className="h-3.5 w-3.5 text-stone-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                        @
                      </span>
                      <span className="truncate">{item.contactName}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <div
                className="mt-4 pt-2.5 border-t"
                style={{ borderColor: "var(--maison-border)" }}
              >
                <a
                  href={item.driveFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full inline-flex min-h-8 items-center justify-center gap-2 rounded-lg text-xs font-bold transition shadow-sm"
                  style={{
                    background: "var(--maison-brass)",
                    color: "var(--maison-brass-text)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "var(--maison-brass-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--maison-brass)";
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
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
