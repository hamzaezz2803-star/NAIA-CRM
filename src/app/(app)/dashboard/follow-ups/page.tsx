"use client";

import React, { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Clock,
  Loader2,
  Calendar,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  Check,
  X,
  User,
  Search,
} from "lucide-react";
import {
  fetchLeadsAction,
  fetchLeadFollowUpsAction,
  createFollowUpAction,
} from "@/features/crm/actions";
import type { CrmLeadSummary, CrmLeadFollowUp } from "@/features/crm/contracts";
import toast from "react-hot-toast";

const inputCls =
  "flex w-full rounded-md border px-3 py-2.5 text-sm placeholder:text-stone-400 focus:outline-none transition" +
  " border-[var(--maison-border)] bg-[var(--maison-page)] text-[var(--maison-text-primary)] focus:border-[var(--maison-brass)] focus:ring-2 focus:ring-[var(--maison-brass)]/20";

function readLegacyLeadField(
  notes: string | undefined,
  labels: string[],
): string | undefined {
  if (!notes) return undefined;

  const normalizedLabels = labels.map((label) => label.toLocaleLowerCase("fr"));

  for (const rawLine of notes.split("\n")) {
    const line = rawLine.trim();
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const label = line.slice(0, separatorIndex).trim().toLocaleLowerCase("fr");
    if (!normalizedLabels.includes(label)) continue;

    const value = line.slice(separatorIndex + 1).trim();
    if (value) return value;
  }

  return undefined;
}

function getLeadIdentity(lead: CrmLeadSummary): {
  companyName: string;
  contactName?: string;
} {
  const legacyCompanyName = readLegacyLeadField(lead.notes, [
    "Entreprise",
    "Société",
    "Company",
  ]);
  const legacyContactName = readLegacyLeadField(lead.notes, [
    "Contact",
    "Nom du contact",
  ]);

  return {
    companyName: lead.companyName?.trim() || legacyCompanyName || lead.topic,
    contactName: lead.contactName?.trim() || legacyContactName,
  };
}

function normalizeSearchValue(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .trim();
}

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
  const [search, setSearch] = useState("");

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
  const normalizedSearch = normalizeSearchValue(search);
  const filteredLeads = activeLeads.filter((lead) => {
    if (!normalizedSearch) return true;

    const identity = getLeadIdentity(lead);
    return [
      identity.companyName,
      identity.contactName,
      lead.contactEmail,
      lead.contactPhone,
      lead.topic,
      lead.nextAction,
    ].some((value) => normalizeSearchValue(value).includes(normalizedSearch));
  });

  // Calculate statistics
  const totalActive = activeLeads.length;
  const contactedThisWeek = activeLeads.filter((l) => {
    if (!l.lastContactedAt) return false;
    const diffMs = new Date().getTime() - new Date(l.lastContactedAt).getTime();
    return diffMs < 7 * 24 * 60 * 60 * 1000;
  }).length;

  const overdueFollowUps = activeLeads.filter((l) => {
    if (l.nextActionState === "done") return false;
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
    <div className="space-y-6">
      {/* Header section matches Pipeline page header exactly */}
      <div
        className="flex flex-col gap-2 border-b pb-4"
        style={{ borderColor: "var(--maison-border)" }}
      >
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--maison-brass)" }}
          >
            CRM · Opérations
          </p>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl font-serif"
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              color: "var(--maison-text-primary)",
            }}
          >
            Suivi des relances
          </h1>
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            Conservez l&apos;historique de vos points de contact, enregistrez
            vos relances et suivez vos prochaines actions commerciales.
          </p>
        </div>
      </div>

      {/* KPI Cards styled as Maison premium cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div
          className="rounded-xl p-4 flex items-center justify-between transition-shadow hover:shadow-sm"
          style={{
            background: "var(--maison-card)",
            border: "1px solid var(--maison-border)",
          }}
        >
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "var(--maison-text-muted)" }}
            >
              Leads Actifs
            </p>
            <h3
              className="mt-1 text-xl font-bold leading-none"
              style={{ color: "var(--maison-text-primary)" }}
            >
              {totalActive}
            </h3>
          </div>
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center"
            style={{
              background: "rgba(201, 168, 76, 0.10)",
              color: "var(--maison-brass)",
            }}
          >
            <User className="h-4 w-4" />
          </div>
        </div>

        <div
          className="rounded-xl p-4 flex items-center justify-between transition-shadow hover:shadow-sm"
          style={{
            background: "var(--maison-card)",
            border: "1px solid var(--maison-border)",
          }}
        >
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "var(--maison-text-muted)" }}
            >
              Contactés cette semaine
            </p>
            <h3
              className="mt-1 text-xl font-bold leading-none"
              style={{ color: "var(--maison-text-primary)" }}
            >
              {contactedThisWeek}
            </h3>
          </div>
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center"
            style={{
              background: "rgba(201, 168, 76, 0.10)",
              color: "var(--maison-brass)",
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
          </div>
        </div>

        <div
          className="rounded-xl p-4 flex items-center justify-between transition-shadow hover:shadow-sm"
          style={{
            background: "var(--maison-card)",
            border: "1px solid var(--maison-border)",
          }}
        >
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "var(--maison-text-muted)" }}
            >
              Relances en retard
            </p>
            <h3
              className="mt-1 text-xl font-bold leading-none"
              style={{ color: "var(--maison-text-primary)" }}
            >
              {overdueFollowUps}
            </h3>
          </div>
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center"
            style={{
              background: "rgba(239, 68, 68, 0.10)",
              color: "#ef4444",
            }}
          >
            <AlertCircle className="h-4 w-4" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2
            className="h-5 w-5 animate-spin"
            style={{ color: "var(--maison-brass)" }}
          />
          <span
            className="ml-3 text-xs"
            style={{ color: "var(--maison-text-muted)" }}
          >
            Chargement des dossiers commerciaux...
          </span>
        </div>
      ) : activeLeads.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center"
          style={{
            borderColor: "var(--maison-border)",
            background: "var(--maison-card)",
          }}
        >
          <Clock
            className="h-10 w-10"
            style={{ color: "var(--maison-text-muted)" }}
          />
          <h3
            className="mt-4 text-sm font-semibold"
            style={{ color: "var(--maison-text-primary)" }}
          >
            Aucun lead actif à suivre
          </h3>
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--maison-text-muted)" }}
          >
            {
              "Tous vos leads sont gagnés, sans suite ou vous n'avez aucun lead enregistré."
            }
          </p>
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-xl shadow-sm"
          style={{
            background: "var(--maison-card)",
            border: "1px solid var(--maison-border)",
          }}
        >
          <div
            className="border-b p-3"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <div className="relative max-w-md">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--maison-text-muted)" }}
              />
              <input
                aria-label="Rechercher une entreprise ou un contact"
                className={`${inputCls} pl-9`}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher une entreprise ou un contact"
                type="search"
                value={search}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead
                className="border-b text-xs font-bold uppercase tracking-wider"
                style={{
                  background: "var(--maison-page)",
                  borderColor: "var(--maison-border)",
                  color: "var(--maison-text-secondary)",
                }}
              >
                <tr>
                  <th className="px-6 py-3.5">Entreprise / Contact</th>
                  <th className="px-6 py-3.5">Statut</th>
                  <th className="px-6 py-3.5">Dernier Contact</th>
                  <th className="px-6 py-3.5">Prochaine Action</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody
                className="divide-y"
                style={{ borderColor: "var(--maison-border)" }}
              >
                {filteredLeads.map((lead) => {
                  const isExpanded = expandedLeadIds.includes(lead.id);
                  const status = statusConfig[lead.status] || {
                    label: lead.status,
                    bg: "bg-stone-50",
                    text: "text-stone-600",
                  };

                  const identity = getLeadIdentity(lead);

                  return (
                    <React.Fragment key={lead.id}>
                      <tr
                        className="transition-colors"
                        style={{
                          background: "var(--maison-card)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background =
                            "var(--maison-page)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background =
                            "var(--maison-card)";
                        }}
                      >
                        <td className="px-6 py-4.5">
                          <p
                            className="font-semibold"
                            style={{ color: "var(--maison-text-primary)" }}
                          >
                            {identity.companyName}
                          </p>
                          {identity.contactName && (
                            <p
                              className="flex items-center gap-1 text-[11px] mt-0.5"
                              style={{
                                color: "var(--maison-text-secondary)",
                              }}
                            >
                              <User className="h-3 w-3 flex-shrink-0" />
                              {identity.contactName}
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
                        <td
                          className="px-6 py-4.5"
                          style={{ color: "var(--maison-text-secondary)" }}
                        >
                          <p className="text-xs font-medium">
                            {formatTimeAgo(lead.lastContactedAt)}
                          </p>
                          {lead.lastContactedAt && (
                            <p
                              className="text-[10px] mt-0.5"
                              style={{ color: "var(--maison-text-muted)" }}
                            >
                              {new Date(
                                lead.lastContactedAt,
                              ).toLocaleDateString("fr-FR")}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4.5">
                          {lead.nextAction ? (
                            <div>
                              <p
                                className="text-xs font-medium truncate max-w-[180px]"
                                style={{
                                  color: "var(--maison-text-primary)",
                                }}
                              >
                                {lead.nextAction}
                              </p>
                              {lead.leadDate && (
                                <p
                                  className="flex items-center gap-1 text-[10px] mt-0.5"
                                  style={{
                                    color: "var(--maison-text-muted)",
                                  }}
                                >
                                  <Calendar className="h-3 w-3" />
                                  {new Date(lead.leadDate).toLocaleDateString(
                                    "fr-FR",
                                  )}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span
                              className="text-xs italic"
                              style={{ color: "var(--maison-text-muted)" }}
                            >
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
                              className="h-8 gap-1 px-2.5 text-xs hover:bg-[var(--maison-border-subtle)]"
                              style={{
                                color: "var(--maison-text-secondary)",
                              }}
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
                              className="h-8 gap-1.5 px-3 text-xs"
                              style={{
                                background: "var(--maison-brass)",
                                color: "var(--maison-brass-text)",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background =
                                  "var(--maison-brass-hover)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background =
                                  "var(--maison-brass)";
                              }}
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
                            className="px-8 py-4.5 border-t border-b"
                            style={{
                              background: "var(--maison-page)",
                              borderColor: "var(--maison-border)",
                            }}
                          >
                            <div className="space-y-3">
                              <h5
                                className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 mb-2"
                                style={{ color: "var(--maison-text-muted)" }}
                              >
                                <History
                                  className="h-3.5 w-3.5"
                                  style={{ color: "var(--maison-brass)" }}
                                />
                                Historique des relances
                              </h5>

                              {loadingHistoryIds.includes(lead.id) ? (
                                <div className="flex items-center justify-center py-2">
                                  <Loader2
                                    className="h-4 w-4 animate-spin"
                                    style={{ color: "var(--maison-brass)" }}
                                  />
                                </div>
                              ) : !histories[lead.id] ||
                                histories[lead.id].length === 0 ? (
                                <p
                                  className="text-xs italic py-1"
                                  style={{
                                    color: "var(--maison-text-muted)",
                                  }}
                                >
                                  Aucun historique de relance enregistré.
                                  Cliquez sur le bouton &quot;Relancer&quot;
                                  pour noter un contact.
                                </p>
                              ) : (
                                <div
                                  className="relative border-l pl-4 ml-2 space-y-3"
                                  style={{
                                    borderColor: "var(--maison-border)",
                                  }}
                                >
                                  {histories[lead.id].map((h) => (
                                    <div
                                      key={h.id}
                                      className="relative text-xs"
                                    >
                                      {/* Timeline dot */}
                                      <span
                                        className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border bg-white"
                                        style={{
                                          borderColor: "var(--maison-brass)",
                                        }}
                                      />
                                      <div
                                        className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-tight"
                                        style={{
                                          color: "var(--maison-text-muted)",
                                        }}
                                      >
                                        <span>
                                          {new Date(
                                            h.contactedAt,
                                          ).toLocaleString("fr-FR", {
                                            dateStyle: "short",
                                            timeStyle: "short",
                                          })}
                                        </span>
                                        <span>•</span>
                                        <span
                                          className="flex items-center gap-0.5"
                                          style={{
                                            color:
                                              "var(--maison-text-secondary)",
                                          }}
                                        >
                                          <User className="h-3 w-3" />
                                          {h.createdByName || "Membre"}
                                        </span>
                                      </div>
                                      <p
                                        className="mt-1 whitespace-pre-wrap leading-relaxed"
                                        style={{
                                          color: "var(--maison-text-primary)",
                                        }}
                                      >
                                        {h.comment || (
                                          <span
                                            className="italic"
                                            style={{
                                              color: "var(--maison-text-muted)",
                                            }}
                                          >
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
                {filteredLeads.length === 0 && (
                  <tr>
                    <td
                      className="px-6 py-10 text-center text-xs"
                      colSpan={5}
                      style={{ color: "var(--maison-text-muted)" }}
                    >
                      Aucun lead ne correspond à cette recherche.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log Follow-up Modal */}
      {selectedLead && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedLead(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            style={{
              background: "var(--maison-card)",
              borderColor: "var(--maison-border)",
            }}
          >
            <div
              className="flex items-center justify-between border-b px-6 py-4"
              style={{ borderColor: "var(--maison-border)" }}
            >
              <div className="min-w-0">
                <h2
                  className="text-base font-bold truncate"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Noter une relance commerciale
                </h2>
                <p
                  className="text-xs truncate mt-0.5"
                  style={{ color: "var(--maison-text-secondary)" }}
                >
                  {getLeadIdentity(selectedLead).companyName}
                  {getLeadIdentity(selectedLead).contactName
                    ? ` · ${getLeadIdentity(selectedLead).contactName}`
                    : ""}
                </p>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="rounded-md p-1.5 transition"
                style={{
                  color: "var(--maison-text-muted)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--maison-page)";
                  e.currentTarget.style.color = "var(--maison-text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--maison-text-muted)";
                }}
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitFollowUp} className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium"
                  style={{ color: "var(--maison-text-primary)" }}
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
                <p
                  className="text-[10px] leading-normal"
                  style={{ color: "var(--maison-text-muted)" }}
                >
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
                  className="flex-1 gap-2"
                  style={{
                    background: "var(--maison-brass)",
                    color: "var(--maison-brass-text)",
                  }}
                  disabled={isSubmitting || !comment.trim()}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "var(--maison-brass-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--maison-brass)";
                  }}
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
