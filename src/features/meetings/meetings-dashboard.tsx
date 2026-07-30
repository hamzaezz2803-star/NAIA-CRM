"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { toast } from "react-hot-toast";
import {
  Calendar,
  Clock,
  User,
  Building,
  Sparkles,
  CalendarDays,
  CalendarRange,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Mail,
  MessageSquare,
  X,
} from "lucide-react";
import {
  updateLeadStatusAction,
  generateFollowUpDraftAction,
  syncLeadToGoogleCalendarAction,
} from "@/features/crm/actions";
import type { CrmLeadSummary } from "@/features/crm/contracts";
import type { GoogleCalendarEventSummary } from "@/platform/integrations/google-workspace";

type MeetingsDashboardProps = {
  initialLeads: CrmLeadSummary[];
  userName: string;
  googleConnected: boolean;
  googleEvents?: GoogleCalendarEventSummary[];
};

export function MeetingsDashboard({
  initialLeads,
  googleEvents,
}: MeetingsDashboardProps) {
  const [leads, setLeads] = useState<CrmLeadSummary[]>(initialLeads);
  const [activeTab, setActiveTab] = useState<"list" | "calendar">("list");
  const [filterType, setFilterType] = useState<"upcoming" | "past">("upcoming");

  // Briefing modal states
  const [briefingMeeting, setBriefingMeeting] = useState<CrmLeadSummary | null>(
    null,
  );
  const [briefingDrafts, setBriefingDrafts] = useState<{
    email: string;
    whatsapp: string;
  } | null>(null);
  const [isGeneratingBriefing, setIsGeneratingBriefing] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<string | null>(null);

  // Filter meetings (leads in meeting-booked status)
  const meetings = useMemo(() => {
    return leads
      .filter((lead) => lead.status === "meeting-booked")
      .sort((a, b) => {
        const dateA = getMeetingTime(a);
        const dateB = getMeetingTime(b);
        if (dateA === null && dateB === null) return 0;
        if (dateA === null) return 1;
        if (dateB === null) return -1;
        return dateA - dateB;
      });
  }, [leads]);

  // Separate upcoming and past meetings
  const filteredMeetings = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return meetings
      .filter((meeting) => {
        const meetingTime = getMeetingTime(meeting);
        if (filterType === "upcoming") {
          return meetingTime === null || meetingTime >= now;
        } else {
          return meetingTime !== null && meetingTime < now;
        }
      })
      .sort((a, b) => {
        const dateA = getMeetingTime(a);
        const dateB = getMeetingTime(b);
        if (dateA === null && dateB === null) return 0;
        if (dateA === null) return 1;
        if (dateB === null) return -1;
        return filterType === "upcoming" ? dateA - dateB : dateB - dateA;
      });
  }, [meetings, filterType]);

  // Compute completed meetings (those not in meeting-booked but with leadDate and status won/proposal-sent/dead-end)
  const completedMeetings = useMemo(() => {
    return leads
      .filter((lead) => {
        return (
          lead.leadDate &&
          (lead.status === "proposal-sent" ||
            lead.status === "won" ||
            lead.status === "dead-end")
        );
      })
      .sort((a, b) => {
        const dateA = a.leadDate ? new Date(a.leadDate).getTime() : 0;
        const dateB = b.leadDate ? new Date(b.leadDate).getTime() : 0;
        return dateB - dateA; // Most recent first
      });
  }, [leads]);

  // Compute Stats
  const stats = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const upcoming = meetings.filter((m) => {
      const t = getMeetingTime(m);
      return t !== null && t >= now;
    });

    const nextMeeting = upcoming.length > 0 ? upcoming[0] : null;

    let timeRemaining = "";
    if (nextMeeting?.leadDate) {
      const diffMs = new Date(nextMeeting.leadDate).getTime() - now;
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHrs / 24);

      if (diffDays > 0) {
        timeRemaining = `Dans ${diffDays}j et ${diffHrs % 24}h`;
      } else if (diffHrs > 0) {
        timeRemaining = `Dans ${diffHrs}h`;
      } else {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        timeRemaining = diffMins > 0 ? `Dans ${diffMins} min` : "Maintenant";
      }
    }

    return {
      totalBooked: upcoming.length,
      nextMeeting,
      timeRemaining,
      completedCount: leads.filter(
        (l) => l.status === "proposal-sent" || l.status === "won",
      ).length,
    };
  }, [meetings, leads]);

  // Google events already synced from a CRM lead carry their event ID/link
  // as `[Google Calendar Event ID: ...]` / `[Google Calendar Event Link: ...]`
  // markers in the lead notes: hide them to avoid showing the same meeting
  // twice. `undefined` means the user has no Google connection (panel hidden).
  const agendaEvents = useMemo(() => {
    if (!googleEvents) return undefined;

    const syncedEventIds = new Set<string>();
    const syncedEventLinks = new Set<string>();

    for (const lead of leads) {
      if (!lead.notes) continue;
      const idMatch = lead.notes.match(
        /\[Google Calendar Event ID:\s*([^\]]+)\]/,
      );
      if (idMatch) syncedEventIds.add(idMatch[1].trim());
      const linkMatch = lead.notes.match(
        /\[Google Calendar Event Link:\s*([^\]]+)\]/,
      );
      if (linkMatch) syncedEventLinks.add(linkMatch[1].trim());
    }

    return googleEvents.filter((event) => {
      // Recurring instances expose ids like `<eventId>_20260712T090000Z`.
      const baseEventId = event.id.split("_")[0];
      if (syncedEventIds.has(event.id) || syncedEventIds.has(baseEventId)) {
        return false;
      }
      return !event.htmlLink || !syncedEventLinks.has(event.htmlLink);
    });
  }, [googleEvents, leads]);

  // Calculate week days for Calendar Tab
  const weekDays = useMemo(() => {
    const startOfWeek = new Date();
    const currentDay = startOfWeek.getDay(); // 0 is Sun, 1 is Mon
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    startOfWeek.setDate(startOfWeek.getDate() + distanceToMonday);

    const days = [];
    const dayNames = [
      "Lundi",
      "Mardi",
      "Mercredi",
      "Jeudi",
      "Vendredi",
      "Samedi",
      "Dimanche",
    ];

    for (let index = 0; index < 7; index += 1) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + index);
      days.push({
        name: dayNames[index],
        dateStr: date.toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
        }),
        fullDateStr: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      });
    }
    return days;
  }, []);

  // Change meeting status (e.g. to Proposal Sent once done, or Delete)
  const handleUpdateStatus = async (leadId: string, newStatus: string) => {
    try {
      const response = await updateLeadStatusAction(leadId, newStatus);
      if (response.success) {
        setLeads((current) =>
          current.map((lead) =>
            lead.id === leadId ? { ...lead, status: newStatus } : lead,
          ),
        );
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  // Helper to extract Google Calendar event link from notes
  const getGoogleCalendarLink = (notes?: string) => {
    if (!notes) return null;
    const match = notes.match(/\[Google Calendar Event Link:\s*([^\]]+)\]/);
    return match ? match[1].trim() : null;
  };

  // Helper to extract the core customer need/notes from the raw notes field
  const getClientNeedSummary = (notes?: string) => {
    if (!notes) return "";
    const clean = notes
      .replace(/\[Google Calendar Event ID:\s*[^\]]+\]/g, "")
      .replace(/\[Google Calendar Event Link:\s*[^\]]+\]/g, "")
      .replace(/\[Google Drive Folder:[^\]]*\]\([^)]+\)/g, "")
      .trim();

    const lines = clean.split("\n");
    const contentLines = lines.filter((line) => {
      const lower = line.toLowerCase();
      return (
        !lower.startsWith("entreprise:") &&
        !lower.startsWith("contact:") &&
        !lower.startsWith("fonction:") &&
        !lower.startsWith("linkedin:") &&
        !lower.startsWith("email:") &&
        !lower.startsWith("tél:") &&
        !lower.startsWith("téléphone:")
      );
    });

    return contentLines.join(" ").trim();
  };

  // Open Briefing Modal and call AI to generate drafts
  const handleOpenBriefing = async (meeting: CrmLeadSummary) => {
    setBriefingMeeting(meeting);
    setBriefingDrafts(null);
    setBriefingError(null);
    setIsGeneratingBriefing(true);

    try {
      const noteLines = (meeting.notes ?? "").split("\n");
      const companyName =
        noteLines
          .find((l) => l.startsWith("Entreprise:"))
          ?.replace("Entreprise:", "")
          .trim() || meeting.companyName;
      const contactName =
        noteLines
          .find((l) => l.startsWith("Contact:"))
          ?.replace("Contact:", "")
          .trim() || meeting.contactName;

      const res = await generateFollowUpDraftAction({
        topic: meeting.topic,
        companyName,
        contactName,
        notes: meeting.notes,
        nextAction: meeting.nextAction,
      });

      if (res.success && res.drafts) {
        setBriefingDrafts(res.drafts);
      } else {
        setBriefingError(
          res.error || "Impossible de générer les brouillons de relance.",
        );
      }
    } catch (err) {
      setBriefingError(
        err instanceof Error
          ? err.message
          : "Une erreur inattendue est survenue lors de la génération.",
      );
    } finally {
      setIsGeneratingBriefing(false);
    }
  };

  // Synchronize and open Google Calendar event
  const handleOpenCalendar = async (meeting: CrmLeadSummary) => {
    const link = getGoogleCalendarLink(meeting.notes);
    if (link) {
      window.open(link, "_blank");
      return;
    }

    const toastId = toast.loading(
      "Création de l'événement Google Calendar en cours...",
    );
    setIsSyncing(meeting.id);
    try {
      const res = await syncLeadToGoogleCalendarAction(meeting.id);
      if (res.success && res.calendarLink) {
        // Save link to local state
        setLeads((prev) =>
          prev.map((l) =>
            l.id === meeting.id
              ? {
                  ...l,
                  notes: l.notes
                    ? `${l.notes}\n[Google Calendar Event Link: ${res.calendarLink}]`
                    : `[Google Calendar Event Link: ${res.calendarLink}]`,
                }
              : l,
          ),
        );
        toast.success("Événement créé avec succès !", { id: toastId });
        window.open(res.calendarLink, "_blank");
      } else {
        const errorMsg =
          res.error || "Google Workspace n'est pas configuré ou connecté.";
        toast.error(`${errorMsg} Redirection vers Google Agenda.`, {
          id: toastId,
        });
        setTimeout(() => {
          window.open("https://calendar.google.com", "_blank");
        }, 1000);
      }
    } catch {
      toast.error(
        "Erreur de synchronisation. Redirection vers Google Agenda.",
        { id: toastId },
      );
      setTimeout(() => {
        window.open("https://calendar.google.com", "_blank");
      }, 1000);
    } finally {
      setIsSyncing(null);
    }
  };

  const formatMeetingDate = (dateStr?: string) => {
    if (!dateStr) return "Non planifié";
    const date = new Date(dateStr);
    return date.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Google events use dateTime for timed events and date for all-day events.
  // Timezones are pinned so SSR and the browser render the same string:
  // bare dates parse as UTC midnight (display in UTC keeps the written day),
  // timed events display in the company timezone like the NAIA context does.
  const formatGoogleEventDate = (start?: string) => {
    if (!start) return "Date non précisée";
    const date = new Date(start);
    if (Number.isNaN(date.getTime())) return "Date non précisée";

    if (!start.includes("T")) {
      return `${date.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      })} · Journée entière`;
    }

    return date.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Casablanca",
    });
  };

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div
          className="rounded-lg border p-5 shadow-sm"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400">
              <CalendarRange className="h-5 w-5" />
            </span>
            <div>
              <p
                className="text-2xl font-bold"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {stats.totalBooked}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                Meetings prévus
              </p>
            </div>
          </div>
        </div>

        <div
          className="rounded-lg border p-5 shadow-sm"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
              <Clock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p
                className="truncate text-sm font-semibold"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {stats.nextMeeting
                  ? stats.nextMeeting.topic
                  : "Aucun meeting prévu"}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                {stats.timeRemaining
                  ? stats.timeRemaining
                  : "Pas d'événements à venir"}
              </p>
            </div>
          </div>
        </div>

        <div
          className="rounded-lg border p-5 shadow-sm"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <p
                className="text-2xl font-bold"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {stats.completedCount}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                Opportunités avancées
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dashboard Layout */}
      <div className="space-y-6">
        {/* Full-width Agenda/Calendar */}
        <div className="space-y-4">
          <div
            className="rounded-lg border p-5 shadow-sm"
            style={{
              background: "var(--maison-card)",
              borderColor: "var(--maison-border)",
            }}
          >
            {/* Header + Tabs */}
            <div
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4"
              style={{ borderColor: "var(--maison-border)" }}
            >
              <div className="flex items-center gap-2">
                <Calendar
                  className="h-5 w-5"
                  style={{ color: "var(--maison-brass)" }}
                />
                <h2
                  className="text-base font-bold"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Planning des réunions
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === "list"
                      ? "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                      : "text-stone-500 hover:text-stone-800"
                  }`}
                  onClick={() => setActiveTab("list")}
                  type="button"
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Liste
                </button>
                <button
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === "calendar"
                      ? "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                      : "text-stone-500 hover:text-stone-800"
                  }`}
                  onClick={() => setActiveTab("calendar")}
                  type="button"
                >
                  <CalendarRange className="h-3.5 w-3.5" />
                  Hebdomadaire
                </button>
              </div>
            </div>

            {/* List Tab */}
            {activeTab === "list" && (
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-2 border-b border-stone-100 pb-2 dark:border-stone-800">
                  <button
                    className={`text-xs font-semibold pb-1 border-b-2 transition ${
                      filterType === "upcoming"
                        ? "border-teal-700 text-teal-700 dark:border-teal-400 dark:text-teal-400"
                        : "border-transparent text-stone-500"
                    }`}
                    onClick={() => setFilterType("upcoming")}
                    type="button"
                  >
                    À venir ({filteredMeetings.length})
                  </button>
                  <button
                    className={`text-xs font-semibold pb-1 border-b-2 transition ${
                      filterType === "past"
                        ? "border-teal-700 text-teal-700 dark:border-teal-400 dark:text-teal-400"
                        : "border-transparent text-stone-500"
                    }`}
                    onClick={() => setFilterType("past")}
                    type="button"
                  >
                    Historique
                  </button>
                </div>

                {filteredMeetings.length === 0 ? (
                  <div className="py-12 text-center text-sm text-stone-400 dark:text-stone-500">
                    {filterType === "upcoming"
                      ? "Aucune réunion planifiée à venir."
                      : "Aucun historique de réunion trouvé."}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredMeetings.map((meeting) => {
                      return (
                        <div
                          key={meeting.id}
                          className="rounded-lg border p-4 shadow-sm transition hover:shadow-md"
                          style={{
                            background: "var(--maison-page)",
                            borderColor: "var(--maison-border)",
                          }}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300">
                                  <Clock className="mr-1 h-3 w-3" />
                                  {formatMeetingDate(meeting.leadDate)}
                                </span>
                              </div>
                              <h3 className="text-sm font-bold text-stone-950 dark:text-stone-50">
                                {meeting.topic}
                              </h3>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                                <span className="flex items-center gap-1">
                                  <Building className="h-3.5 w-3.5" />
                                  {meeting.companyName || "Non spécifiée"}
                                </span>
                                {meeting.contactName && (
                                  <span className="flex items-center gap-1">
                                    <User className="h-3.5 w-3.5" />
                                    {meeting.contactName}
                                  </span>
                                )}
                              </div>
                              {getClientNeedSummary(meeting.notes) && (
                                <p className="mt-2 text-xs text-stone-600 line-clamp-2 dark:text-stone-300">
                                  {getClientNeedSummary(meeting.notes)}
                                </p>
                              )}
                            </div>

                            {/* Quick Actions */}
                            <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
                              <button
                                onClick={() => handleOpenCalendar(meeting)}
                                disabled={isSyncing !== null}
                                className="w-full sm:w-36 inline-flex min-h-9 items-center justify-start gap-2.5 rounded-lg border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 hover:border-stone-300 dark:border-stone-850 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 disabled:opacity-50"
                                type="button"
                              >
                                {isSyncing === meeting.id ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent shrink-0"></div>
                                ) : (
                                  <Calendar className="h-4 w-4 text-blue-500 shrink-0" />
                                )}
                                <span>Agenda</span>
                              </button>
                              <button
                                onClick={() => handleOpenBriefing(meeting)}
                                className="w-full sm:w-36 inline-flex min-h-9 items-center justify-start gap-2.5 rounded-lg border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 hover:border-stone-300 dark:border-stone-850 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
                                type="button"
                              >
                                <Sparkles className="h-4 w-4 text-cyan-500 shrink-0" />
                                <span>Briefing IA</span>
                              </button>
                              <Link
                                href={`/dashboard/leads?leadId=${meeting.id}`}
                                className="w-full sm:w-36 inline-flex min-h-9 items-center justify-start gap-2.5 rounded-lg border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 hover:border-stone-300 dark:border-stone-850 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
                              >
                                <ExternalLink className="h-4 w-4 text-amber-500 shrink-0" />
                                <span>Fiche CRM</span>
                              </Link>
                              {filterType === "upcoming" && (
                                <button
                                  onClick={() =>
                                    handleUpdateStatus(
                                      meeting.id,
                                      "proposal-sent",
                                    )
                                  }
                                  className="w-full sm:w-36 inline-flex min-h-9 items-center justify-start gap-2.5 rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-250"
                                  type="button"
                                >
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                                  <span>Terminer</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Calendar Tab */}
            {activeTab === "calendar" && (
              <div className="mt-4">
                <div className="grid grid-cols-7 gap-2 border-b border-stone-100 pb-2 dark:border-stone-800">
                  {weekDays.map((day) => (
                    <div key={day.name} className="text-center">
                      <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                        {day.name.slice(0, 3)}
                      </p>
                      <p className="text-xs font-semibold mt-0.5 text-stone-900 dark:text-stone-100">
                        {day.dateStr}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2 min-h-96 mt-2">
                  {weekDays.map((day) => {
                    const dayMeetings = meetings.filter((meeting) => {
                      if (!meeting.leadDate) return false;
                      const d = new Date(meeting.leadDate);
                      const localDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                      return localDateStr === day.fullDateStr;
                    });

                    return (
                      <div
                        key={day.fullDateStr}
                        className="rounded-md bg-stone-50/50 p-1.5 border border-stone-100 space-y-2 dark:bg-stone-900/20 dark:border-stone-800"
                      >
                        {dayMeetings.length === 0 ? (
                          <div className="text-[10px] text-center text-stone-400 py-8">
                            Vide
                          </div>
                        ) : (
                          dayMeetings.map((meeting) => {
                            const time = meeting.leadDate
                              ? new Date(meeting.leadDate).toLocaleTimeString(
                                  "fr-FR",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )
                              : "";

                            return (
                              <div
                                key={meeting.id}
                                className="group relative rounded border border-cyan-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                              >
                                <p className="text-[9px] font-bold text-cyan-600 dark:text-cyan-400">
                                  {time}
                                </p>
                                <h4 className="text-[10px] font-semibold text-stone-950 dark:text-stone-50 line-clamp-1 leading-tight mt-0.5">
                                  {meeting.topic}
                                </h4>
                                <p className="text-[9px] text-stone-500 line-clamp-1 leading-none mt-0.5">
                                  {meeting.companyName}
                                </p>

                                <div className="absolute inset-0 bg-stone-900/90 text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between z-10">
                                  <p className="text-[8px] font-bold leading-tight line-clamp-2">
                                    {meeting.topic}
                                  </p>
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() =>
                                        handleOpenBriefing(meeting)
                                      }
                                      className="bg-cyan-500 hover:bg-cyan-400 text-white rounded text-[8px] px-1 py-0.5 font-bold"
                                      type="button"
                                    >
                                      Brief
                                    </button>
                                    <button
                                      onClick={() =>
                                        handleUpdateStatus(
                                          meeting.id,
                                          "proposal-sent",
                                        )
                                      }
                                      className="bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[8px] px-1 py-0.5 font-bold"
                                      type="button"
                                    >
                                      Fini
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Sidebar */}
        <div className="space-y-4">
          {/* Mon agenda Google Panel (real user events, deduplicated from CRM) */}
          {agendaEvents !== undefined && (
            <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3 dark:border-stone-800">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-sm font-bold text-stone-950 dark:text-stone-50">
                    Mon agenda Google
                  </h3>
                </div>
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                  {agendaEvents.length}
                </span>
              </div>

              <div className="mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                {agendaEvents.length === 0 ? (
                  <p className="py-6 text-center text-xs text-stone-500 dark:text-stone-400">
                    Aucun événement Google Agenda sur les 14 prochains jours.
                  </p>
                ) : (
                  agendaEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-lg border border-stone-150 bg-stone-50/30 p-3 transition hover:border-stone-300 dark:border-stone-850 dark:bg-stone-900/10 dark:hover:border-stone-750"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-semibold text-stone-900 dark:text-stone-100 line-clamp-2">
                          {event.title}
                        </h4>
                        <span className="inline-flex shrink-0 items-center rounded border border-blue-100 bg-blue-50/50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-400">
                          Google Agenda
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                        <span>{formatGoogleEventDate(event.start)}</span>
                      </div>
                      {event.htmlLink && (
                        <div className="mt-3 flex justify-end border-t border-stone-100/50 pt-2 dark:border-stone-800/50">
                          <a
                            href={event.htmlLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-2 py-1 text-[10px] font-bold text-stone-700 transition hover:bg-stone-50 dark:border-stone-850 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Ouvrir dans Agenda
                          </a>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Réunions Terminées Panel */}
          <div
            className="rounded-lg border p-5 shadow-sm flex flex-col max-h-[700px]"
            style={{
              background: "var(--maison-card)",
              borderColor: "var(--maison-border)",
            }}
          >
            <div
              className="flex items-center justify-between border-b pb-3"
              style={{ borderColor: "var(--maison-border)" }}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className="h-4 w-4"
                  style={{ color: "var(--maison-brass)" }}
                />
                <h3
                  className="text-sm font-bold"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Réunions terminées
                </h3>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                {completedMeetings.length}
              </span>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-1 max-h-[550px] scrollbar-thin">
              {completedMeetings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle2 className="h-8 w-8 text-stone-300 dark:text-stone-700 mb-2" />
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Aucune réunion terminée pour le moment.
                  </p>
                </div>
              ) : (
                completedMeetings.map((meeting) => {
                  const company = meeting.companyName || "Non spécifié";
                  const contact = meeting.contactName || "Non spécifié";

                  let statusBadge = null;
                  if (meeting.status === "proposal-sent") {
                    statusBadge = (
                      <span className="inline-flex items-center rounded border border-blue-100 bg-blue-50/50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-400">
                        Proposition
                      </span>
                    );
                  } else if (meeting.status === "won") {
                    statusBadge = (
                      <span className="inline-flex items-center rounded border border-emerald-100 bg-emerald-50/50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400">
                        Gagné
                      </span>
                    );
                  } else if (meeting.status === "dead-end") {
                    statusBadge = (
                      <span className="inline-flex items-center rounded border border-rose-100 bg-rose-50/50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:border-rose-900/30 dark:bg-rose-950/20 dark:text-rose-450">
                        Perdu
                      </span>
                    );
                  } else {
                    statusBadge = (
                      <span className="inline-flex items-center rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] font-semibold text-stone-700 dark:border-stone-850 dark:bg-stone-900 dark:text-stone-400">
                        Autre
                      </span>
                    );
                  }

                  return (
                    <div
                      key={meeting.id}
                      className="rounded-lg border p-3 hover:opacity-80 transition"
                      style={{
                        background: "var(--maison-page)",
                        borderColor: "var(--maison-border)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-semibold text-stone-900 dark:text-stone-100 line-clamp-1">
                          {meeting.topic}
                        </h4>
                        {statusBadge}
                      </div>

                      <div className="mt-2 space-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                        <div className="flex items-center gap-1.5">
                          <Building className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                          <span className="truncate">{company}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                          <span className="truncate">{contact}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                          <span>{formatMeetingDate(meeting.leadDate)}</span>
                        </div>
                      </div>

                      {/* Small Quick Actions */}
                      <div className="mt-3 flex items-center justify-end gap-2 border-t border-stone-100/50 pt-2 dark:border-stone-800/50">
                        <button
                          onClick={() => handleOpenBriefing(meeting)}
                          className="inline-flex items-center gap-1 rounded bg-cyan-50/50 border border-cyan-150 px-2 py-1 text-[10px] font-bold text-cyan-700 hover:bg-cyan-100 transition dark:bg-cyan-950/20 dark:border-cyan-900/30 dark:text-cyan-400"
                          type="button"
                        >
                          <Sparkles className="h-3 w-3" />
                          Relance IA
                        </button>
                        <Link
                          href={`/dashboard/leads?leadId=${meeting.id}`}
                          className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-2 py-1 text-[10px] font-bold text-stone-700 hover:bg-stone-50 transition dark:border-stone-850 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Fiche
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Briefing IA */}
      {briefingMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-stone-900 dark:text-stone-50">
                  Briefing IA : {briefingMeeting.topic}
                </h3>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                  Préparation commerciale pour{" "}
                  {briefingMeeting.contactName || "le client"} (
                  {briefingMeeting.companyName || "Non spécifié"})
                </p>
              </div>
              <button
                onClick={() => setBriefingMeeting(null)}
                className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {isGeneratingBriefing && (
                <div className="flex flex-col items-center justify-center py-16 space-y-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent"></div>
                  <p className="text-xs font-semibold text-stone-600 dark:text-stone-300">
                    NAIA prépare vos messages de relance personnalisés...
                  </p>
                </div>
              )}

              {briefingError && (
                <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-350">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                  <div className="space-y-2">
                    <p className="font-semibold">Une erreur est survenue</p>
                    <p className="leading-5">{briefingError}</p>
                    <button
                      onClick={() => handleOpenBriefing(briefingMeeting)}
                      className="inline-flex h-7 items-center rounded bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-700 transition"
                    >
                      Réessayer
                    </button>
                  </div>
                </div>
              )}

              {briefingDrafts && (
                <div className="space-y-4">
                  {/* Email Card */}
                  <div className="rounded-xl border border-teal-100 bg-teal-50/20 p-4 dark:border-teal-900/30 dark:bg-teal-950/10">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                        <h4 className="text-xs font-bold text-teal-900 dark:text-teal-200 uppercase tracking-wider">
                          Email de relance
                        </h4>
                      </div>
                      <a
                        href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
                          briefingMeeting.contactEmail || "",
                        )}&su=${encodeURIComponent(
                          "Suivi de notre entretien : " + briefingMeeting.topic,
                        )}&body=${encodeURIComponent(briefingDrafts.email)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-white px-3 text-xs font-semibold shadow-sm transition"
                      >
                        Ouvrir dans Gmail ↗
                      </a>
                    </div>
                    <div className="mt-3 rounded-lg border border-teal-100/50 bg-white/70 p-3.5 text-xs leading-relaxed text-stone-800 dark:border-teal-100/20 dark:bg-slate-950/40 dark:text-stone-300 whitespace-pre-wrap select-all font-sans">
                      {briefingDrafts.email}
                    </div>
                  </div>

                  {/* WhatsApp Card */}
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/20 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/10">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <h4 className="text-xs font-bold text-emerald-900 dark:text-emerald-200 uppercase tracking-wider">
                          WhatsApp Message
                        </h4>
                      </div>
                      <a
                        href={
                          briefingMeeting.contactPhone
                            ? `https://wa.me/${briefingMeeting.contactPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
                                briefingDrafts.whatsapp,
                              )}`
                            : `https://wa.me/?text=${encodeURIComponent(briefingDrafts.whatsapp)}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-3 text-xs font-semibold shadow-sm transition"
                      >
                        Ouvrir dans WhatsApp ↗
                      </a>
                    </div>
                    <div className="mt-3 rounded-lg border border-emerald-100/50 bg-white/70 p-3.5 text-xs leading-relaxed text-stone-800 dark:border-emerald-900/20 dark:bg-slate-950/40 dark:text-stone-300 whitespace-pre-wrap select-all font-sans">
                      {briefingDrafts.whatsapp}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3 flex justify-end">
              <button
                onClick={() => setBriefingMeeting(null)}
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-stone-200 bg-white px-4 text-xs font-semibold text-stone-700 hover:bg-stone-50 transition dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getMeetingTime(meeting: CrmLeadSummary) {
  return meeting.leadDate ? new Date(meeting.leadDate).getTime() : null;
}
