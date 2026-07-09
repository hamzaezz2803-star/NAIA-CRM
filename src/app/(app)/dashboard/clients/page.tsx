"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Building2,
  Plus,
  Globe,
  Users,
  FolderOpen,
  Loader2,
  ChevronRight,
  Briefcase,
  X,
  Search,
} from "lucide-react";
import {
  fetchCompaniesAction,
  fetchContactsAction,
  fetchLeadsAction,
  createCompanyAction,
} from "@/features/crm/actions";
import type { CrmCompanySummary } from "@/features/crm/contracts";
import toast from "react-hot-toast";

export default function ClientsPage() {
  const [companies, setCompanies] = useState<CrmCompanySummary[]>([]);
  const [contactCounts, setContactCounts] = useState<Record<string, number>>(
    {},
  );
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIndustry, setNewIndustry] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      const [companiesData, contactsData, leadsData] = await Promise.all([
        fetchCompaniesAction(),
        fetchContactsAction(),
        fetchLeadsAction(),
      ]);
      setCompanies(companiesData);
      const cc: Record<string, number> = {};
      const lc: Record<string, number> = {};
      for (const c of contactsData) {
        if (c.companyId) cc[c.companyId] = (cc[c.companyId] ?? 0) + 1;
      }
      for (const l of leadsData) {
        if (l.companyId) lc[l.companyId] = (lc[l.companyId] ?? 0) + 1;
      }
      setContactCounts(cc);
      setLeadCounts(lc);
      setIsLoading(false);
    }
    load();
  }, []);

  async function handleCreateCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Création du client...");
    const res = await createCompanyAction({
      name: newName.trim(),
      industry: newIndustry.trim() || undefined,
      website: newWebsite.trim() || undefined,
    });
    if (res.success && res.company) {
      setCompanies((prev) =>
        [...prev, res.company!].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewName("");
      setNewIndustry("");
      setNewWebsite("");
      setIsAddOpen(false);
      toast.success("Client créé !", { id: toastId });
    } else {
      toast.error(res.error ?? "Erreur lors de la création", { id: toastId });
    }
    setIsSubmitting(false);
  }

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: "var(--maison-border)" }}
      >
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--maison-brass)" }}
          >
            CRM · Clients
          </p>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl"
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              color: "var(--maison-text-primary)",
            }}
          >
            Fiches clients
          </h1>
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            Gérez vos entreprises clientes, contacts et projets associés.
          </p>
        </div>
        <button
          id="btn-add-client"
          onClick={() => setIsAddOpen(true)}
          className="inline-flex items-center gap-2 self-start rounded-lg px-4 py-2.5 text-xs font-bold shadow-sm transition"
          style={{
            background: "var(--maison-brass)",
            color: "var(--maison-brass-text)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--maison-brass-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--maison-brass)";
          }}
        >
          <Plus className="h-4 w-4" />
          Nouveau client
        </button>
      </div>

      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
          style={{ color: "var(--maison-text-muted)" }}
        />
        <input
          id="client-search"
          type="text"
          placeholder="Rechercher un client..."
          className="w-full rounded-lg border py-2 pl-9 pr-3 text-xs outline-none transition"
          style={{
            borderColor: "var(--maison-border)",
            background: "var(--maison-page)",
            color: "var(--maison-text-primary)",
          }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2
            className="h-5 w-5 animate-spin"
            style={{ color: "var(--maison-brass)" }}
          />
          <span
            className="ml-3 text-xs"
            style={{ color: "var(--maison-text-muted)" }}
          >
            Chargement des clients…
          </span>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center"
          style={{
            borderColor: "var(--maison-border)",
            background: "var(--maison-card)",
          }}
        >
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: "rgba(201,168,76,0.1)" }}
          >
            <Building2
              className="h-7 w-7"
              style={{ color: "var(--maison-brass)" }}
            />
          </div>
          <h3
            className="mt-4 text-base font-semibold"
            style={{ color: "var(--maison-text-primary)" }}
          >
            {search ? "Aucun client trouvé" : "Aucun client encore"}
          </h3>
          <p
            className="mt-1.5 text-sm"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            {search
              ? "Essayez une autre recherche."
              : "Créez votre premier client pour commencer."}
          </p>
          {!search && (
            <button
              className="mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold shadow-sm transition"
              style={{
                background: "var(--maison-brass)",
                color: "var(--maison-brass-text)",
              }}
              onClick={() => setIsAddOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Nouveau client
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((company) => {
            const nbContacts = contactCounts[company.id] ?? 0;
            const nbLeads = leadCounts[company.id] ?? 0;
            return (
              <Link
                key={company.id}
                href={`/dashboard/clients/${company.id}`}
                id={`client-card-${company.id}`}
                className="group relative flex flex-col gap-4 rounded-xl p-5 shadow-sm transition-all hover:shadow-md"
                style={{
                  background: "var(--maison-card)",
                  border: "1px solid var(--maison-border)",
                }}
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: "rgba(201,168,76,0.12)",
                      color: "var(--maison-brass)",
                    }}
                  >
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3
                      className="truncate text-sm font-bold"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {company.name}
                    </h3>
                    {company.driveFolderUrl && (
                      <div
                        className="mt-0.5 flex items-center gap-1 text-xs"
                        style={{ color: "var(--maison-text-muted)" }}
                      >
                        <FolderOpen className="h-3 w-3" />
                        <span>Drive synchronisé</span>
                      </div>
                    )}
                  </div>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5"
                    style={{ color: "var(--maison-text-muted)" }}
                  />
                </div>

                {/* Stats */}
                <div
                  className="flex gap-4 border-t pt-3"
                  style={{ borderColor: "var(--maison-border)" }}
                >
                  <div
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    <Users
                      className="h-3.5 w-3.5"
                      style={{ color: "var(--maison-text-muted)" }}
                    />
                    <span>
                      <span
                        className="font-semibold"
                        style={{ color: "var(--maison-text-primary)" }}
                      >
                        {nbContacts}
                      </span>{" "}
                      contact{nbContacts !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    <Briefcase
                      className="h-3.5 w-3.5"
                      style={{ color: "var(--maison-text-muted)" }}
                    />
                    <span>
                      <span
                        className="font-semibold"
                        style={{ color: "var(--maison-text-primary)" }}
                      >
                        {nbLeads}
                      </span>{" "}
                      projet{nbLeads !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {company.driveFolderUrl && (
                    <div
                      className="ml-auto flex items-center gap-1 text-xs"
                      style={{ color: "var(--maison-brass)" }}
                    >
                      <Globe className="h-3 w-3" />
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Add Client Modal */}
      {isAddOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl shadow-2xl"
            style={{
              background: "var(--maison-card)",
              border: "1px solid var(--maison-border)",
            }}
          >
            <div
              className="flex items-center justify-between border-b px-6 py-4"
              style={{ borderColor: "var(--maison-border)" }}
            >
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--maison-brass)" }}
                >
                  CRM · Clients
                </p>
                <h2
                  className="text-base font-bold"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Nouveau client
                </h2>
              </div>
              <button
                onClick={() => setIsAddOpen(false)}
                className="rounded-md p-1.5 transition"
                style={{ color: "var(--maison-text-muted)" }}
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCompany} className="space-y-4 p-6">
              {[
                {
                  id: "new-company-name",
                  label: "Nom du client *",
                  placeholder: "Ex: Atlas Telecom",
                  value: newName,
                  setter: setNewName,
                  required: true,
                },
                {
                  id: "new-company-industry",
                  label: "Secteur d'activité",
                  placeholder: "Ex: Télécommunications, Immobilier...",
                  value: newIndustry,
                  setter: setNewIndustry,
                  required: false,
                },
                {
                  id: "new-company-website",
                  label: "Site web",
                  placeholder: "https://...",
                  value: newWebsite,
                  setter: setNewWebsite,
                  required: false,
                },
              ].map((field) => (
                <div key={field.id} className="space-y-1.5">
                  <label
                    className="text-xs font-semibold"
                    htmlFor={field.id}
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    {field.label}
                  </label>
                  <input
                    id={field.id}
                    className="flex h-9 w-full rounded-lg border px-3 py-2 text-xs outline-none transition"
                    style={{
                      borderColor: "var(--maison-border)",
                      background: "var(--maison-page)",
                      color: "var(--maison-text-primary)",
                    }}
                    required={field.required}
                    placeholder={field.placeholder}
                    value={field.value}
                    onChange={(e) => field.setter(e.target.value)}
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  className="flex-1 rounded-lg border py-2.5 text-xs font-semibold transition"
                  style={{
                    borderColor: "var(--maison-border)",
                    color: "var(--maison-text-secondary)",
                    background: "transparent",
                  }}
                  onClick={() => setIsAddOpen(false)}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold shadow-sm transition"
                  style={{
                    background: "var(--maison-brass)",
                    color: "var(--maison-brass-text)",
                    opacity: isSubmitting || !newName.trim() ? 0.6 : 1,
                  }}
                  disabled={isSubmitting || !newName.trim()}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Créer le client
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
