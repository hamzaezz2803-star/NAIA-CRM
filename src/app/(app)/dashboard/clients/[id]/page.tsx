"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Globe,
  Users,
  Briefcase,
  FolderOpen,
  Mail,
  Phone,
  ExternalLink,
  ArrowLeft,
  Loader2,
  Edit3,
  X,
  Check,
  Plus,
  FileText,
  CalendarDays,
  ChevronRight,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  fetchCompanyDetailAction,
  updateCompanyAction,
  createContactAction,
  fetchTagsAction,
  updateContactAction,
  deleteContactAction,
} from "@/features/crm/actions";
import type {
  CrmCompanyDetail,
  CrmContactSummary,
  CrmLeadSummary,
  CrmTag,
} from "@/features/crm/contracts";
import toast from "react-hot-toast";

const inputCls =
  "flex h-9 w-full rounded-lg border px-3 py-2 text-xs outline-none transition" +
  " [border-color:var(--maison-border)] [background:var(--maison-page)] [color:var(--maison-text-primary)]";

const statusLabels: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  "lead-to-contact": {
    label: "À contacter",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
  },
  contacted: {
    label: "Contacté",
    color: "bg-stone-50 text-stone-600 border-stone-200",
    dot: "bg-stone-400",
  },
  "to-follow-up": {
    label: "À relancer",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  "meeting-booked": {
    label: "RDV planifié",
    color: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-500",
  },
  "proposal-sent": {
    label: "Proposition envoyée",
    color: "bg-purple-50 text-purple-700 border-purple-200",
    dot: "bg-purple-500",
  },
  won: {
    label: "Gagné",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  "dead-end": {
    label: "Sans suite",
    color: "bg-red-50 text-red-600 border-red-200",
    dot: "bg-red-400",
  },
};

const tagColors: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30",
  gray: "bg-stone-50 text-stone-600 border-stone-200 dark:bg-stone-900/50 dark:text-stone-400 dark:border-stone-800",
  yellow:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30",
  indigo:
    "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-900/30",
  emerald:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30",
  teal: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-900/30",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30",
  purple:
    "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/30",
  pink: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/20 dark:text-pink-400 dark:border-pink-900/30",
  orange:
    "bg-orange-50 text-orange-750 border-orange-200 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-900/30",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusLabels[status] ?? {
    label: status,
    color: "bg-stone-50 text-stone-600 border-stone-200",
    dot: "bg-stone-400",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.color}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[10px] font-bold uppercase tracking-[0.08em]"
      style={{ color: "var(--maison-text-muted)" }}
    >
      {children}
    </h2>
  );
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const companyId = params.id as string;

  const [company, setCompany] = useState<CrmCompanyDetail | null>(null);
  const [contacts, setContacts] = useState<CrmContactSummary[]>([]);
  const [leads, setLeads] = useState<CrmLeadSummary[]>([]);
  const [allTags, setAllTags] = useState<CrmTag[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Edit mode for company info
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editName, setEditName] = useState("");
  const [editIndustry, setEditIndustry] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [isSavingInfo, setIsSavingInfo] = useState(false);

  // Add contact modal
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactJob, setContactJob] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactLinkedin, setContactLinkedin] = useState("");
  const [contactTags, setContactTags] = useState<string[]>([]);
  const [isAddingContact, setIsAddingContact] = useState(false);

  // Edit contact modal
  const [isEditContactOpen, setIsEditContactOpen] = useState(false);
  const [editingContact, setEditingContact] =
    useState<CrmContactSummary | null>(null);
  const [editContactName, setEditContactName] = useState("");
  const [editContactJob, setEditContactJob] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editContactPhone, setEditContactPhone] = useState("");
  const [editContactLinkedin, setEditContactLinkedin] = useState("");
  const [editContactTags, setEditContactTags] = useState<string[]>([]);
  const [isSavingContact, setIsSavingContact] = useState(false);

  useEffect(() => {
    Promise.all([fetchCompanyDetailAction(companyId), fetchTagsAction()]).then(
      ([{ company, contacts, leads }, tagsData]) => {
        setCompany(company);
        setContacts(contacts);
        setLeads(leads);
        setAllTags(tagsData);
        if (company) {
          setEditName(company.name);
          setEditIndustry(company.industry ?? "");
          setEditWebsite(company.website ?? "");
          setEditNotes(company.notes ?? "");
        }
        setIsLoading(false);
      },
    );
  }, [companyId]);

  async function handleSaveInfo() {
    if (!company || !editName.trim()) return;
    setIsSavingInfo(true);
    const toastId = toast.loading("Sauvegarde...");
    const res = await updateCompanyAction(companyId, {
      name: editName.trim(),
      industry: editIndustry.trim(),
      website: editWebsite.trim(),
      notes: editNotes.trim(),
    });
    if (res.success) {
      setCompany((prev) =>
        prev
          ? {
              ...prev,
              name: editName.trim(),
              industry: editIndustry.trim() || undefined,
              website: editWebsite.trim() || undefined,
              notes: editNotes.trim() || undefined,
            }
          : prev,
      );
      setIsEditingInfo(false);
      toast.success("Client mis à jour !", { id: toastId });
    } else {
      toast.error(res.error ?? "Erreur", { id: toastId });
    }
    setIsSavingInfo(false);
  }

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    if (!contactName.trim()) return;
    setIsAddingContact(true);
    const toastId = toast.loading("Ajout du contact...");
    const res = await createContactAction({
      name: contactName.trim(),
      companyId,
      jobTitle: contactJob.trim() || undefined,
      email: contactEmail.trim() || undefined,
      phone: contactPhone.trim() || undefined,
      linkedinUrl: contactLinkedin.trim() || undefined,
      tagIds: contactTags,
    });
    if (res.success && res.contact) {
      setContacts((prev) =>
        [...prev, res.contact!].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setContactName("");
      setContactJob("");
      setContactEmail("");
      setContactPhone("");
      setContactLinkedin("");
      setContactTags([]);
      setIsAddContactOpen(false);
      toast.success("Contact ajouté !", { id: toastId });
    } else {
      toast.error(res.error ?? "Erreur", { id: toastId });
    }
    setIsAddingContact(false);
  }

  async function handleEditContact(e: React.FormEvent) {
    e.preventDefault();
    if (!editingContact || !editContactName.trim()) return;
    setIsSavingContact(true);
    const toastId = toast.loading("Mise à jour du contact...");
    const res = await updateContactAction(editingContact.id, {
      name: editContactName.trim(),
      companyId,
      jobTitle: editContactJob.trim() || undefined,
      email: editContactEmail.trim() || undefined,
      phone: editContactPhone.trim() || undefined,
      linkedinUrl: editContactLinkedin.trim() || undefined,
      tagIds: editContactTags,
    });
    if (res.success && res.contact) {
      setContacts((prev) =>
        prev.map((c) => (c.id === editingContact.id ? res.contact! : c)),
      );
      setIsEditContactOpen(false);
      setEditingContact(null);
      toast.success("Contact mis à jour !", { id: toastId });
    } else {
      toast.error(res.error ?? "Erreur", { id: toastId });
    }
    setIsSavingContact(false);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
        <span className="ml-3 text-sm text-stone-500">
          Chargement de la fiche client…
        </span>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex flex-col items-center py-24 text-center">
        <Building2 className="h-10 w-10 text-stone-300" />
        <p className="mt-4 text-base font-semibold text-stone-700">
          Client introuvable
        </p>
        <p className="mt-1 text-sm text-stone-500">
          {"Ce client n'existe pas ou vous n'y avez pas accès."}
        </p>
        <Button
          className="mt-6 gap-2"
          variant="outline"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div
        className="flex flex-col gap-2 border-b pb-4"
        style={{ borderColor: "var(--maison-border)" }}
      >
        <Link
          href="/dashboard/clients"
          className="inline-flex items-center gap-1.5 text-xs font-medium transition hover:opacity-70 w-fit"
          style={{ color: "var(--maison-text-muted)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tous les clients
        </Link>
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--maison-brass)" }}
          >
            CRM · Fiche client
          </p>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl"
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              color: "var(--maison-text-primary)",
            }}
          >
            {company.name}
          </h1>
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            {[company.industry, company.website].filter(Boolean).join(" · ") ||
              "Informations générales, contacts et projets."}
          </p>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* LEFT COLUMN — Info + Contacts */}
        <div className="space-y-6 lg:col-span-1">
          {/* ── Informations générales ── */}
          <section
            className="rounded-xl shadow-sm"
            style={{
              background: "var(--maison-card)",
              border: "1px solid var(--maison-border)",
            }}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: "var(--maison-border)" }}
            >
              <SectionTitle>Informations générales</SectionTitle>
              {!isEditingInfo ? (
                <button
                  id="btn-edit-company-info"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition hover:opacity-70"
                  style={{
                    color: "var(--maison-brass)",
                    background: "rgba(201,168,76,0.08)",
                  }}
                  onClick={() => setIsEditingInfo(true)}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Modifier
                </button>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition hover:opacity-70"
                    style={{ color: "var(--maison-text-muted)" }}
                    onClick={() => {
                      setIsEditingInfo(false);
                      setEditName(company.name);
                      setEditIndustry(company.industry ?? "");
                      setEditWebsite(company.website ?? "");
                      setEditNotes(company.notes ?? "");
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition hover:opacity-80"
                    style={{
                      background: "var(--maison-brass)",
                      color: "var(--maison-brass-text)",
                    }}
                    onClick={handleSaveInfo}
                    disabled={isSavingInfo}
                  >
                    {isSavingInfo ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Sauvegarder
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4 p-5">
              {isEditingInfo ? (
                <>
                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium text-stone-600"
                      htmlFor="edit-company-name"
                    >
                      Nom
                    </label>
                    <input
                      id="edit-company-name"
                      className={inputCls}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium text-stone-600"
                      htmlFor="edit-company-industry"
                    >
                      Secteur
                    </label>
                    <input
                      id="edit-company-industry"
                      className={inputCls}
                      placeholder="Ex: Télécommunications"
                      value={editIndustry}
                      onChange={(e) => setEditIndustry(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium text-stone-600"
                      htmlFor="edit-company-website"
                    >
                      Site web
                    </label>
                    <input
                      id="edit-company-website"
                      className={inputCls}
                      placeholder="https://..."
                      value={editWebsite}
                      onChange={(e) => setEditWebsite(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium text-stone-600"
                      htmlFor="edit-company-notes"
                    >
                      Notes internes
                    </label>
                    <textarea
                      id="edit-company-notes"
                      className="flex w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-950 placeholder:text-stone-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 transition"
                      rows={3}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <InfoRow icon={Building2} label="Nom" value={company.name} />
                  <InfoRow
                    icon={Briefcase}
                    label="Secteur"
                    value={company.industry}
                  />
                  <InfoRow
                    icon={Globe}
                    label="Site web"
                    value={company.website}
                    href={company.website}
                  />
                  {company.driveFolderUrl && (
                    <InfoRow
                      icon={FolderOpen}
                      label="Google Drive"
                      value="Ouvrir le dossier"
                      href={company.driveFolderUrl}
                    />
                  )}
                  {company.notes && (
                    <div className="rounded-lg bg-stone-50 px-3 py-2.5 text-sm text-stone-700">
                      {company.notes}
                    </div>
                  )}
                  {!company.industry && !company.website && !company.notes && (
                    <p className="text-xs italic text-stone-400">
                      Aucune information complémentaire.
                    </p>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ── Contacts ── */}
          <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
              <SectionTitle>Contacts ({contacts.length})</SectionTitle>
              <Button
                id="btn-add-contact"
                variant="ghost"
                className="h-8 gap-1.5 px-2.5 text-xs text-stone-600 hover:text-teal-700"
                onClick={() => setIsAddContactOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter
              </Button>
            </div>

            {contacts.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Users className="mx-auto h-8 w-8 text-stone-200" />
                <p className="mt-2 text-sm text-stone-500">
                  Aucun contact lié.
                </p>
                <Button
                  className="mt-3 gap-1.5 text-xs"
                  variant="outline"
                  onClick={() => setIsAddContactOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ajouter un contact
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-stone-100">
                {contacts.map((contact) => (
                  <li key={contact.id} className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-700">
                        {contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-stone-900">
                            {contact.name}
                          </p>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingContact(contact);
                                setEditContactName(contact.name);
                                setEditContactJob(contact.jobTitle ?? "");
                                setEditContactEmail(contact.email ?? "");
                                setEditContactPhone(contact.phone ?? "");
                                setEditContactLinkedin(
                                  contact.linkedinUrl ?? "",
                                );
                                setEditContactTags(
                                  (contact.tags ?? []).map((t) => t.id),
                                );
                                setIsEditContactOpen(true);
                              }}
                              style={{ color: "var(--maison-text-muted)" }}
                              className="p-0.5 rounded transition hover:opacity-70"
                              title="Modifier le contact"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const confirm = window.confirm(
                                  `Supprimer le contact ${contact.name} ?`,
                                );
                                if (!confirm) return;
                                const res = await deleteContactAction(
                                  contact.id,
                                );
                                if (res.success) {
                                  setContacts((prev) =>
                                    prev.filter((c) => c.id !== contact.id),
                                  );
                                  toast.success("Contact supprimé.");
                                } else {
                                  toast.error(res.error ?? "Erreur");
                                }
                              }}
                              className="text-stone-400 hover:text-red-650 p-0.5 rounded transition"
                              title="Supprimer le contact"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        {contact.jobTitle && (
                          <p className="text-xs text-stone-500">
                            {contact.jobTitle}
                          </p>
                        )}
                        {contact.tags && contact.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {contact.tags.map((t) => (
                              <span
                                key={t.id}
                                className={`inline-flex items-center rounded-full border px-1.5 py-0.2 text-[9px] font-bold ${
                                  tagColors[t.color] ||
                                  "bg-stone-50 text-stone-655 border-stone-200"
                                }`}
                              >
                                {t.name}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {contact.email && (
                            <a
                              href={`mailto:${contact.email}`}
                              className="flex items-center gap-1 text-xs hover:underline"
                              style={{ color: "var(--maison-brass)" }}
                            >
                              <Mail className="h-3 w-3" />
                              {contact.email}
                            </a>
                          )}
                          {contact.phone && (
                            <a
                              href={`tel:${contact.phone}`}
                              className="flex items-center gap-1 text-xs hover:underline"
                              style={{ color: "var(--maison-text-secondary)" }}
                            >
                              <Phone className="h-3 w-3" />
                              {contact.phone}
                            </a>
                          )}
                          {contact.linkedinUrl && (
                            <a
                              href={
                                contact.linkedinUrl.startsWith("http")
                                  ? contact.linkedinUrl
                                  : `https://${contact.linkedinUrl}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                className="h-3 w-3 text-blue-600"
                              >
                                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                              </svg>
                              LinkedIn
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN — Projects + Invoices */}
        <div className="space-y-6 lg:col-span-2">
          {/* ── Projets / Leads ── */}
          <section
            className="rounded-xl shadow-sm"
            style={{
              background: "var(--maison-card)",
              border: "1px solid var(--maison-border)",
            }}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: "var(--maison-border)" }}
            >
              <SectionTitle>Projets ({leads.length})</SectionTitle>
              <Link
                href="/dashboard/leads"
                className="flex items-center gap-1.5 text-xs font-semibold transition hover:opacity-70"
                style={{ color: "var(--maison-brass)" }}
              >
                Voir le kanban
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            {leads.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Briefcase className="mx-auto h-8 w-8 text-stone-200" />
                <p className="mt-2 text-sm text-stone-500">
                  Aucun projet associé à ce client.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-stone-100">
                {leads.map((lead) => {
                  const noteLines = (lead.notes ?? "").split("\n");
                  const contactName =
                    noteLines
                      .find((l) => l.startsWith("Contact:"))
                      ?.replace("Contact:", "")
                      .trim() ?? undefined;

                  return (
                    <li
                      key={lead.id}
                      className="px-5 py-4 hover:bg-stone-50 transition"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-stone-900 truncate">
                              {lead.topic}
                            </p>
                            <StatusBadge status={lead.status} />
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-stone-500">
                            {contactName && (
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {contactName}
                              </span>
                            )}
                            {lead.leadDate && (
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                {new Date(lead.leadDate).toLocaleDateString(
                                  "fr-FR",
                                  {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  },
                                )}
                              </span>
                            )}
                            {lead.nextAction && (
                              <span className="flex items-center gap-1 text-teal-700">
                                <ChevronRight className="h-3 w-3" />
                                {lead.nextAction}
                              </span>
                            )}
                            {lead.source && (
                              <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600">
                                {lead.source}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── Factures (placeholder) ── */}
          <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
              <SectionTitle>Factures</SectionTitle>
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                Planifié
              </span>
            </div>
            <div className="flex flex-col items-center py-12 text-center px-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-50">
                <FileText className="h-7 w-7 text-stone-300" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-stone-700">
                Module Factures à venir
              </h3>
              <p className="mt-1.5 max-w-xs text-xs text-stone-500 leading-5">
                La gestion des factures clients (devis, acomptes, factures
                finales) sera disponible dans le module Finance.
              </p>
              <div className="mt-4 flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
                <Sparkles className="h-3.5 w-3.5 text-teal-500" />
                Prévu pour le Sprint 3
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Add Contact Modal */}
      {isAddContactOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddContactOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
              <h2 className="text-base font-bold text-stone-900">
                Nouveau contact
              </h2>
              <button
                onClick={() => setIsAddContactOpen(false)}
                className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddContact} className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="add-contact-name"
                >
                  Nom *
                </label>
                <input
                  id="add-contact-name"
                  className={inputCls}
                  required
                  placeholder="Ex: Karim Saidi"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="add-contact-job"
                >
                  Fonction / Poste
                </label>
                <input
                  id="add-contact-job"
                  className={inputCls}
                  placeholder="Ex: CEO, CTO, Manager..."
                  value={contactJob}
                  onChange={(e) => setContactJob(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="add-contact-email"
                >
                  Email
                </label>
                <input
                  id="add-contact-email"
                  className={inputCls}
                  type="email"
                  placeholder="Ex: karim@atlas.ma"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="add-contact-phone"
                >
                  Téléphone
                </label>
                <input
                  id="add-contact-phone"
                  className={inputCls}
                  placeholder="Ex: +212 600000000"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="add-contact-linkedin"
                >
                  LinkedIn
                </label>
                <input
                  id="add-contact-linkedin"
                  className={inputCls}
                  placeholder="https://linkedin.com/in/..."
                  value={contactLinkedin}
                  onChange={(e) => setContactLinkedin(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-stone-805 block">
                  Tags associés
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((t) => {
                    const isSelected = contactTags.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setContactTags((prev) =>
                            isSelected
                              ? prev.filter((id) => id !== t.id)
                              : [...prev, t.id],
                          );
                        }}
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${
                          isSelected
                            ? tagColors[t.color] ||
                              "bg-teal-50 text-teal-700 border-teal-200"
                            : "bg-stone-50 text-stone-500 border-stone-200 hover:border-stone-300"
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                  {allTags.length === 0 && (
                    <span className="text-xs text-stone-400 italic">
                      Aucun tag disponible. Créez-en dans le dashboard leads.
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setIsAddContactOpen(false);
                    setContactTags([]);
                  }}
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  className="flex-1 gap-2 bg-teal-700 hover:bg-teal-800 text-white"
                  disabled={isAddingContact || !contactName.trim()}
                >
                  {isAddingContact ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Ajouter
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Contact Modal */}
      {isEditContactOpen && editingContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsEditContactOpen(false);
              setEditingContact(null);
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
              <h2 className="text-base font-bold text-stone-900">
                Modifier le contact
              </h2>
              <button
                onClick={() => {
                  setIsEditContactOpen(false);
                  setEditingContact(null);
                }}
                className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEditContact} className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="edit-contact-name"
                >
                  Nom *
                </label>
                <input
                  id="edit-contact-name"
                  className={inputCls}
                  required
                  placeholder="Ex: Karim Saidi"
                  value={editContactName}
                  onChange={(e) => setEditContactName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="edit-contact-job"
                >
                  Fonction / Poste
                </label>
                <input
                  id="edit-contact-job"
                  className={inputCls}
                  placeholder="Ex: CEO, CTO, Manager..."
                  value={editContactJob}
                  onChange={(e) => setEditContactJob(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="edit-contact-email"
                >
                  Email
                </label>
                <input
                  id="edit-contact-email"
                  className={inputCls}
                  type="email"
                  placeholder="Ex: karim@atlas.ma"
                  value={editContactEmail}
                  onChange={(e) => setEditContactEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="edit-contact-phone"
                >
                  Téléphone
                </label>
                <input
                  id="edit-contact-phone"
                  className={inputCls}
                  placeholder="Ex: +212 600000000"
                  value={editContactPhone}
                  onChange={(e) => setEditContactPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="edit-contact-linkedin"
                >
                  LinkedIn
                </label>
                <input
                  id="edit-contact-linkedin"
                  className={inputCls}
                  placeholder="https://linkedin.com/in/..."
                  value={editContactLinkedin}
                  onChange={(e) => setEditContactLinkedin(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-stone-800 block">
                  Tags associés
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((t) => {
                    const isSelected = editContactTags.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setEditContactTags((prev) =>
                            isSelected
                              ? prev.filter((id) => id !== t.id)
                              : [...prev, t.id],
                          );
                        }}
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${
                          isSelected
                            ? tagColors[t.color] ||
                              "bg-teal-50 text-teal-700 border-teal-200"
                            : "bg-stone-50 text-stone-500 border-stone-200 hover:border-stone-300"
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                  {allTags.length === 0 && (
                    <span className="text-xs text-stone-400 italic">
                      Aucun tag disponible. Créez-en dans le dashboard leads.
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setIsEditContactOpen(false);
                    setEditingContact(null);
                  }}
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  className="flex-1 gap-2 bg-teal-700 hover:bg-teal-800 text-white"
                  disabled={isSavingContact || !editContactName.trim()}
                >
                  {isSavingContact ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Sauvegarder
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
  href?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-stone-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-stone-500">{label}</p>
        {href ? (
          <a
            href={href.startsWith("http") ? href : `https://${href}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-medium text-teal-700 hover:underline"
          >
            {value}
          </a>
        ) : (
          <p className="truncate text-sm font-medium text-stone-800">{value}</p>
        )}
      </div>
    </div>
  );
}
