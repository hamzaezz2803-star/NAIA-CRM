"use client";

import React, { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Clock,
  Loader2,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Building2,
  ChevronDown,
  ChevronUp,
  History,
  Check,
  X,
  User,
} from "lucide-react";
import {
  fetchLeadsAction,
  fetchLeadFollowUpsAction,
  createFollowUpAction,
} from "@/features/crm/actions";
import type { CrmLeadSummary, CrmLeadFollowUp } from "@/features/crm/contracts";
import toast from "react-hot-toast";

const inputCls =
  "flex w-full rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-950 placeholder:text-stone-400 focus:border-teal-650 focus:outline-none focus:ring-2 focus:ring-teal-650/20 transition";

function formatTimeAgo(dateStr?: string): string {
  if (!dateStr) return "Jamais";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return diffMins <= 1 ? "À l'instant" : `Il y a ${diffMins} min`;
    }
    return `Il y a ${diffHours} h`;
  }
  if (diffDays === 1) return "Hier";
  return `Il y a ${diffDays} jours`;
}

export default function FollowUpsPage() {
  const [leads, setLeads] = useState<CrmLeadSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Follow-up logging modal
  const [selectedLead, setSelectedLead] = useState<CrmLeadSummary | null>(null);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Histories mapping: leadId -> CrmLeadFollowUp[]
  const [histories, setHistories] = useState<Record<string, CrmLeadFollowUp[]>>(
    {},
  );
  const [expandedLeadIds, setExpandedLeadIds] = useState<string[]>([]);
  const [loadingHistoryIds, setLoadingHistoryIds] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const data = await fetchLeadsAction();
        setLeads(data);
      } catch (err) {
        console.error("Failed to load leads:", err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  const activeLeads = leads.filter(
    (l) => l.status !== "won" && l.status !== "dead-end",
  );

  // Calculate statistics
  const totalActive = activeLeads.length;
  const contactedThisWeek = activeLeads.filter((l) => {
    if (!l.lastContactedAt) return false;
    const diffMs = new Date().getTime() - new Date(l.lastContactedAt).getTime();
    return diffMs < 7 * 24 * 60 * 60 * 1000;
  }).length;

  const overdueFollowUps = activeLeads.filter((l) => {
    if (!l.leadDate) return false;
    try {
      return new Date(l.leadDate) < new Date();
    } catch {
      return false;
    }
  }).length;

  // Toggle histories dropdown
  const toggleHistory = async (leadId: string) => {
    const isExpanded = expandedLeadIds.includes(leadId);
    if (isExpanded) {
      setExpandedLeadIds((prev) => prev.filter((id) => id !== leadId));
    } else {
      setExpandedLeadIds((prev) => [...prev, leadId]);
      // Fetch history if not already cached
      if (!histories[leadId]) {
        setLoadingHistoryIds((prev) => [...prev, leadId]);
        try {
          const historyData = await fetchLeadFollowUpsAction(leadId);
          setHistories((prev) => ({ ...prev, [leadId]: historyData }));
        } catch (err) {
          console.error("Failed to fetch follow-ups history:", err);
        } finally {
          setLoadingHistoryIds((prev) => prev.filter((id) => id !== leadId));
        }
      }
    }
  };

  const handleSubmitFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || !comment.trim()) return;

    setIsSubmitting(true);
    const toastId = toast.loading("Enregistrement de la relance...");
    try {
      const res = await createFollowUpAction(selectedLead.id, comment.trim());
      if (res.success && res.followUp) {
        // Update local leads list
        setLeads((prev) =>
          prev.map((l) =>
            l.id === selectedLead.id
              ? { ...l, lastContactedAt: res.followUp!.contactedAt }
              : l,
          ),
        );

        // Prepend to history cache
        setHistories((prev) => ({
          ...prev,
          [selectedLead.id]: [res.followUp!, ...(prev[selectedLead.id] || [])],
        }));

        toast.success("Relance enregistrée !", { id: toastId });
        setComment("");
        setSelectedLead(null);
      } else {
        toast.error(res.error ?? "Erreur lors de l'enregistrement", {
          id: toastId,
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("Erreur de communication", { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Status mapping to French labels and colors
  const statusConfig: Record<
    string,
    { label: string; bg: string; text: string }
  > = {
    "lead-to-contact": {
      label: "À contacter",
      bg: "bg-blue-50 dark:bg-blue-950/20",
      text: "text-blue-700 dark:text-blue-400",
    },
    contacted: {
      label: "Contacté",
      bg: "bg-stone-50 dark:bg-stone-900/50",
      text: "text-stone-600 dark:text-stone-400",
    },
    "to-follow-up": {
      label: "À relancer",
      bg: "bg-amber-50 dark:bg-amber-950/20",
      text: "text-amber-700 dark:text-amber-400",
    },
    "meeting-booked": {
      label: "RDV fixé",
      bg: "bg-indigo-50 dark:bg-indigo-950/20",
      text: "text-indigo-700 dark:text-indigo-400",
    },
    "proposal-sent": {
      label: "Propale envoyée",
      bg: "bg-purple-50 dark:bg-purple-950/20",
      text: "text-purple-700 dark:text-purple-400",
    },
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="CRM · Opérations"
        title="Suivi des relances"
        description="Conservez l'historique de vos points de contact, enregistrez vos relances et suivez vos prochaines actions commerciales."
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Leads Actifs
            </p>
            <h3 className="mt-1 text-2xl font-bold text-stone-900">
              {totalActive}
            </h3>
          </div>
          <div className="h-10 w-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700">
            <User className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Contactés cette semaine
            </p>
            <h3 className="mt-1 text-2xl font-bold text-stone-900">
              {contactedThisWeek}
            </h3>
          </div>
          <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Relances en retard
            </p>
            <h3 className="mt-1 text-2xl font-bold text-stone-900">
              {overdueFollowUps}
            </h3>
          </div>
          <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-700">
            <AlertCircle className="h-5 w-5" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-teal-650" />
          <span className="ml-3 text-sm text-stone-500">
            Chargement des dossiers commerciaux...
          </span>
        </div>
      ) : activeLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50 py-16 text-center">
          <Clock className="h-10 w-10 text-stone-300" />
          <h3 className="mt-4 text-sm font-semibold text-stone-850">
            Aucun lead actif à suivre
          </h3>
          <p className="mt-1 text-xs text-stone-500">
            {
              "Tous vos leads sont gagnés, sans suite ou vous n'avez aucun lead enregistré."
            }
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50/75 border-b border-stone-200 text-xs font-bold text-stone-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">Projet / Entreprise</th>
                  <th className="px-6 py-3.5">Statut</th>
                  <th className="px-6 py-3.5">Dernier Contact</th>
                  <th className="px-6 py-3.5">Prochaine Action</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-150">
                {activeLeads.map((lead) => {
                  const isExpanded = expandedLeadIds.includes(lead.id);
                  const status = statusConfig[lead.status] || {
                    label: lead.status,
                    bg: "bg-stone-50",
                    text: "text-stone-600",
                  };

                  // Parse company from notes
                  const companyLine = (lead.notes ?? "")
                    .split("\n")
                    .find((l) => l.startsWith("Entreprise:"))
                    ?.replace("Entreprise:", "")
                    .trim();

                  return (
                    <React.Fragment key={lead.id}>
                      <tr className="hover:bg-stone-50/30 transition-colors">
                        <td className="px-6 py-4.5">
                          <p className="font-semibold text-stone-900">
                            {lead.topic}
                          </p>
                          {companyLine && (
                            <p className="flex items-center gap-1 text-[11px] text-stone-500 mt-0.5">
                              <Building2 className="h-3 w-3 flex-shrink-0" />
                              {companyLine}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4.5">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.bg} ${status.text}`}
                          >
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-4.5 text-stone-600">
                          <p className="text-xs font-medium">
                            {formatTimeAgo(lead.lastContactedAt)}
                          </p>
                          {lead.lastContactedAt && (
                            <p className="text-[10px] text-stone-400 mt-0.5">
                              {new Date(
                                lead.lastContactedAt,
                              ).toLocaleDateString("fr-FR")}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4.5">
                          {lead.nextAction ? (
                            <div>
                              <p className="text-xs font-medium text-stone-850 truncate max-w-[180px]">
                                {lead.nextAction}
                              </p>
                              {lead.leadDate && (
                                <p className="flex items-center gap-1 text-[10px] text-stone-400 mt-0.5">
                                  <Calendar className="h-3 w-3" />
                                  {new Date(lead.leadDate).toLocaleDateString(
                                    "fr-FR",
                                  )}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-stone-400 italic">
                              Non planifiée
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              onClick={() => toggleHistory(lead.id)}
                              variant="ghost"
                              className="h-8 gap-1 px-2.5 text-xs text-stone-600 hover:text-stone-900"
                            >
                              <History className="h-3.5 w-3.5 text-stone-400" />
                              <span>Historique</span>
                              {isExpanded ? (
                                <ChevronUp className="h-3 w-3 text-stone-400" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-stone-400" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              onClick={() => setSelectedLead(lead)}
                              className="h-8 gap-1.5 px-3 bg-teal-700 hover:bg-teal-800 text-white text-xs"
                            >
                              <Clock className="h-3.5 w-3.5" />
                              <span>Relancer</span>
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable History Section */}
                      {isExpanded && (
                        <tr>
                          <td
                            colSpan={5}
                            className="bg-stone-50/50 px-8 py-4.5 border-t border-b border-stone-150"
                          >
                            <div className="space-y-3">
                              <h5 className="text-[11px] font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                                <History className="h-3.5 w-3.5 text-stone-300" />
                                Historique des relances
                              </h5>

                              {loadingHistoryIds.includes(lead.id) ? (
                                <div className="flex items-center justify-center py-2">
                                  <Loader2 className="h-4 w-4 animate-spin text-teal-650" />
                                </div>
                              ) : !histories[lead.id] ||
                                histories[lead.id].length === 0 ? (
                                <p className="text-xs text-stone-400 italic py-1">
                                  Aucun historique de relance enregistré.
                                  Cliquez sur le bouton &quot;Relancer&quot;
                                  pour noter un contact.
                                </p>
                              ) : (
                                <div className="relative border-l border-stone-200 pl-4 ml-2 space-y-3">
                                  {histories[lead.id].map((h) => (
                                    <div
                                      key={h.id}
                                      className="relative text-xs"
                                    >
                                      {/* Timeline dot */}
                                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-teal-600 bg-white" />
                                      <div className="flex flex-wrap items-center gap-2 text-stone-450 text-[10px] font-bold uppercase tracking-tight">
                                        <span>
                                          {new Date(
                                            h.contactedAt,
                                          ).toLocaleString("fr-FR", {
                                            dateStyle: "short",
                                            timeStyle: "short",
                                          })}
                                        </span>
                                        <span>•</span>
                                        <span className="text-stone-655 flex items-center gap-0.5">
                                          <User className="h-3 w-3" />
                                          {h.createdByName || "Membre"}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-stone-850 whitespace-pre-wrap leading-relaxed">
                                        {h.comment || (
                                          <span className="italic text-stone-400">
                                            Aucun commentaire de relance
                                          </span>
                                        )}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log Follow-up Modal */}
      {selectedLead && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedLead(null);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-stone-900 truncate">
                  Noter une relance commerciale
                </h2>
                <p className="text-xs text-stone-500 truncate mt-0.5">
                  {selectedLead.topic}
                </p>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitFollowUp} className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="followup-comment"
                >
                  Commentaire / Contenu de la relance
                </label>
                <textarea
                  id="followup-comment"
                  className={inputCls}
                  required
                  rows={4}
                  placeholder="Ex: Envoyé un email de suivi. Le client est en déplacement jusqu'à vendredi mais intéressé pour fixer un RDV la semaine prochaine."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <p className="text-[10px] text-stone-450 leading-normal">
                  {
                    "* L'enregistrement va automatiquement mettre à jour la date de dernier contact du lead au jour et à l'heure d'aujourd'hui."
                  }
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setSelectedLead(null)}
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  className="flex-1 gap-2 bg-teal-700 hover:bg-teal-800 text-white"
                  disabled={isSubmitting || !comment.trim()}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Valider
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
