"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import {
  fetchCompaniesAction,
  fetchContactsAction,
  fetchLeadsAction,
  createCompanyAction,
} from "@/features/crm/actions";
import type { CrmCompanySummary } from "@/features/crm/contracts";
import toast from "react-hot-toast";

const inputCls =
  "flex h-10 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-950 placeholder:text-stone-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 transition";

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

      // Count contacts and leads per company
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="CRM · Clients"
        title="Fiches clients"
        description="Consultez et gérez toutes vos entreprises clientes avec leurs contacts et projets associés."
        actions={
          <Button
            id="btn-add-client"
            onClick={() => setIsAddOpen(true)}
            className="gap-2 bg-teal-700 hover:bg-teal-800 text-white"
          >
            <Plus className="h-4 w-4" />
            Nouveau client
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-sm">
        <input
          id="client-search"
          className={inputCls}
          placeholder="Rechercher un client..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
          <span className="ml-3 text-sm text-stone-500">
            Chargement des clients…
          </span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50">
            <Building2 className="h-7 w-7 text-teal-600" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-stone-800">
            {search ? "Aucun client trouvé" : "Aucun client encore"}
          </h3>
          <p className="mt-1.5 text-sm text-stone-500">
            {search
              ? "Essayez une autre recherche."
              : "Créez votre premier client pour commencer."}
          </p>
          {!search && (
            <Button
              className="mt-5 gap-2 bg-teal-700 hover:bg-teal-800 text-white"
              onClick={() => setIsAddOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Nouveau client
            </Button>
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
                className="group relative flex flex-col gap-4 rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-bold text-stone-900 group-hover:text-teal-800">
                      {company.name}
                    </h3>
                    {company.driveFolderUrl && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-stone-500">
                        <FolderOpen className="h-3 w-3" />
                        <span>Drive synchronisé</span>
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-teal-500" />
                </div>

                {/* Stats */}
                <div className="flex gap-4 border-t border-stone-100 pt-3">
                  <div className="flex items-center gap-1.5 text-xs text-stone-600">
                    <Users className="h-3.5 w-3.5 text-stone-400" />
                    <span>
                      <span className="font-semibold text-stone-800">
                        {nbContacts}
                      </span>{" "}
                      contact{nbContacts !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-stone-600">
                    <Briefcase className="h-3.5 w-3.5 text-stone-400" />
                    <span>
                      <span className="font-semibold text-stone-800">
                        {nbLeads}
                      </span>{" "}
                      projet{nbLeads !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {company.driveFolderUrl && (
                    <div className="ml-auto flex items-center gap-1 text-xs text-teal-600">
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
              <h2 className="text-base font-bold text-stone-900">
                Nouveau client
              </h2>
              <button
                onClick={() => setIsAddOpen(false)}
                className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCompany} className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="new-company-name"
                >
                  Nom du client *
                </label>
                <input
                  id="new-company-name"
                  className={inputCls}
                  required
                  placeholder="Ex: Atlas Telecom"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="new-company-industry"
                >
                  Secteur d&apos;activité
                </label>
                <input
                  id="new-company-industry"
                  className={inputCls}
                  placeholder="Ex: Télécommunications, Immobilier..."
                  value={newIndustry}
                  onChange={(e) => setNewIndustry(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="new-company-website"
                >
                  Site web
                </label>
                <input
                  id="new-company-website"
                  className={inputCls}
                  placeholder="https://..."
                  value={newWebsite}
                  onChange={(e) => setNewWebsite(e.target.value)}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setIsAddOpen(false)}
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  className="flex-1 gap-2 bg-teal-700 hover:bg-teal-800 text-white"
                  disabled={isSubmitting || !newName.trim()}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Créer le client
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
