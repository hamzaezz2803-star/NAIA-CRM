"use client";

import React, { useState, useEffect, useTransition } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Bot,
  Mail,
  Phone,
  Loader2,
  Sparkles,
  AlertCircle,
  X,
  MoveRight,
  Trash2,
  Calendar,
  Building2,
  User,
  Globe,
  LogOut,
  FolderPlus,
  CheckCircle,
  LayoutGrid,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
} from "lucide-react";
import {
  fetchLeadsAction,
  createLeadAction,
  updateLeadStatusAction,
  deleteLeadAction,
  extractLeadFromNaturalTextAction,
  generateFollowUpDraftAction,
  checkGoogleAuthAction,
  disconnectGoogleAuthAction,
  createGoogleDriveFolderAction,
  updateLeadAction,
  syncLeadToGoogleCalendarAction,
} from "@/features/crm/actions";
import type { CrmLeadSummary, CrmLeadStatus } from "@/features/crm/contracts";

// ────────────────────────────────────────────────────────────
// Column config aligned with DB status values
// ────────────────────────────────────────────────────────────

const COLUMNS: {
  label: string;
  status: CrmLeadStatus;
  color: string;
  dot: string;
  border: string;
}[] = [
  {
    label: "À contacter",
    status: "lead-to-contact",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
    border: "border-blue-200",
  },
  {
    label: "Contacté",
    status: "contacted",
    color: "bg-stone-50 text-stone-600 border-stone-200",
    dot: "bg-stone-400",
    border: "border-stone-200",
  },
  {
    label: "À relancer",
    status: "to-follow-up",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
    border: "border-amber-200",
  },
  {
    label: "Meeting fixé",
    status: "meeting-booked",
    color: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-500",
    border: "border-indigo-200",
  },
  {
    label: "Propale envoyée",
    status: "proposal-sent",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
    border: "border-emerald-200",
  },
  {
    label: "Gagné ✓",
    status: "won",
    color: "bg-teal-50 text-teal-700 border-teal-200",
    dot: "bg-teal-500",
    border: "border-teal-200",
  },
  {
    label: "Dead end",
    status: "dead-end",
    color: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-400",
    border: "border-red-200",
  },
];

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const [leads, setLeads] = useState<CrmLeadSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [, startTransition] = useTransition();

  // Mode & Google auth states
  const [viewMode, setViewMode] = useState<"kanban" | "calendar" | "list">(
    "kanban",
  );
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);

  // Modal states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<CrmLeadSummary | null>(null);

  // Natural text intake
  const [naturalText, setNaturalText] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Form fields (from extracted or manual)
  const [formTopic, setFormTopic] = useState("");
  const [formCompanyName, setFormCompanyName] = useState("");
  const [formContactName, setFormContactName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formSource, setFormSource] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formNextAction, setFormNextAction] = useState("");
  const [formNextActionDate, setFormNextActionDate] = useState("");
  const [formStatus, setFormStatus] =
    useState<CrmLeadStatus>("lead-to-contact");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Follow-up drafts state
  const [draftLead, setDraftLead] = useState<CrmLeadSummary | null>(null);
  const [drafts, setDrafts] = useState<{
    email: string;
    whatsapp: string;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Google Drive folder creation state
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const [calendarLink, setCalendarLink] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Helper: extract a Google Drive link already stored in lead notes
  const extractDriveLinkFromNotes = (notes?: string): string | null => {
    if (!notes) return null;
    const match = notes.match(
      /\[Google Drive Folder:[^\]]*\]\((https:\/\/[^)]+)\)/,
    );
    return match ? match[1] : null;
  };

  const extractCalendarLinkFromNotes = (notes?: string): string | null => {
    if (!notes) return null;
    const match = notes.match(/\[Google Calendar Event Link:\s*([^\]]+)\]/);
    return match ? match[1].trim() : null;
  };

  // Load data on mount
  useEffect(() => {
    loadLeads();
    checkGoogleAuth();
  }, []);

  // Listen for Google Auth callback popup messaging
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "GOOGLE_AUTH_SUCCESS") {
        setIsGoogleConnected(true);
        setFormError(null);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  async function loadLeads() {
    setIsLoading(true);
    const data = await fetchLeadsAction();
    setLeads(data);
    setIsLoading(false);
  }

  async function checkGoogleAuth() {
    const isAuth = await checkGoogleAuthAction();
    setIsGoogleConnected(isAuth);
  }

  // Trigger Google Login popup
  const handleConnectGoogle = () => {
    const width = 500;
    const height = 600;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    window.open(
      "/api/integrations/google/auth",
      "GoogleAuth",
      `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`,
    );
  };

  // Disconnect Google
  const handleDisconnectGoogle = async () => {
    const res = await disconnectGoogleAuthAction();
    if (res.success) {
      setIsGoogleConnected(false);
    }
  };

  // ── AI extraction ──────────────────────────────────────
  async function handleExtract() {
    if (!naturalText.trim()) return;
    setIsExtracting(true);
    setExtractError(null);

    const res = await extractLeadFromNaturalTextAction(naturalText);

    if (res.success && res.extracted) {
      const e = res.extracted;
      setFormTopic(e.topic ?? "");
      setFormCompanyName(e.companyName ?? "");
      setFormContactName(e.contactName ?? "");
      setFormEmail(e.contactEmail ?? "");
      setFormPhone(e.contactPhone ?? "");
      setFormSource(e.source ?? "");
      setFormNotes(e.notes ?? "");
      setFormNextAction(e.nextAction ?? "");
      setFormNextActionDate(e.nextActionDate ?? "");
      if (e.nextActionDate) {
        setFormStatus("to-follow-up");
      }
    } else {
      setExtractError(res.error ?? "Extraction échouée");
    }
    setIsExtracting(false);
  }

  // ── Create lead ─────────────────────────────────────────
  async function handleCreateLead(e: React.FormEvent) {
    e.preventDefault();
    if (!formTopic.trim()) {
      setFormError("Le sujet est obligatoire.");
      return;
    }
    setIsSubmitting(true);
    setFormError(null);

    // Concat company info inside notes for simple display
    const res = await createLeadAction({
      topic: formTopic,
      source: formSource || undefined,
      status: formStatus,
      notes:
        [
          formCompanyName && `Entreprise: ${formCompanyName}`,
          formContactName && `Contact: ${formContactName}`,
          formEmail && `Email: ${formEmail}`,
          formPhone && `Tél: ${formPhone}`,
          formNotes,
        ]
          .filter(Boolean)
          .join("\n") || undefined,
      nextAction: formNextAction || undefined,
      nextActionDate: formNextActionDate || undefined,
    });

    if (res.success && res.lead) {
      setLeads((prev) => [res.lead!, ...prev]);
      resetForm();
      setIsAddOpen(false);
    } else {
      setFormError(res.error ?? "Impossible de créer le lead.");
    }
    setIsSubmitting(false);
  }

  function resetForm() {
    setNaturalText("");
    setFormTopic("");
    setFormCompanyName("");
    setFormContactName("");
    setFormEmail("");
    setFormPhone("");
    setFormSource("");
    setFormNotes("");
    setFormNextAction("");
    setFormNextActionDate("");
    setFormStatus("lead-to-contact");
    setFormError(null);
    setExtractError(null);
  }

  // ── Move lead status ────────────────────────────
  async function handleMoveStatus(
    lead: CrmLeadSummary,
    newStatus: CrmLeadStatus,
  ) {
    startTransition(async () => {
      await updateLeadStatusAction(lead.id, newStatus);
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, status: newStatus } : l)),
      );
    });
  }

  // ── Manual status update ────────────────────────
  async function handleUpdateStatus(newStatusVal: CrmLeadStatus) {
    if (!selectedLead) return;
    const res = await updateLeadAction(selectedLead.id, {
      status: newStatusVal,
    });
    if (res.success) {
      setSelectedLead({ ...selectedLead, status: newStatusVal });
      setLeads(
        leads.map((l) =>
          l.id === selectedLead.id ? { ...l, status: newStatusVal } : l,
        ),
      );
    } else {
      setModalError(res.error || "Impossible de déplacer le lead.");
    }
  }

  // ── Delete lead ─────────────────────────────────────────
  async function handleDelete(leadId: string) {
    startTransition(async () => {
      await deleteLeadAction(leadId);
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
      if (selectedLead?.id === leadId) setSelectedLead(null);
    });
  }

  // ── Generate follow-up draft ────────────────────────────
  async function handleGenerateDraft(lead: CrmLeadSummary) {
    setDraftLead(lead);
    setDrafts(null);
    setIsGenerating(true);
    setModalError(null);

    // Parse company & contact from notes string
    const noteLines = (lead.notes ?? "").split("\n");
    const companyName = noteLines
      .find((l) => l.startsWith("Entreprise:"))
      ?.replace("Entreprise:", "")
      .trim();
    const contactName = noteLines
      .find((l) => l.startsWith("Contact:"))
      ?.replace("Contact:", "")
      .trim();

    const res = await generateFollowUpDraftAction({
      topic: lead.topic,
      companyName,
      contactName,
      notes: lead.notes,
      nextAction: lead.nextAction,
    });

    if (res.success && res.drafts) {
      setDrafts(res.drafts);
    } else {
      setModalError(res.error || "Erreur de génération du brouillon.");
    }
    setIsGenerating(false);
  }

  // ── Create client Google Drive folder ───────────────────
  async function handleCreateDriveFolder(lead: CrmLeadSummary) {
    setModalError(null);
    setDriveLink(null);

    if (!isGoogleConnected) {
      setModalError(
        "Veuillez d'abord connecter votre compte Google. Ouverture de la fenêtre...",
      );
      handleConnectGoogle();
      return;
    }

    setIsCreatingFolder(true);

    // Parse company name from notes or default to lead topic
    const noteLines = (lead.notes ?? "").split("\n");
    const companyName =
      noteLines
        .find((l) => l.startsWith("Entreprise:"))
        ?.replace("Entreprise:", "")
        .trim() || lead.topic;

    const res = await createGoogleDriveFolderAction(lead.id, companyName);

    if (res.success && res.folderLink) {
      setDriveLink(res.folderLink);

      // Append folder link in local state notes
      const updatedNotes = lead.notes
        ? `${lead.notes}\n[Google Drive Folder: Client - ${companyName}](${res.folderLink})`
        : `[Google Drive Folder: Client - ${companyName}](${res.folderLink})`;

      const updatedLead = { ...lead, notes: updatedNotes };
      setSelectedLead(updatedLead);
      setLeads(leads.map((l) => (l.id === lead.id ? updatedLead : l)));

      window.open(res.folderLink, "_blank");
    } else {
      setModalError(res.error || "Impossible de créer le dossier Drive.");
    }
    setIsCreatingFolder(false);
  }

  // ── Helpers ─────────────────────────────────────────────
  function getNextStatus(current: CrmLeadStatus): CrmLeadStatus | null {
    const idx = COLUMNS.findIndex((c) => c.status === current);
    return idx >= 0 && idx < COLUMNS.length - 1
      ? COLUMNS[idx + 1].status
      : null;
  }

  function getColumnConfig(status: CrmLeadStatus) {
    return COLUMNS.find((c) => c.status === status) ?? COLUMNS[0];
  }

  const totalLeads = leads.length;
  const activeLeads = leads.filter(
    (l) => l.status !== "dead-end" && l.status !== "won",
  ).length;

  return (
    <div className="space-y-8">
      {/* Title & integrations header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <PageHeader
          eyebrow="CRM · Leads"
          title="Pipeline commercial"
          description="Gérez votre pipeline de ventes, ajoutez des leads en langage naturel et générez des relances avec l'IA."
        />

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {isGoogleConnected ? (
            <div className="flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs text-teal-800 font-medium">
              <span className="h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
              Google Workspace connecté
              <button
                onClick={handleDisconnectGoogle}
                title="Déconnecter Google"
                className="ml-1 text-teal-600 hover:text-red-600 transition"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button
              onClick={handleConnectGoogle}
              variant="outline"
              className="text-xs border-stone-200 text-stone-700 hover:bg-stone-50"
            >
              <Globe className="mr-2 h-4 w-4 text-teal-600" />
              Connecter Google
            </Button>
          )}

          <Button
            id="btn-add-lead"
            onClick={() => {
              resetForm();
              setIsAddOpen(true);
            }}
            className="text-xs gap-2"
          >
            <Plus className="h-4 w-4" />
            Nouveau lead
          </Button>

          {/* Segmented control for views */}
          <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1">
            <button
              onClick={() => setViewMode("kanban")}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                viewMode === "kanban"
                  ? "bg-white text-stone-900 shadow-sm border border-stone-200/50"
                  : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5 text-stone-500" />
              Kanban
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                viewMode === "calendar"
                  ? "bg-white text-stone-900 shadow-sm border border-stone-200/50"
                  : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5 text-stone-500" />
              Calendrier
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                viewMode === "list"
                  ? "bg-white text-stone-900 shadow-sm border border-stone-200/50"
                  : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <List className="h-3.5 w-3.5 text-stone-500" />
              Liste
            </button>
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total leads", value: totalLeads },
          { label: "Actifs", value: activeLeads },
          {
            label: "Meetings",
            value: leads.filter((l) => l.status === "meeting-booked").length,
          },
          {
            label: "Gagnés",
            value: leads.filter((l) => l.status === "won").length,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
          >
            <p className="text-sm text-stone-500">{s.label}</p>
            <p className="mt-1 text-2xl font-bold text-stone-950">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Kanban Board View */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
          <span className="ml-3 text-sm text-stone-500">
            Chargement des leads…
          </span>
        </div>
      ) : viewMode === "kanban" ? (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4" style={{ minWidth: "900px" }}>
            {COLUMNS.map((col) => {
              const colLeads = leads.filter((l) => l.status === col.status);
              return (
                <div
                  key={col.status}
                  className="flex w-56 flex-none flex-col gap-3"
                >
                  {/* Column header */}
                  <div
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 ${col.color}`}
                  >
                    <span
                      className={`h-2 w-2 flex-none rounded-full ${col.dot}`}
                    />
                    <span className="truncate text-xs font-semibold uppercase tracking-wide">
                      {col.label}
                    </span>
                    <span className="ml-auto text-xs font-medium opacity-60">
                      {colLeads.length}
                    </span>
                  </div>

                  {/* Lead cards */}
                  <div className="flex flex-col gap-2">
                    {colLeads.length === 0 && (
                      <div className="rounded-md border border-dashed border-stone-200 p-4 text-center text-xs text-stone-400">
                        Vide
                      </div>
                    )}
                    {colLeads.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        nextStatus={getNextStatus(lead.status)}
                        onSelect={() => {
                          setSelectedLead(lead);
                          setDrafts(null);
                          setDriveLink(extractDriveLinkFromNotes(lead.notes));
                          setCalendarLink(
                            extractCalendarLinkFromNotes(lead.notes),
                          );
                          setModalError(null);
                        }}
                        onMove={handleMoveStatus}
                        onDelete={handleDelete}
                        onGenerateDraft={handleGenerateDraft}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : viewMode === "list" ? (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50/75">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-stone-500"
                  >
                    Sujet
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-stone-500"
                  >
                    Entreprise / Contact
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-stone-500"
                  >
                    Statut
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-stone-500"
                  >
                    Prochaine Action
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-stone-500"
                  >
                    Créé le
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-stone-500"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {leads.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-10 text-center text-sm text-stone-400"
                    >
                      Aucun lead trouvé.
                    </td>
                  </tr>
                ) : (
                  leads.map((lead) => {
                    const noteLines = (lead.notes ?? "").split("\n");
                    const companyName = noteLines
                      .find((l) => l.startsWith("Entreprise:"))
                      ?.replace("Entreprise:", "")
                      .trim();
                    const contactName = noteLines
                      .find((l) => l.startsWith("Contact:"))
                      ?.replace("Contact:", "")
                      .trim();

                    const colConfig = getColumnConfig(lead.status);

                    return (
                      <tr
                        key={lead.id}
                        className="hover:bg-stone-50/50 transition"
                      >
                        <td className="px-6 py-4 font-semibold text-stone-900">
                          <button
                            onClick={() => {
                              setSelectedLead(lead);
                              setDrafts(null);
                              setDriveLink(
                                extractDriveLinkFromNotes(lead.notes),
                              );
                              setCalendarLink(
                                extractCalendarLinkFromNotes(lead.notes),
                              );
                              setModalError(null);
                            }}
                            className="hover:text-teal-700 hover:underline text-left font-semibold text-stone-900 block"
                          >
                            {lead.topic}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-stone-600">
                          <div className="space-y-0.5">
                            {companyName && (
                              <div className="flex items-center gap-1.5 text-xs font-medium text-stone-700">
                                <Building2 className="h-3.5 w-3.5 text-stone-400" />
                                {companyName}
                              </div>
                            )}
                            {contactName && (
                              <div className="flex items-center gap-1.5 text-xs text-stone-500">
                                <User className="h-3.5 w-3.5 text-stone-400" />
                                {contactName}
                              </div>
                            )}
                            {!companyName && !contactName && (
                              <span className="text-xs text-stone-400 italic">
                                Non spécifié
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colConfig.color}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${colConfig.dot}`}
                            />
                            {colConfig.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-stone-600">
                          {lead.nextAction ? (
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-stone-800 line-clamp-1">
                                {lead.nextAction}
                              </p>
                              {lead.nextActionDate && (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200/50">
                                  <Calendar className="h-3 w-3" />
                                  {lead.nextActionDate}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-stone-450 italic">
                              Aucune
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs text-stone-500">
                          {lead.createdAt
                            ? new Date(lead.createdAt).toLocaleDateString(
                                "fr-FR",
                                {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                },
                              )
                            : "-"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              onClick={() => {
                                setSelectedLead(lead);
                                setDrafts(null);
                                setDriveLink(
                                  extractDriveLinkFromNotes(lead.notes),
                                );
                                setCalendarLink(
                                  extractCalendarLinkFromNotes(lead.notes),
                                );
                                setModalError(null);
                              }}
                              variant="outline"
                              className="h-8 px-2.5 text-xs border-stone-200 text-stone-700 hover:bg-stone-50"
                            >
                              Détails
                            </Button>
                            <Button
                              onClick={() => handleDelete(lead.id)}
                              variant="ghost"
                              className="h-8 px-2 text-xs text-red-650 hover:bg-red-50 hover:text-red-700"
                              title="Supprimer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Calendar View rendering */
        (() => {
          const statusDotColor: Record<CrmLeadStatus, string> = {
            "lead-to-contact": "bg-blue-500",
            contacted: "bg-stone-400",
            "to-follow-up": "bg-amber-500",
            "meeting-booked": "bg-indigo-500",
            "proposal-sent": "bg-emerald-500",
            won: "bg-teal-500",
            "dead-end": "bg-red-500",
          };
          const statusBgColor: Record<CrmLeadStatus, string> = {
            "lead-to-contact": "bg-blue-50 border-blue-200 text-blue-700",
            contacted: "bg-stone-50 border-stone-200 text-stone-600",
            "to-follow-up": "bg-amber-55/10 border-amber-200 text-amber-800",
            "meeting-booked": "bg-indigo-50 border-indigo-200 text-indigo-700",
            "proposal-sent":
              "bg-emerald-50 border-emerald-200 text-emerald-700",
            won: "bg-teal-50 border-teal-200 text-teal-750",
            "dead-end": "bg-red-50 border-red-200 text-red-700",
          };

          const year = calendarDate.getFullYear();
          const month = calendarDate.getMonth();
          const firstDay = new Date(year, month, 1).getDay();
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const monthName = calendarDate.toLocaleDateString("fr-FR", {
            month: "long",
            year: "numeric",
          });

          // Group leads by date string 'YYYY-MM-DD'
          const leadsByDate: Record<string, CrmLeadSummary[]> = {};
          leads.forEach((lead) => {
            if (!lead.createdAt) return;
            const d = new Date(lead.createdAt);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            if (!leadsByDate[key]) leadsByDate[key] = [];
            leadsByDate[key].push(lead);
          });

          const today = new Date();
          const isToday = (day: number) =>
            day === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();

          const paddedStart = firstDay === 0 ? 6 : firstDay - 1; // Mon-first

          return (
            <div className="rounded-xl border border-stone-200 bg-white overflow-hidden shadow-sm">
              {/* Calendar control header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
                <button
                  onClick={() => setCalendarDate(new Date(year, month - 1, 1))}
                  className="p-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-500 hover:text-stone-900 transition"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-center">
                  <h3 className="text-sm font-bold text-stone-900 capitalize">
                    {monthName}
                  </h3>
                  <p className="text-xs text-stone-500">
                    {leads.length} lead{leads.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <button
                  onClick={() => setCalendarDate(new Date(year, month + 1, 1))}
                  className="p-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-500 hover:text-stone-900 transition"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Day Labels */}
              <div className="grid grid-cols-7 border-b border-stone-200 bg-stone-50/50">
                {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
                  <div
                    key={d}
                    className="py-2 text-center text-[10px] font-bold text-stone-500 uppercase tracking-wider"
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7">
                {Array.from({ length: paddedStart }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="min-h-[100px] border-b border-r border-stone-100 bg-stone-50/20"
                  />
                ))}

                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(
                  (day) => {
                    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const dayLeads = leadsByDate[dateKey] || [];
                    const isCurrentDay = isToday(day);

                    return (
                      <div
                        key={day}
                        className={`min-h-[100px] border-b border-r border-stone-150 p-2 flex flex-col gap-1.5 ${
                          isCurrentDay
                            ? "bg-teal-50/30"
                            : "hover:bg-stone-50/50"
                        } transition-colors`}
                      >
                        <div
                          className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                            isCurrentDay
                              ? "bg-teal-700 text-white"
                              : "text-stone-500"
                          }`}
                        >
                          {day}
                        </div>

                        <div className="flex flex-col gap-1 overflow-hidden">
                          {dayLeads.slice(0, 3).map((lead) => (
                            <button
                              key={lead.id}
                              onClick={() => {
                                setSelectedLead(lead);
                                setDrafts(null);
                                setDriveLink(
                                  extractDriveLinkFromNotes(lead.notes),
                                );
                                setCalendarLink(
                                  extractCalendarLinkFromNotes(lead.notes),
                                );
                                setModalError(null);
                              }}
                              className={`w-full text-left px-1.5 py-0.5 rounded border text-[9px] font-semibold truncate cursor-pointer hover:opacity-85 transition flex items-center gap-1 ${
                                statusBgColor[lead.status]
                              }`}
                            >
                              <span
                                className={`h-1 w-1 rounded-full shrink-0 ${statusDotColor[lead.status]}`}
                              />
                              <span className="truncate">{lead.topic}</span>
                            </button>
                          ))}
                          {dayLeads.length > 3 && (
                            <span className="text-[9px] text-stone-400 pl-1 font-medium">
                              +{dayLeads.length - 3} autres
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>

              {/* Legend footer */}
              <div className="px-5 py-3 border-t border-stone-200 bg-stone-50/40 flex flex-wrap gap-4">
                {COLUMNS.map((col) => (
                  <div key={col.status} className="flex items-center gap-1.5">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${statusDotColor[col.status]}`}
                    />
                    <span className="text-[10px] text-stone-600 font-semibold uppercase tracking-wider">
                      {col.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()
      )}

      {/* ── Add Lead Modal ────────────────────────────── */}
      {isAddOpen && (
        <Modal title="Nouveau lead" onClose={() => setIsAddOpen(false)}>
          <form onSubmit={handleCreateLead} className="space-y-5">
            {/* Natural language intake */}
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                <Bot className="h-4 w-4" />
                Saisie en langage naturel (IA Groq)
              </div>
              <p className="mt-1 text-xs text-teal-600">
                Décrivez le lead et l&apos;IA remplira le formulaire
                automatiquement.
              </p>
              <textarea
                id="natural-text-input"
                className="mt-3 w-full rounded-md border border-teal-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                rows={3}
                placeholder='Ex: "J&apos;ai parlé à Karim Saidi de Atlas Telecom pour un projet IA CRM, à relancer lundi."'
                value={naturalText}
                onChange={(e) => setNaturalText(e.target.value)}
              />
              {extractError && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5" /> {extractError}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-8 text-xs px-2.5 border-teal-300 text-teal-700 hover:bg-teal-50"
                disabled={isExtracting || !naturalText.trim()}
                onClick={handleExtract}
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{" "}
                    Extraction…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Extraire avec
                    l&apos;IA
                  </>
                )}
              </Button>
            </div>

            {/* Manual form */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Sujet / Projet *" id="form-topic">
                <input
                  id="form-topic"
                  className={inputCls}
                  required
                  placeholder="Ex: Intégration IA CRM"
                  value={formTopic}
                  onChange={(e) => setFormTopic(e.target.value)}
                />
              </FormField>

              <FormField label="Entreprise (Optionnel)" id="form-company">
                <input
                  id="form-company"
                  className={inputCls}
                  placeholder="Ex: Atlas Telecom"
                  value={formCompanyName}
                  onChange={(e) => setFormCompanyName(e.target.value)}
                />
              </FormField>

              <FormField label="Contact principal" id="form-contact">
                <input
                  id="form-contact"
                  className={inputCls}
                  placeholder="Ex: Karim Saidi"
                  value={formContactName}
                  onChange={(e) => setFormContactName(e.target.value)}
                />
              </FormField>

              <FormField label="Email" id="form-email">
                <input
                  id="form-email"
                  className={inputCls}
                  type="email"
                  placeholder="Ex: karim@atlas.ma"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                />
              </FormField>

              <FormField label="Téléphone" id="form-phone">
                <input
                  id="form-phone"
                  className={inputCls}
                  placeholder="Ex: +212 600000000"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                />
              </FormField>

              <FormField label="Source du lead" id="form-source">
                <input
                  id="form-source"
                  className={inputCls}
                  placeholder="Ex: LinkedIn, Salon..."
                  value={formSource}
                  onChange={(e) => setFormSource(e.target.value)}
                />
              </FormField>

              <FormField label="Action suivante" id="form-next-action">
                <input
                  id="form-next-action"
                  className={inputCls}
                  placeholder="Ex: Envoyer la proposition commerciale"
                  value={formNextAction}
                  onChange={(e) => setFormNextAction(e.target.value)}
                />
              </FormField>

              <FormField label="Date de relance" id="form-next-action-date">
                <input
                  id="form-next-action-date"
                  className={inputCls}
                  type="date"
                  value={formNextActionDate}
                  onChange={(e) => setFormNextActionDate(e.target.value)}
                />
              </FormField>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="form-status"
                className="text-sm font-medium text-stone-850"
              >
                Statut Initial
              </label>
              <select
                id="form-status"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as CrmLeadStatus)}
                className="flex h-10 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700/20"
              >
                {COLUMNS.map((c) => (
                  <option key={c.status} value={c.status}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <FormField label="Notes & Contexte" id="form-notes">
              <textarea
                id="form-notes"
                className="flex w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-950 placeholder:text-stone-400 focus:border-teal-750 focus:outline-none focus:ring-2"
                rows={3}
                placeholder="Détails du premier contact, besoins identifiés..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </FormField>

            {formError && (
              <p className="text-xs text-red-650 font-semibold">{formError}</p>
            )}

            <div className="flex justify-end gap-3 border-t border-stone-100 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Enregistrement…" : "Créer le lead"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Lead Details Modal ────────────────────────── */}
      {selectedLead && (
        <Modal title={selectedLead.topic} onClose={() => setSelectedLead(null)}>
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              {(() => {
                const cfg = getColumnConfig(selectedLead.status);
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.color}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                );
              })()}
            </div>

            {/* Info rows */}
            {selectedLead.notes && (
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
                {selectedLead.notes}
              </div>
            )}

            {selectedLead.nextAction && (
              <div className="flex items-start gap-2 text-sm text-stone-600 bg-amber-50/50 p-3 rounded-lg border border-amber-200/50">
                <Calendar className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
                <div>
                  <span className="font-semibold text-stone-850">
                    Prochaine action :{" "}
                  </span>
                  {selectedLead.nextAction}
                  {selectedLead.nextActionDate && (
                    <span className="ml-2 font-bold text-amber-800">
                      ({selectedLead.nextActionDate})
                    </span>
                  )}
                </div>
              </div>
            )}

            {selectedLead.source && (
              <p className="text-xs text-stone-400">
                Source : {selectedLead.source}
              </p>
            )}

            {/* Quick automation actions */}
            <div className="pt-4 border-t border-stone-200 space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                Actions d&apos;automatisation
              </h4>

              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    onClick={() => handleGenerateDraft(selectedLead)}
                    disabled={isGenerating}
                    variant="outline"
                    className="text-xs border-teal-200 text-teal-700 hover:bg-teal-50"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Génération...
                      </>
                    ) : (
                      <>
                        <Bot className="mr-2 h-4 w-4" /> Relance IA Draft
                      </>
                    )}
                  </Button>

                  {driveLink ? (
                    <Button
                      onClick={() => window.open(driveLink, "_blank")}
                      variant="outline"
                      className="text-xs border-emerald-255 bg-emerald-50/20 text-emerald-750 hover:bg-emerald-50"
                    >
                      <FolderPlus className="mr-2 h-4 w-4 text-emerald-600" />
                      Ouvrir Drive ↗
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleCreateDriveFolder(selectedLead)}
                      disabled={isCreatingFolder}
                      variant="outline"
                      className="text-xs border-teal-200 text-teal-700 hover:bg-teal-50"
                    >
                      {isCreatingFolder ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Dossier...
                        </>
                      ) : (
                        <>
                          <FolderPlus className="mr-2 h-4 w-4 text-teal-600" />
                          Dossier Drive Client
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {calendarLink && (
                  <Button
                    onClick={() => window.open(calendarLink, "_blank")}
                    variant="outline"
                    className="w-full text-xs border-amber-250 bg-amber-50/20 text-amber-750 hover:bg-amber-50"
                  >
                    <Calendar className="mr-2 h-4 w-4 text-amber-600" />
                    Voir dans Google Calendar ↗
                  </Button>
                )}
              </div>

              {/* Status workflow selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-stone-500 block">
                  Changer le statut du lead
                </label>
                <select
                  value={selectedLead.status}
                  onChange={(e) =>
                    handleUpdateStatus(e.target.value as CrmLeadStatus)
                  }
                  className="h-9 w-full rounded border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-800 focus-visible:outline-none"
                >
                  {COLUMNS.map((c) => (
                    <option key={c.status} value={c.status}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {modalError && (
              <p className="text-xs text-red-650 font-semibold">{modalError}</p>
            )}

            {/* Generated drafts display */}
            {drafts &&
              draftLead?.id === selectedLead.id &&
              (() => {
                const noteLines = (selectedLead.notes ?? "").split("\n");
                const emailLine = noteLines
                  .find((l) => l.startsWith("Email:"))
                  ?.replace("Email:", "")
                  .trim();

                const phoneLine = noteLines
                  .find((l) => l.startsWith("Tél:"))
                  ?.replace("Tél:", "")
                  .replace(/\D/g, "")
                  .trim();

                const emailSubject = `Qarizmi - Relance concernant votre projet : ${selectedLead.topic}`;
                const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(
                  emailLine || "",
                )}&su=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(
                  drafts.email,
                )}`;

                const waUrl = phoneLine
                  ? `https://wa.me/${phoneLine}?text=${encodeURIComponent(
                      drafts.whatsapp,
                    )}`
                  : `https://wa.me/?text=${encodeURIComponent(drafts.whatsapp)}`;

                return (
                  <div className="space-y-4 pt-4 border-t border-stone-250 animate-fadeIn">
                    <div className="rounded-xl border border-teal-200 bg-teal-50/15 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-teal-50 border-b border-teal-200">
                        <span className="text-xs font-semibold text-teal-800 flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5" /> Email de relance
                        </span>
                        <a
                          href={gmailUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-teal-700 hover:bg-teal-850 px-2.5 py-1 text-[10px] font-bold text-white transition"
                        >
                          Envoyer via Gmail ↗
                        </a>
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-xs text-stone-700 whitespace-pre-wrap leading-relaxed">
                          {drafts.email}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-teal-200 bg-teal-50/15 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-teal-50 border-b border-teal-200">
                        <span className="text-xs font-semibold text-teal-800 flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5" /> WhatsApp Message
                        </span>
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[10px] font-bold text-white transition"
                        >
                          Envoyer WhatsApp ↗
                        </a>
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-xs text-stone-700 whitespace-pre-wrap leading-relaxed">
                          {drafts.whatsapp}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

            {driveLink && (
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 flex flex-col gap-1.5 animate-fadeIn">
                <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                  Dossier Drive Client Prêt
                </h4>
                <p className="text-xs text-stone-600">
                  Le dossier de fichiers commerciaux a été créé avec succès pour
                  ce client.
                </p>
                <a
                  href={driveLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-teal-700 font-bold hover:underline inline-flex items-center gap-1 mt-1"
                >
                  Ouvrir le dossier Drive ↗
                </a>
              </div>
            )}

            {/* Delete */}
            <div className="border-t border-stone-100 pt-3">
              <Button
                variant="ghost"
                className="w-full gap-2 text-red-650 hover:bg-red-50 hover:text-red-700"
                onClick={() => handleDelete(selectedLead.id)}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer ce lead
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

const inputCls =
  "h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20";

function FormField({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-stone-850">
        {label}
      </label>
      {children}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
          <h2 className="text-base font-semibold text-stone-950 truncate">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  nextStatus,
  onSelect,
  onMove,
  onDelete,
  onGenerateDraft,
}: {
  lead: CrmLeadSummary;
  nextStatus: CrmLeadStatus | null;
  onSelect: () => void;
  onMove: (lead: CrmLeadSummary, status: CrmLeadStatus) => void;
  onDelete: (id: string) => void;
  onGenerateDraft: (lead: CrmLeadSummary) => void;
}) {
  // Parse notes to extract company / contact lines
  const noteLines = (lead.notes ?? "").split("\n");
  const companyLine = noteLines
    .find((l) => l.startsWith("Entreprise:"))
    ?.replace("Entreprise:", "")
    .trim();
  const contactLine = noteLines
    .find((l) => l.startsWith("Contact:"))
    ?.replace("Contact:", "")
    .trim();

  return (
    <article className="group relative rounded-lg border border-stone-200 bg-white p-3 shadow-sm transition hover:border-teal-350 hover:shadow-md">
      {/* Topic */}
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <p className="text-sm font-semibold leading-snug text-stone-950 line-clamp-2">
          {lead.topic}
        </p>
        {companyLine && (
          <p className="mt-1 flex items-center gap-1 text-xs text-stone-500 font-medium">
            <Building2 className="h-3 w-3 text-stone-400" /> {companyLine}
          </p>
        )}
        {contactLine && (
          <p className="flex items-center gap-1 text-xs text-stone-500 font-medium">
            <User className="h-3 w-3 text-stone-400" /> {contactLine}
          </p>
        )}
        {lead.nextActionDate && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/40 w-fit">
            <Calendar className="h-3 w-3" />
            {lead.nextActionDate}
          </p>
        )}
      </button>

      {/* Quick actions */}
      <div className="mt-2.5 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        {nextStatus && (
          <button
            type="button"
            title="Avancer"
            onClick={() => onMove(lead, nextStatus)}
            className="flex items-center gap-1 rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-teal-700"
          >
            <MoveRight className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          title="Relance IA"
          onClick={() => onGenerateDraft(lead)}
          className="flex items-center gap-1 rounded p-1 text-stone-500 hover:bg-teal-50 hover:text-teal-700"
        >
          <Bot className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Supprimer"
          onClick={() => onDelete(lead.id)}
          className="flex items-center gap-1 rounded p-1 text-stone-500 hover:bg-red-50 hover:text-red-650"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}
