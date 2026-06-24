"use client";

import React, { useState, useEffect, useTransition } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
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
} from "lucide-react";
import {
  fetchLeadsAction,
  createLeadAction,
  updateLeadStatusAction,
  deleteLeadAction,
  extractLeadFromNaturalTextAction,
  generateFollowUpDraftAction,
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
}[] = [
  {
    label: "À contacter",
    status: "lead-to-contact",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
  },
  {
    label: "Contacté",
    status: "contacted",
    color: "bg-stone-50 text-stone-600 border-stone-200",
    dot: "bg-stone-400",
  },
  {
    label: "À relancer",
    status: "to-follow-up",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  {
    label: "Meeting fixé",
    status: "meeting-booked",
    color: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-500",
  },
  {
    label: "Propale envoyée",
    status: "proposal-sent",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  {
    label: "Gagné ✓",
    status: "won",
    color: "bg-teal-50 text-teal-700 border-teal-200",
    dot: "bg-teal-500",
  },
  {
    label: "Dead end",
    status: "dead-end",
    color: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-400",
  },
];

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const [leads, setLeads] = useState<CrmLeadSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [, startTransition] = useTransition();

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

  // Follow-up draft
  const [draftLead, setDraftLead] = useState<CrmLeadSummary | null>(null);
  const [drafts, setDrafts] = useState<{
    email: string;
    whatsapp: string;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Load leads ──────────────────────────────────────────
  useEffect(() => {
    loadLeads();
  }, []);

  async function loadLeads() {
    setIsLoading(true);
    const data = await fetchLeadsAction();
    setLeads(data);
    setIsLoading(false);
  }

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

    // Note: companyName / contactName are passed as notes since
    // full company/contact linking requires a separate selection flow.
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

  // ── Move lead to next status ────────────────────────────
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

    const res = await generateFollowUpDraftAction({
      topic: lead.topic,
      notes: lead.notes,
    });

    if (res.success && res.drafts) {
      setDrafts(res.drafts);
    }
    setIsGenerating(false);
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

  // ────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        eyebrow="CRM · Leads"
        title="Pipeline commercial"
        description="Gérez votre pipeline de ventes, ajoutez des leads en langage naturel et générez des relances avec l'IA."
        actions={<StatusBadge status="live" />}
      />

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

      {/* Actions bar */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-stone-950">
          Kanban Pipeline
        </h2>
        <Button
          id="btn-add-lead"
          onClick={() => {
            resetForm();
            setIsAddOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Ajouter un lead
        </Button>
      </div>

      {/* ── Kanban Board ──────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
          <span className="ml-3 text-sm text-stone-500">
            Chargement des leads…
          </span>
        </div>
      ) : (
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
                        onSelect={() => setSelectedLead(lead)}
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
              <FormField label="Statut" id="form-status">
                <select
                  id="form-status"
                  className={inputCls}
                  value={formStatus}
                  onChange={(e) =>
                    setFormStatus(e.target.value as CrmLeadStatus)
                  }
                >
                  {COLUMNS.map((c) => (
                    <option key={c.status} value={c.status}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Entreprise" id="form-company">
                <input
                  id="form-company"
                  className={inputCls}
                  placeholder="Nom de l'entreprise"
                  value={formCompanyName}
                  onChange={(e) => setFormCompanyName(e.target.value)}
                />
              </FormField>
              <FormField label="Contact" id="form-contact">
                <input
                  id="form-contact"
                  className={inputCls}
                  placeholder="Nom du contact"
                  value={formContactName}
                  onChange={(e) => setFormContactName(e.target.value)}
                />
              </FormField>
              <FormField label="Email" id="form-email">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    id="form-email"
                    type="email"
                    className={`${inputCls} pl-9`}
                    placeholder="contact@example.com"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                  />
                </div>
              </FormField>
              <FormField label="Téléphone" id="form-phone">
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    id="form-phone"
                    className={`${inputCls} pl-9`}
                    placeholder="+212 6xx xxx xxx"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                  />
                </div>
              </FormField>
              <FormField label="Source" id="form-source">
                <input
                  id="form-source"
                  className={inputCls}
                  placeholder="LinkedIn, salon, appel…"
                  value={formSource}
                  onChange={(e) => setFormSource(e.target.value)}
                />
              </FormField>
              <FormField label="Date prochaine action" id="form-date">
                <input
                  id="form-date"
                  type="date"
                  className={inputCls}
                  value={formNextActionDate}
                  onChange={(e) => setFormNextActionDate(e.target.value)}
                />
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Prochaine action" id="form-next-action">
                  <input
                    id="form-next-action"
                    className={inputCls}
                    placeholder="Ex: Envoyer la propale, rappeler vendredi…"
                    value={formNextAction}
                    onChange={(e) => setFormNextAction(e.target.value)}
                  />
                </FormField>
              </div>
              <div className="sm:col-span-2">
                <FormField label="Notes" id="form-notes">
                  <textarea
                    id="form-notes"
                    className={`${inputCls} resize-none`}
                    rows={3}
                    placeholder="Notes supplémentaires…"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                  />
                </FormField>
              </div>
            </div>

            {formError && (
              <p className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" /> {formError}
              </p>
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
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Création…
                  </>
                ) : (
                  "Créer le lead"
                )}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Lead Detail Modal ─────────────────────────── */}
      {selectedLead && (
        <Modal
          title={selectedLead.topic}
          onClose={() => {
            setSelectedLead(null);
            setDrafts(null);
            setDraftLead(null);
          }}
        >
          <div className="space-y-4">
            {/* Status badge */}
            <div className="flex items-center gap-3">
              {(() => {
                const cfg = getColumnConfig(selectedLead.status);
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${cfg.color}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                );
              })()}
            </div>

            {/* Info rows */}
            {selectedLead.notes && (
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700 whitespace-pre-wrap">
                {selectedLead.notes}
              </div>
            )}

            {selectedLead.nextAction && (
              <div className="flex items-start gap-2 text-sm text-stone-600">
                <Calendar className="mt-0.5 h-4 w-4 flex-none text-teal-600" />
                <div>
                  <span className="font-medium text-stone-800">
                    Prochaine action :{" "}
                  </span>
                  {selectedLead.nextAction}
                  {selectedLead.nextActionDate && (
                    <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                      {selectedLead.nextActionDate}
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

            {/* Move status */}
            {getNextStatus(selectedLead.status) && (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => {
                  const next = getNextStatus(selectedLead.status)!;
                  handleMoveStatus(selectedLead, next);
                  setSelectedLead({ ...selectedLead, status: next });
                }}
              >
                <MoveRight className="h-4 w-4" />
                Passer à :{" "}
                {getColumnConfig(getNextStatus(selectedLead.status)!).label}
              </Button>
            )}

            {/* Generate follow-up */}
            <Button
              variant="outline"
              className="w-full gap-2 border-teal-200 text-teal-700 hover:bg-teal-50"
              onClick={() => handleGenerateDraft(selectedLead)}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Génération en
                  cours…
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4" /> Générer une relance (IA)
                </>
              )}
            </Button>

            {/* Draft output */}
            {drafts && draftLead?.id === selectedLead.id && (
              <div className="space-y-3">
                <DraftBlock label="Email" content={drafts.email} />
                <DraftBlock label="WhatsApp" content={drafts.whatsapp} />
              </div>
            )}

            {/* Delete */}
            <div className="border-t border-stone-100 pt-3">
              <Button
                variant="ghost"
                className="w-full gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
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
      <label htmlFor={id} className="text-sm font-medium text-stone-800">
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
    <article className="group relative rounded-lg border border-stone-200 bg-white p-3 shadow-sm transition hover:border-teal-300 hover:shadow-md">
      {/* Topic */}
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <p className="text-sm font-semibold leading-snug text-stone-950 line-clamp-2">
          {lead.topic}
        </p>
        {companyLine && (
          <p className="mt-1 flex items-center gap-1 text-xs text-stone-500">
            <Building2 className="h-3 w-3" /> {companyLine}
          </p>
        )}
        {contactLine && (
          <p className="flex items-center gap-1 text-xs text-stone-500">
            <User className="h-3 w-3" /> {contactLine}
          </p>
        )}
        {lead.nextActionDate && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-600">
            <Calendar className="h-3 w-3" />
            {lead.nextActionDate}
          </p>
        )}
      </button>

      {/* Quick actions */}
      <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {nextStatus && (
          <button
            type="button"
            title="Avancer"
            onClick={() => onMove(lead, nextStatus)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-teal-700"
          >
            <MoveRight className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          title="Relance IA"
          onClick={() => onGenerateDraft(lead)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-stone-500 hover:bg-teal-50 hover:text-teal-700"
        >
          <Bot className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Supprimer"
          onClick={() => onDelete(lead.id)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-stone-500 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </article>
  );
}

function DraftBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50">
      <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2">
        <span className="text-xs font-semibold text-stone-600">{label}</span>
        <button
          type="button"
          className="text-xs text-teal-600 hover:underline"
          onClick={() => navigator.clipboard.writeText(content)}
        >
          Copier
        </button>
      </div>
      <p className="whitespace-pre-wrap px-3 py-2 text-sm text-stone-700 leading-relaxed">
        {content}
      </p>
    </div>
  );
}
