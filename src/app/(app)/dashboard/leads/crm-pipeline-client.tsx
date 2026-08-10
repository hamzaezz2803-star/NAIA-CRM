"use client";

import React, { useState, useEffect, useTransition, useRef } from "react";
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
  FolderOpen,
  CheckCircle,
  LayoutGrid,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  Mic,
  Check,
  Edit3,
  FileText,
} from "lucide-react";
import {
  createLeadAction,
  updateLeadStatusAction,
  deleteLeadAction,
  extractLeadFromNaturalTextAction,
  generateFollowUpDraftAction,
  createGoogleDriveFolderAction,
  updateLeadAction,
  syncLeadToGoogleCalendarAction,
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
  reorderCategoriesAction,
  createTagAction,
  updateTagAction,
  deleteTagAction,
  fetchLeadNotesAction,
  createLeadNoteAction,
  updateLeadNoteAction,
  deleteLeadNoteAction,
} from "@/features/crm/actions";
import {
  fetchCrmPipelineAuxiliaryAction,
  fetchCrmPipelineSnapshotAction,
} from "@/features/crm/pipeline-actions";
import type { CrmPipelineSnapshot } from "@/features/crm/pipeline-data";
import type {
  CrmLeadSummary,
  CrmLeadStatus,
  CrmCategory,
  CrmTag,
  CrmLeadNote,
} from "@/features/crm/contracts";
import { formatCrmDateTimeForInput } from "@/features/crm/date-time";
import { usePublishNaiaPageContext } from "@/features/naia/naia-page-context";
import { GOOGLE_REVOCATION_CONFIRMATION } from "@/platform/integrations/google-revocation-contract";
import toast from "react-hot-toast";

function formatLeadDateForDisplay(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const isMidnight =
      dateStr.includes("T00:00:00") ||
      dateStr.endsWith(" 00:00:00") ||
      !dateStr.includes("T");
    if (isMidnight) {
      return d.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } else {
      return d.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  } catch {
    return dateStr;
  }
}

function inferCompanyNameFromTopic(topic: string) {
  const cleanTopic = topic.trim();
  const companyPrefix = cleanTopic.split(" - ")[0]?.trim();

  if (
    companyPrefix &&
    companyPrefix.length >= 3 &&
    !/^projet\b/i.test(companyPrefix)
  ) {
    return companyPrefix;
  }

  const meetingMatch = cleanTopic.match(/(?:avec|chez)\s+(.+)$/i);
  return meetingMatch?.[1]?.trim() ?? "";
}

// ────────────────────────────────────────────────────────────
// Column config aligned with DB status values
// ────────────────────────────────────────────────────────────

const categoryColors: Record<
  string,
  { color: string; dot: string; border: string }
> = {
  blue: {
    color:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30",
    dot: "bg-blue-500",
    border: "border-blue-200 dark:border-blue-900/30",
  },
  gray: {
    color:
      "bg-stone-50 text-stone-600 border-stone-200 dark:bg-stone-900/50 dark:text-stone-400 dark:border-stone-800",
    dot: "bg-stone-400",
    border: "border-stone-200 dark:border-stone-800",
  },
  yellow: {
    color:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30",
    dot: "bg-amber-500",
    border: "border-amber-200 dark:border-amber-900/30",
  },
  indigo: {
    color:
      "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-900/30",
    dot: "bg-indigo-500",
    border: "border-indigo-200 dark:border-indigo-900/30",
  },
  emerald: {
    color:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30",
    dot: "bg-emerald-500",
    border: "border-emerald-200 dark:border-emerald-900/30",
  },
  teal: {
    color:
      "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-900/30",
    dot: "bg-teal-500",
    border: "border-teal-200 dark:border-teal-900/30",
  },
  red: {
    color:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30",
    dot: "bg-red-400",
    border: "border-red-200 dark:border-red-900/30",
  },
  purple: {
    color:
      "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/30",
    dot: "bg-purple-500",
    border: "border-purple-200 dark:border-purple-900/30",
  },
  pink: {
    color:
      "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/20 dark:text-pink-400 dark:border-pink-900/30",
    dot: "bg-pink-500",
    border: "border-pink-200 dark:border-pink-900/30",
  },
  orange: {
    color:
      "bg-orange-50 text-orange-750 border-orange-200 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-900/30",
    dot: "bg-orange-500",
    border: "border-orange-200 dark:border-orange-900/30",
  },
  sky: {
    color:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/20 dark:text-sky-400 dark:border-sky-900/30",
    dot: "bg-sky-500",
    border: "border-sky-200 dark:border-sky-900/30",
  },
  lime: {
    color:
      "bg-lime-50 text-lime-750 border-lime-200 dark:bg-lime-950/20 dark:text-lime-400 dark:border-lime-900/30",
    dot: "bg-lime-500",
    border: "border-lime-200 dark:border-lime-900/30",
  },
  rose: {
    color:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30",
    dot: "bg-rose-500",
    border: "border-rose-200 dark:border-rose-900/30",
  },
};

function getCategoryStyle(color: string) {
  return categoryColors[color] || categoryColors.gray;
}

const DEFAULT_CATEGORIES: CrmCategory[] = [
  {
    id: "1",
    organizationId: "",
    name: "À contacter",
    statusKey: "lead-to-contact",
    color: "blue",
    position: 1,
  },
  {
    id: "2",
    organizationId: "",
    name: "Contacté",
    statusKey: "contacted",
    color: "gray",
    position: 2,
  },
  {
    id: "3",
    organizationId: "",
    name: "À relancer",
    statusKey: "to-follow-up",
    color: "yellow",
    position: 3,
  },
  {
    id: "4",
    organizationId: "",
    name: "Meeting fixé",
    statusKey: "meeting-booked",
    color: "indigo",
    position: 4,
  },
  {
    id: "5",
    organizationId: "",
    name: "Propale envoyée",
    statusKey: "proposal-sent",
    color: "emerald",
    position: 5,
  },
  {
    id: "6",
    organizationId: "",
    name: "Gagné ✓",
    statusKey: "won",
    color: "teal",
    position: 6,
  },
  {
    id: "7",
    organizationId: "",
    name: "Dead end",
    statusKey: "dead-end",
    color: "red",
    position: 7,
  },
];

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export function CrmPipelineClient({
  initialData,
}: {
  initialData: CrmPipelineSnapshot;
}) {
  const [leads, setLeads] = useState<CrmLeadSummary[]>(initialData.leads);
  const [categories, setCategories] = useState<CrmCategory[]>(
    initialData.categories.length > 0
      ? initialData.categories
      : DEFAULT_CATEGORIES,
  );
  const isLoading = false;

  // Tags & Team members state
  const [tags, setTags] = useState<CrmTag[]>([]);
  const [teamMembers, setTeamMembers] = useState<
    { id: string; fullName: string; email: string; avatarUrl?: string }[]
  >([]);

  // Selected lead notes
  const [notes, setNotes] = useState<CrmLeadNote[]>([]);
  const [newNoteText, setNewNoteText] = useState("");
  const [newNoteAssigneeId, setNewNoteAssigneeId] = useState<string>("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [editingNoteAssigneeId, setEditingNoteAssigneeId] =
    useState<string>("");
  const [isNotesLoading, setIsNotesLoading] = useState(false);

  // Form selections (Creation)
  const [formAssignee, setFormAssignee] = useState<string>("");
  const [formTags, setFormTags] = useState<string[]>([]);

  // Tag creation modal/fields inside form
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("teal");
  const [isCreatingTag, setIsCreatingTag] = useState(false);

  // Form selections (Edition)
  const [editAssignee, setEditAssignee] = useState<string>("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  // Mode & Google auth states
  const [viewMode, setViewMode] = useState<"kanban" | "calendar" | "list">(
    "kanban",
  );
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState<"month" | "week" | "day">(
    "month",
  );
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);

  // List view filters state
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCompany, setFilterCompany] = useState<string>("all");

  const uniqueCompanies = Array.from(
    new Set(
      leads
        .map((l) => {
          const noteLines = (l.notes ?? "").split("\n");
          return noteLines
            .find((line) => line.startsWith("Entreprise:"))
            ?.replace("Entreprise:", "")
            .trim();
        })
        .filter(Boolean) as string[],
    ),
  ).sort();

  const filteredLeads = leads.filter((lead) => {
    if (filterStatus !== "all" && lead.status !== filterStatus) {
      return false;
    }
    if (filterCompany !== "all") {
      const noteLines = (lead.notes ?? "").split("\n");
      const companyName =
        noteLines
          .find((l) => l.startsWith("Entreprise:"))
          ?.replace("Entreprise:", "")
          .trim() ?? "";
      if (companyName !== filterCompany) {
        return false;
      }
    }
    return true;
  });

  const hourlyScrollContainerRef = React.useRef<HTMLDivElement>(null);
  const kanbanContainerRef = useRef<HTMLDivElement>(null);

  // Helper functions for modern calendar views
  function getDaysOfWeek(date: Date): Date[] {
    const currentDay = date.getDay(); // 0 is Sunday, 1 is Monday...
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(date);
    monday.setDate(date.getDate() + distanceToMonday);

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    return days;
  }

  const getPeriodLabel = () => {
    if (calendarMode === "month") {
      return calendarDate.toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
      });
    } else if (calendarMode === "week") {
      const days = getDaysOfWeek(calendarDate);
      const start = days[0];
      const end = days[6];
      const startMonth = start.toLocaleDateString("fr-FR", { month: "short" });
      const endMonth = end.toLocaleDateString("fr-FR", { month: "short" });
      const startYear = start.getFullYear();
      const endYear = end.getFullYear();

      if (startYear !== endYear) {
        return `${start.getDate()} ${startMonth} ${startYear} – ${end.getDate()} ${endMonth} ${endYear}`;
      } else if (startMonth !== endMonth) {
        return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth} ${startYear}`;
      } else {
        return `${start.getDate()} – ${end.getDate()} ${startMonth} ${startYear}`;
      }
    } else {
      return calendarDate.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
  };

  const handlePrevCalendar = () => {
    if (calendarMode === "month") {
      setCalendarDate(
        new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1),
      );
    } else if (calendarMode === "week") {
      const prevWeek = new Date(calendarDate);
      prevWeek.setDate(calendarDate.getDate() - 7);
      setCalendarDate(prevWeek);
    } else {
      const prevDay = new Date(calendarDate);
      prevDay.setDate(calendarDate.getDate() - 1);
      setCalendarDate(prevDay);
    }
  };

  const handleNextCalendar = () => {
    if (calendarMode === "month") {
      setCalendarDate(
        new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1),
      );
    } else if (calendarMode === "week") {
      const nextWeek = new Date(calendarDate);
      nextWeek.setDate(calendarDate.getDate() + 7);
      setCalendarDate(nextWeek);
    } else {
      const nextDay = new Date(calendarDate);
      nextDay.setDate(calendarDate.getDate() + 1);
      setCalendarDate(nextDay);
    }
  };

  const handleCellClick = (dateStr: string) => {
    resetForm();
    setFormLeadDate(formatCrmDateTimeForInput(dateStr));
    setFormStatus("to-follow-up");
    setIsAddOpen(true);
  };

  // Scroll week/day grid to 08:00
  useEffect(() => {
    if (
      viewMode === "calendar" &&
      (calendarMode === "week" || calendarMode === "day")
    ) {
      setTimeout(() => {
        if (hourlyScrollContainerRef.current) {
          hourlyScrollContainerRef.current.scrollTop = 380; // slightly above 8am
        }
      }, 50);
    }
  }, [viewMode, calendarMode, calendarDate]);

  // Modal states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<CrmLeadSummary | null>(null);

  usePublishNaiaPageContext({
    entity: selectedLead
      ? {
          id: selectedLead.id,
          kind: "lead",
          label: selectedLead.companyName ?? selectedLead.topic,
        }
      : undefined,
    filters:
      viewMode === "list"
        ? {
            company: filterCompany === "all" ? undefined : filterCompany,
            status: filterStatus === "all" ? undefined : filterStatus,
          }
        : undefined,
    view: viewMode,
    viewLabel:
      viewMode === "kanban"
        ? "Pipeline"
        : viewMode === "calendar"
          ? "Calendrier"
          : "Liste",
  });

  // Edit form fields state
  const [editTopic, setEditTopic] = useState("");
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editContactName, setEditContactName] = useState("");
  const [editJobTitle, setEditJobTitle] = useState("");
  const [editLinkedin, setEditLinkedin] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSource, setEditSource] = useState("");
  const [editNextAction, setEditNextAction] = useState("");
  const [editLeadDate, setEditLeadDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] =
    useState<CrmLeadStatus>("lead-to-contact");

  const openEditModal = (lead: CrmLeadSummary) => {
    setSelectedLead(lead);
    setDrafts(null);
    // Prefer driveFolderUrl field; fallback to legacy notes extraction
    setDriveLink(
      lead.driveFolderUrl ?? extractDriveLinkFromNotes(lead.notes) ?? null,
    );
    setCalendarLink(extractCalendarLinkFromNotes(lead.notes));
    setModalError(null);

    const noteLines = (lead.notes ?? "").split("\n");
    const company =
      noteLines
        .find((l) => l.startsWith("Entreprise:"))
        ?.replace("Entreprise:", "")
        .trim() ?? "";
    const contact =
      noteLines
        .find((l) => l.startsWith("Contact:"))
        ?.replace("Contact:", "")
        .trim() ?? "";
    const email =
      noteLines
        .find((l) => l.startsWith("Email:"))
        ?.replace("Email:", "")
        .trim() ?? "";
    const phone =
      noteLines
        .find((l) => l.startsWith("Tél:"))
        ?.replace("Tél:", "")
        .trim() ?? "";
    const notesOnly = noteLines
      .filter(
        (l) =>
          !l.startsWith("Entreprise:") &&
          !l.startsWith("Contact:") &&
          !l.startsWith("Fonction:") &&
          !l.startsWith("LinkedIn:") &&
          !l.startsWith("Email:") &&
          !l.startsWith("Tél:"),
      )
      .join("\n");

    setEditTopic(lead.topic);
    setEditCompanyName(company);
    setEditContactName(contact);
    // Read job title and LinkedIn from proper DB fields (fall back to notes for legacy data)
    setEditJobTitle(
      lead.contactJobTitle ??
        noteLines
          .find((l) => l.startsWith("Fonction:"))
          ?.replace("Fonction:", "")
          .trim() ??
        "",
    );
    setEditLinkedin(
      lead.contactLinkedinUrl ??
        noteLines
          .find((l) => l.startsWith("LinkedIn:"))
          ?.replace("LinkedIn:", "")
          .trim() ??
        "",
    );
    setEditEmail(email);
    setEditPhone(phone);
    setEditSource(lead.source ?? "");
    setEditNextAction(lead.nextAction ?? "");
    setEditLeadDate(formatCrmDateTimeForInput(lead.leadDate ?? ""));
    setEditNotes(notesOnly);
    setEditStatus(lead.status);

    // Populate assignment and tags
    setEditAssignee(lead.assignedToProfileId ?? "");
    setEditTags((lead.tags ?? []).map((t) => t.id));

    // Reset notes forms and fetch notes from backend
    setNewNoteText("");
    setEditingNoteId(null);
    setEditingNoteText("");
    setIsNotesLoading(true);
    fetchLeadNotesAction(lead.id)
      .then((notesData) => {
        setNotes(notesData);
      })
      .catch((err) => console.error("Error loading notes:", err))
      .finally(() => {
        setIsNotesLoading(false);
      });
  };

  // Natural text intake
  const [naturalText, setNaturalText] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null,
  );
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const shouldTranscribeRef = useRef(true);

  // Audio recording timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  // Form fields (from extracted or manual)
  const [formTopic, setFormTopic] = useState("");
  const [formCompanyName, setFormCompanyName] = useState("");
  const [formContactName, setFormContactName] = useState("");
  const [formJobTitle, setFormJobTitle] = useState("");
  const [formLinkedin, setFormLinkedin] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formSource, setFormSource] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formNextAction, setFormNextAction] = useState("");
  const [formLeadDate, setFormLeadDate] = useState("");
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
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isFormStatusDropdownOpen, setIsFormStatusDropdownOpen] =
    useState(false);

  // Category management modal states
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CrmCategory | null>(
    null,
  ); // null means adding a new category
  const [categoryFormName, setCategoryFormName] = useState("");
  const [categoryFormColor, setCategoryFormColor] = useState("blue");
  const [isCategorySubmitting, setIsCategorySubmitting] = useState(false);

  const openCategoryModal = (cat: CrmCategory | null) => {
    setEditingCategory(cat);
    setCategoryFormName(cat ? cat.name : "");
    setCategoryFormColor(cat ? cat.color : "blue");
    setIsCategoryModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryFormName.trim()) {
      toast.error("Le nom de la catégorie est obligatoire.");
      return;
    }
    setIsCategorySubmitting(true);
    const toastId = toast.loading(
      editingCategory
        ? "Mise à jour de la catégorie..."
        : "Création de la catégorie...",
    );

    try {
      if (editingCategory) {
        // Edit
        const res = await updateCategoryAction(editingCategory.id, {
          name: categoryFormName,
          color: categoryFormColor,
        });
        if (res.success) {
          setCategories(
            categories.map((c) =>
              c.id === editingCategory.id
                ? { ...c, name: categoryFormName, color: categoryFormColor }
                : c,
            ),
          );
          toast.success("Catégorie mise à jour avec succès !", { id: toastId });
          setIsCategoryModalOpen(false);
        } else {
          toast.error(res.error || "Une erreur est survenue.", { id: toastId });
        }
      } else {
        // Create
        const res = await createCategoryAction(
          categoryFormName,
          categoryFormColor,
        );
        if (res.success && res.category) {
          setCategories([...categories, res.category]);
          toast.success("Catégorie créée avec succès !", { id: toastId });
          setIsCategoryModalOpen(false);
        } else {
          toast.error(res.error || "Une erreur est survenue.", { id: toastId });
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Erreur de communication.", { id: toastId });
    } finally {
      setIsCategorySubmitting(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!editingCategory) return;
    if (categories.length <= 1) {
      toast.error("Impossible de supprimer la seule catégorie restante.");
      return;
    }

    const confirm = window.confirm(
      "Êtes-vous sûr de vouloir supprimer cette catégorie ? Tous les leads associés seront automatiquement déplacés vers une autre catégorie.",
    );
    if (!confirm) return;

    setIsCategorySubmitting(true);
    const toastId = toast.loading("Suppression de la catégorie...");

    try {
      const res = await deleteCategoryAction(editingCategory.id);
      if (res.success) {
        // One snapshot keeps the post-mutation refresh consistent and avoids
        // serial Server Action reads competing for the same client queue.
        const snapshot = await fetchCrmPipelineSnapshotAction();
        setLeads(snapshot.leads);
        setCategories(
          snapshot.categories.length > 0
            ? snapshot.categories
            : DEFAULT_CATEGORIES,
        );
        toast.success("Catégorie supprimée avec succès !", { id: toastId });
        setIsCategoryModalOpen(false);
      } else {
        toast.error(res.error || "Une erreur est survenue.", { id: toastId });
      }
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de la suppression.", { id: toastId });
    } finally {
      setIsCategorySubmitting(false);
    }
  };

  const handleMoveCategoryOrder = async (
    catId: string,
    direction: "left" | "right",
  ) => {
    const idx = categories.findIndex((c) => c.id === catId);
    if (idx === -1) return;

    const newCategories = [...categories];
    if (direction === "left" && idx > 0) {
      // Swap with previous
      const temp = newCategories[idx];
      newCategories[idx] = newCategories[idx - 1];
      newCategories[idx - 1] = temp;
    } else if (direction === "right" && idx < categories.length - 1) {
      // Swap with next
      const temp = newCategories[idx];
      newCategories[idx] = newCategories[idx + 1];
      newCategories[idx + 1] = temp;
    } else {
      return;
    }

    // Optimistically update UI
    setCategories(newCategories);

    // Persist to database
    const orderedIds = newCategories.map((c) => c.id);
    const res = await reorderCategoriesAction(orderedIds);
    if (!res.success) {
      toast.error(res.error || "Erreur de réorganisation.");
      // Rollback on error
      const snapshot = await fetchCrmPipelineSnapshotAction();
      setCategories(
        snapshot.categories.length > 0
          ? snapshot.categories
          : DEFAULT_CATEGORIES,
      );
    }
  };

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

  // The blocking pipeline data arrived with the Server Component. Secondary
  // controls are loaded lazily so Google/tags/team cannot delay the Kanban.
  useEffect(() => {
    let isMounted = true;
    async function loadAuxiliaryData() {
      try {
        const auxiliary = await fetchCrmPipelineAuxiliaryAction();
        if (isMounted) {
          setIsGoogleConnected(auxiliary.isGoogleConnected);
          setTags(auxiliary.tags);
          setTeamMembers(auxiliary.teamMembers);
        }
      } catch (err) {
        console.error("Failed to load CRM auxiliary data:", err);
      }
    }

    void loadAuxiliaryData();

    const params = new URLSearchParams(window.location.search);
    const leadId = params.get("leadId");
    const matchedLead = leadId
      ? initialData.leads.find((lead) => lead.id === leadId)
      : undefined;
    if (matchedLead) {
      queueMicrotask(() => {
        if (!isMounted) return;
        openEditModal(matchedLead);
        if (params.get("generateDraft") === "true") {
          void handleGenerateDraft(matchedLead);
        }
      });
    }

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for Google Auth callback popup messaging
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "GOOGLE_AUTH_SUCCESS") {
        setIsGoogleConnected(true);
        setFormError(null);
        toast.success("Google Workspace connecté avec succès !");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

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
    try {
      const response = await fetch("/api/integrations/google/revoke", {
        body: JSON.stringify({
          confirmation: GOOGLE_REVOCATION_CONFIRMATION,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        manualReviewRequired?: boolean;
        ok?: boolean;
      } | null;
      if (response.ok && payload?.ok) {
        setIsGoogleConnected(false);
        toast.success("Accès Google révoqué et déconnecté.");
        return;
      }

      if (payload?.manualReviewRequired) {
        // The server quarantined this connection as needs-review. Keep the CRM
        // fail-closed and direct the user to the full confirmation flow.
        setIsGoogleConnected(false);
        toast.error(
          `${payload.error ?? "Révocation Google à confirmer."} Finalisez depuis Intégrations.`,
        );
        return;
      }

      toast.error(
        payload?.error ?? "La révocation Google n’a pas pu être confirmée.",
      );
    } catch {
      toast.error("Échec de la communication avec le serveur.");
    }
  };

  // ── Audio recording ──────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const supportedMimeType = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
      ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      const options = supportedMimeType
        ? { mimeType: supportedMimeType }
        : undefined;

      const recorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        // Stop all tracks in the stream
        stream.getTracks().forEach((track) => track.stop());
        setMediaRecorder((current) => (current === recorder ? null : current));
        setIsRecording(false);

        if (!shouldTranscribeRef.current) {
          // Recording was discarded/cancelled
          return;
        }

        const audioBlob = new Blob(chunks, {
          type: recorder.mimeType || supportedMimeType || "audio/webm",
        });
        if (audioBlob.size === 0) return;

        setIsTranscribing(true);
        const transcribeToastId = toast.loading(
          "Transcription de l'enregistrement...",
        );
        try {
          const response = await fetch("/api/crm/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": audioBlob.type || "audio/webm",
            },
            body: audioBlob,
          });

          if (!response.ok) {
            throw new Error("Erreur de transcription");
          }

          const data = await response.json();
          if (data.text) {
            setNaturalText(data.text);
            toast.success("Enregistrement transcrit !", {
              id: transcribeToastId,
            });
            // Automatically run AI extraction on the transcribed text
            await handleExtract(data.text);
          } else {
            toast.error("Aucun texte détecté.", { id: transcribeToastId });
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error("Failed to transcribe:", error);
          toast.error("Échec de la transcription : " + error.message, {
            id: transcribeToastId,
          });
        } finally {
          setIsTranscribing(false);
        }
      };

      shouldTranscribeRef.current = true;
      recorder.start();
      setMediaRecorder(recorder);
      setRecordingTime(0);
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
      toast.error("Impossible d'accéder au microphone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      shouldTranscribeRef.current = true;
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const discardActiveRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      shouldTranscribeRef.current = false;
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    discardActiveRecording();
    toast.success("Enregistrement annulé.");
  };

  const closeAddModal = () => {
    discardActiveRecording();
    setIsAddOpen(false);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // ── AI extraction ──────────────────────────────────────
  async function handleExtract(overrideText?: string) {
    const textToUse = overrideText !== undefined ? overrideText : naturalText;
    if (!textToUse.trim()) return;
    setIsExtracting(true);
    setExtractError(null);
    const extractToastId = toast.loading("Analyse et extraction en cours...");

    const res = await extractLeadFromNaturalTextAction(textToUse);

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
      setFormLeadDate(e.leadDate ? formatCrmDateTimeForInput(e.leadDate) : "");
      if (e.status) {
        setFormStatus(e.status);
      }
      toast.success("Informations du lead extraites !", { id: extractToastId });
    } else {
      const err = res.error ?? "Extraction échouée";
      setExtractError(err);
      toast.error("Échec de l'extraction : " + err, { id: extractToastId });
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
    const createToastId = toast.loading("Création du lead...");

    // Concat legacy contact info inside notes for display compatibility
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
      leadDate: formLeadDate || undefined,
      contactJobTitle: formJobTitle || undefined,
      contactLinkedinUrl: formLinkedin || undefined,
      assignedToProfileId: formAssignee || undefined,
      tagIds: formTags,
    });

    if (res.success && res.lead) {
      setLeads((prev) => [res.lead!, ...prev]);
      resetForm();
      setIsAddOpen(false);
      toast.success("Lead créé avec succès !", { id: createToastId });
    } else {
      const err = res.error ?? "Impossible de créer le lead.";
      setFormError(err);
      toast.error(err, { id: createToastId });
    }
    setIsSubmitting(false);
  }

  // ── Update lead ─────────────────────────────────────────
  async function handleUpdateLead(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLead) return;
    if (!editTopic.trim()) {
      setModalError("Le nom du projet est obligatoire.");
      return;
    }
    setIsSubmitting(true);
    setModalError(null);
    const updateToastId = toast.loading("Mise à jour du lead...");

    const res = await updateLeadAction(selectedLead.id, {
      topic: editTopic,
      status: editStatus,
      source: editSource || undefined,
      notes:
        [
          editCompanyName && `Entreprise: ${editCompanyName}`,
          editContactName && `Contact: ${editContactName}`,
          editEmail && `Email: ${editEmail}`,
          editPhone && `Tél: ${editPhone}`,
          editNotes,
        ]
          .filter(Boolean)
          .join("\n") || undefined,
      nextAction: editNextAction || undefined,
      leadDate: editLeadDate || undefined,
      contactJobTitle: editJobTitle,
      contactLinkedinUrl: editLinkedin,
      assignedToProfileId: editAssignee || null,
      tagIds: editTags,
    });

    if (res.success && res.lead) {
      setLeads((prev) =>
        prev.map((l) => (l.id === res.lead!.id ? res.lead! : l)),
      );
      setSelectedLead(res.lead);
      toast.success("Lead mis à jour avec succès !", { id: updateToastId });
    } else {
      const err = res.error ?? "Impossible de modifier le lead.";
      setModalError(err);
      toast.error(err, { id: updateToastId });
    }
    setIsSubmitting(false);
  }

  function resetForm() {
    setNaturalText("");
    setFormTopic("");
    setFormCompanyName("");
    setFormContactName("");
    setFormJobTitle("");
    setFormLinkedin("");
    setFormEmail("");
    setFormPhone("");
    setFormSource("");
    setFormNotes("");
    setFormNextAction("");
    setFormLeadDate("");
    setFormStatus("lead-to-contact");
    setFormError(null);
    setExtractError(null);
    setIsFormStatusDropdownOpen(false);
    setIsStatusDropdownOpen(false);
    setFormAssignee("");
    setFormTags([]);
  }

  // ── Move lead status ────────────────────────────
  async function handleMoveStatus(
    lead: CrmLeadSummary,
    newStatus: CrmLeadStatus,
  ) {
    const moveToastId = toast.loading("Mise à jour du statut...");
    startTransition(async () => {
      const res = await updateLeadStatusAction(lead.id, newStatus);
      if (res.success) {
        setLeads((prev) =>
          prev.map((l) => (l.id === lead.id ? { ...l, status: newStatus } : l)),
        );
        toast.success("Statut du lead mis à jour !", { id: moveToastId });
      } else {
        toast.error(res.error || "Erreur de mise à jour du statut.", {
          id: moveToastId,
        });
      }
    });
  }

  // ── Delete lead ─────────────────────────────────────────
  async function handleDelete(leadId: string) {
    const deleteToastId = toast.loading("Suppression du lead...");
    startTransition(async () => {
      const res = await deleteLeadAction(leadId);
      if (res.success) {
        setLeads((prev) => prev.filter((l) => l.id !== leadId));
        if (selectedLead?.id === leadId) setSelectedLead(null);
        toast.success("Lead supprimé avec succès.", { id: deleteToastId });
      } else {
        toast.error(res.error || "Impossible de supprimer le lead.", {
          id: deleteToastId,
        });
      }
    });
  }

  // ── Generate follow-up draft ────────────────────────────
  async function handleGenerateDraft(lead: CrmLeadSummary) {
    setDraftLead(lead);
    setDrafts(null);
    setIsGenerating(true);
    setModalError(null);
    const draftToastId = toast.loading(
      "Génération des brouillons de relance...",
    );

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
      toast.success("Brouillons générés !", { id: draftToastId });
    } else {
      const err = res.error || "Erreur de génération du brouillon.";
      setModalError(err);
      toast.error(err, { id: draftToastId });
    }
    setIsGenerating(false);
  }

  // ── Create client Google Drive folder ───────────────────
  async function handleCreateDriveFolder(lead: CrmLeadSummary) {
    setModalError(null);
    setDriveLink(null);

    // Client folders are created by the org service account, not the user's
    // personal Google connection — no connect gate needed here.

    // If already has a Drive folder, just open it
    const existingLink =
      lead.driveFolderUrl ?? extractDriveLinkFromNotes(lead.notes);
    if (existingLink) {
      setDriveLink(existingLink);
      window.open(existingLink, "_blank");
      return;
    }

    setIsCreatingFolder(true);
    const driveToastId = toast.loading(
      "Creation du dossier client sur Google Drive...",
    );

    // The server resolves the canonical company through the authorized lead;
    // no browser-provided label is trusted for provider-side folder creation.
    const res = await createGoogleDriveFolderAction(lead.id);

    if (res.success && res.folderLink) {
      setDriveLink(res.folderLink);

      // Update lead in local state with driveFolderUrl
      const updatedLead = { ...lead, driveFolderUrl: res.folderLink };
      setSelectedLead(updatedLead);
      setLeads(leads.map((l) => (l.id === lead.id ? updatedLead : l)));

      toast.success("Dossier client cree dans le Drive partage Qarizmi !", {
        id: driveToastId,
      });
      window.open(res.folderLink, "_blank");
    } else {
      const err = res.error || "Impossible de creer le dossier Drive.";
      setModalError(err);
      toast.error(err, { id: driveToastId });
    }
    setIsCreatingFolder(false);
  }

  // ── Sync with Google Calendar manually ─────────────────
  async function handleSyncCalendar(lead: CrmLeadSummary) {
    setModalError(null);
    setIsSyncingCalendar(true);

    if (!isGoogleConnected) {
      const errMsg =
        "Veuillez d'abord connecter votre compte Google. Ouverture de la fenêtre...";
      setModalError(errMsg);
      toast.error(errMsg);
      handleConnectGoogle();
      setIsSyncingCalendar(false);
      return;
    }

    const calendarToastId = toast.loading(
      "Synchronisation avec Google Calendar...",
    );
    const res = await syncLeadToGoogleCalendarAction(lead.id);

    if (res.success && res.calendarLink) {
      setCalendarLink(res.calendarLink);

      // Update notes in local state
      const updatedNotes = lead.notes
        ? `${lead.notes}\n[Google Calendar Event Link: ${res.calendarLink}]`
        : `[Google Calendar Event Link: ${res.calendarLink}]`;

      const updatedLead = { ...lead, notes: updatedNotes };
      setSelectedLead(updatedLead);
      setLeads(leads.map((l) => (l.id === lead.id ? updatedLead : l)));
      toast.success("Événement Google Calendar créé !", {
        id: calendarToastId,
      });
    } else {
      const err =
        res.error || "Impossible de synchroniser avec Google Calendar.";
      setModalError(err);
      toast.error(err, { id: calendarToastId });
    }
    setIsSyncingCalendar(false);
  }

  // ── Helpers ─────────────────────────────────────────────
  function getNextStatus(current: CrmLeadStatus): CrmLeadStatus | null {
    const idx = categories.findIndex((c) => c.statusKey === current);
    return idx >= 0 && idx < categories.length - 1
      ? categories[idx + 1].statusKey
      : null;
  }

  function getColumnConfig(status: CrmLeadStatus) {
    const cat = categories.find((c) => c.statusKey === status);
    if (!cat) {
      return {
        label: status,
        status: status,
        color: "bg-stone-50 text-stone-600 border-stone-200",
        dot: "bg-stone-400",
        border: "border-stone-200",
      };
    }
    const style = getCategoryStyle(cat.color);
    return {
      label: cat.name,
      status: cat.statusKey,
      color: style.color,
      dot: style.dot,
      border: style.border,
    };
  }

  // Check for overdue leads (active leads with leadDate in the past)
  const overdueLeads = React.useMemo(() => {
    return leads.filter((lead) => {
      if (!lead.leadDate) return false;
      if (lead.status === "won" || lead.status === "dead-end") return false;
      try {
        return new Date(lead.leadDate) < new Date();
      } catch {
        return false;
      }
    });
  }, [leads]);

  const activeLeads = leads.filter(
    (l) => l.status !== "won" && l.status !== "dead-end",
  );

  return (
    <div className="space-y-4">
      <div
        className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between"
        style={{ borderColor: "var(--maison-border)" }}
      >
        {/* Left: breadcrumb + title */}
        <div className="min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--maison-brass)" }}
          >
            CRM · Espace Interne
          </p>
          <div className="flex items-baseline gap-3 flex-wrap mt-1">
            <h1
              className="text-2xl font-semibold tracking-tight md:text-3xl font-serif"
              style={{
                fontFamily: "var(--font-playfair), Georgia, serif",
                color: "var(--maison-text-primary)",
              }}
            >
              Pipeline
            </h1>
            <p
              className="text-sm"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              {activeLeads.length} lead{activeLeads.length !== 1 ? "s" : ""}{" "}
              actif{activeLeads.length !== 1 ? "s" : ""}
              {overdueLeads.length > 0 && (
                <>
                  {" · "}
                  <span
                    className="font-semibold"
                    style={{ color: "var(--maison-brass)" }}
                  >
                    {overdueLeads.length} relance
                    {overdueLeads.length !== 1 ? "s" : ""} en retard
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Google connection */}
          {isGoogleConnected ? (
            <div
              className="flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium"
              style={{
                background: "var(--maison-page)",
                borderColor: "var(--maison-border)",
                color: "var(--maison-text-primary)",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--maison-brass)" }}
              />
              Google connecté
              <button
                onClick={handleDisconnectGoogle}
                title="Déconnecter Google"
                className="ml-1 transition"
                style={{ color: "var(--maison-text-muted)" }}
              >
                <LogOut className="h-3.5 w-3.5 hover:text-red-500" />
              </button>
            </div>
          ) : (
            <Button
              onClick={handleConnectGoogle}
              variant="outline"
              className="h-8 text-xs"
              style={{
                background: "var(--maison-card)",
                borderColor: "var(--maison-border)",
                color: "var(--maison-text-primary)",
              }}
            >
              <Globe
                className="mr-1.5 h-3.5 w-3.5"
                style={{ color: "var(--maison-brass)" }}
              />
              Google
            </Button>
          )}

          {/* View toggle */}
          <div
            className="flex h-8 items-center gap-0.5 rounded-lg border p-0.5"
            style={{
              borderColor: "var(--maison-border)",
              background: "var(--maison-page)",
            }}
          >
            <button
              onClick={() => setViewMode("kanban")}
              className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition ${
                viewMode === "kanban"
                  ? "shadow-sm"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{
                background:
                  viewMode === "kanban" ? "var(--maison-card)" : "transparent",
                color:
                  viewMode === "kanban"
                    ? "var(--maison-text-primary)"
                    : "var(--maison-text-secondary)",
              }}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Kanban
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition ${
                viewMode === "calendar"
                  ? "shadow-sm"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{
                background:
                  viewMode === "calendar"
                    ? "var(--maison-card)"
                    : "transparent",
                color:
                  viewMode === "calendar"
                    ? "var(--maison-text-primary)"
                    : "var(--maison-text-secondary)",
              }}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Calendrier
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition ${
                viewMode === "list"
                  ? "shadow-sm"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{
                background:
                  viewMode === "list" ? "var(--maison-card)" : "transparent",
                color:
                  viewMode === "list"
                    ? "var(--maison-text-primary)"
                    : "var(--maison-text-secondary)",
              }}
            >
              <List className="h-3.5 w-3.5" />
              Liste
            </button>
          </div>

          {/* Add column (kanban only) */}
          {viewMode === "kanban" && (
            <Button
              type="button"
              onClick={() => openCategoryModal(null)}
              variant="outline"
              className="h-8 gap-1.5 text-xs shadow-sm"
              style={{
                background: "var(--maison-card)",
                borderColor: "var(--maison-border)",
                borderStyle: "dashed",
                color: "var(--maison-text-primary)",
              }}
            >
              <Plus
                className="h-3.5 w-3.5"
                style={{ color: "var(--maison-brass)" }}
              />
              Colonne
            </Button>
          )}

          {/* New lead CTA */}
          <Button
            id="btn-add-lead"
            onClick={() => {
              resetForm();
              setIsAddOpen(true);
            }}
            className="h-8 gap-1.5 text-xs shadow-sm transition-colors"
            style={{
              background: "var(--maison-brass)",
              color: "var(--maison-brass-text)",
              border: "none",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--maison-brass-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--maison-brass)";
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Nouveau lead
          </Button>
        </div>
      </div>

      {overdueLeads.length > 0 && (
        <section className="flex items-center gap-3 rounded-xl px-3 py-2 shadow-sm border border-red-200 bg-red-50">
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-red-700">
            <AlertCircle className="h-3.5 w-3.5 text-red-600" />
            Retards ({overdueLeads.length})
          </div>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
            {overdueLeads.slice(0, 8).map((lead) => {
              const noteLines = (lead.notes ?? "").split("\n");
              const companyName =
                lead.companyName ??
                noteLines
                  .find((l) => l.startsWith("Entreprise:"))
                  ?.replace("Entreprise:", "")
                  .trim() ??
                lead.topic;
              const contactName = noteLines
                .find((l) => l.startsWith("Contact:"))
                ?.replace("Contact:", "")
                .trim();

              return (
                <button
                  type="button"
                  key={lead.id}
                  onClick={() => openEditModal(lead)}
                  className="flex min-w-[190px] max-w-[240px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:opacity-80 border border-red-200 bg-red-100/60"
                >
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-red-500" />
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-red-950">
                      {companyName}
                    </p>
                    <p className="truncate text-[10px] text-red-800">
                      {contactName ? `${contactName} · ` : ""}
                      {formatLeadDateForDisplay(lead.leadDate)}
                    </p>
                  </div>
                </button>
              );
            })}
            {overdueLeads.length > 8 ? (
              <span className="flex items-center rounded-md px-2 text-[11px] font-medium text-red-700">
                +{overdueLeads.length - 8}
              </span>
            ) : null}
          </div>
        </section>
      )}

      {/* Kanban Board View */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
          <span className="ml-3 text-sm text-stone-500">
            Chargement des leads…
          </span>
        </div>
      ) : viewMode === "kanban" ? (
        <div>
          <div ref={kanbanContainerRef} className="overflow-x-auto pb-4">
            <div
              className="grid min-w-max grid-flow-col auto-cols-[minmax(220px,80vw)] items-start gap-2 md:min-w-0 md:grid-flow-row md:auto-cols-auto md:grid-cols-[repeat(var(--kanban-columns),minmax(0,1fr))]"
              style={
                {
                  "--kanban-columns": categories.length,
                } as React.CSSProperties
              }
            >
              {categories.map((col, index) => {
                const colLeads = leads.filter(
                  (l) => l.status === col.statusKey,
                );
                const style = getCategoryStyle(col.color);
                return (
                  <div
                    key={col.id}
                    className="group/col flex min-w-0 flex-col gap-2 rounded-xl p-2 transition-colors"
                    style={{
                      background: "var(--maison-page)",
                      border: "1px solid var(--maison-border-subtle)",
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const leadId = e.dataTransfer.getData("text/plain");
                      if (leadId) {
                        const leadToMove = leads.find((l) => l.id === leadId);
                        if (leadToMove && leadToMove.status !== col.statusKey) {
                          handleMoveStatus(leadToMove, col.statusKey);
                        }
                      }
                    }}
                  >
                    {/* Column header */}
                    <div className="flex items-center gap-1.5 px-1 py-0.5">
                      <span
                        className={`h-2 w-2 flex-none rounded-full ${style.dot}`}
                      />
                      <span
                        className="flex-1 truncate text-[11px] font-bold uppercase tracking-wider"
                        style={{ color: "var(--maison-text-secondary)" }}
                      >
                        {col.name}
                      </span>
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          background: "var(--maison-card)",
                          color: "var(--maison-text-muted)",
                          border: "1px solid var(--maison-border)",
                        }}
                      >
                        {colLeads.length}
                      </span>

                      {/* Column order & settings actions */}
                      <div className="ml-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/col:opacity-100">
                        {index > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              handleMoveCategoryOrder(col.id, "left")
                            }
                            title="Déplacer à gauche"
                            className="p-0.5 rounded hover:bg-stone-200/60 text-stone-500 dark:hover:bg-stone-800"
                          >
                            <ChevronLeft className="h-3 w-3" />
                          </button>
                        )}
                        {index < categories.length - 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              handleMoveCategoryOrder(col.id, "right")
                            }
                            title="Déplacer à droite"
                            className="p-0.5 rounded hover:bg-stone-200/60 text-stone-500 dark:hover:bg-stone-800"
                          >
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openCategoryModal(col)}
                          title="Modifier"
                          className="p-0.5 rounded hover:bg-stone-200/60 text-stone-500 dark:hover:bg-stone-800"
                        >
                          <Edit3 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {/* Lead cards */}
                    <div className="flex max-h-[calc(100dvh-14rem)] min-h-[calc(100dvh-14rem)] flex-col gap-2 overflow-y-auto pr-0.5">
                      {colLeads.length === 0 && (
                        <div
                          className="rounded-lg border border-dashed p-4 text-center text-xs"
                          style={{
                            borderColor: "var(--maison-border)",
                            color: "var(--maison-text-muted)",
                            background: "transparent",
                          }}
                        >
                          Vide
                        </div>
                      )}
                      {colLeads.map((lead) => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          nextStatus={getNextStatus(lead.status)}
                          onSelect={() => openEditModal(lead)}
                          onMove={handleMoveStatus}
                          onDelete={handleDelete}
                          onGenerateDraft={handleGenerateDraft}
                          onDriveClick={handleCreateDriveFolder}
                        />
                      ))}
                    </div>

                    {/* Add button */}
                    <button
                      type="button"
                      onClick={() => {
                        resetForm();
                        setFormStatus(col.statusKey);
                        setIsAddOpen(true);
                      }}
                      className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-1.5 text-[11px] font-medium transition"
                      style={{
                        borderColor: "var(--maison-border)",
                        color: "var(--maison-text-muted)",
                      }}
                      onMouseEnter={(e) => {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "var(--maison-card)";
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "var(--maison-text-secondary)";
                      }}
                      onMouseLeave={(e) => {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "transparent";
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "var(--maison-text-muted)";
                      }}
                    >
                      <Plus className="h-3 w-3" />+ Ajouter
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : viewMode === "list" ? (
        <div
          className="rounded-xl border shadow-sm"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          {/* Filters Bar */}
          <div
            className="flex flex-wrap items-center gap-4 border-b p-4"
            style={{
              background: "var(--maison-page)",
              borderColor: "var(--maison-border)",
              borderTopLeftRadius: "12px",
              borderTopRightRadius: "12px",
            }}
          >
            <div className="flex flex-col gap-1">
              <label
                htmlFor="filter-status"
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                Filtre par Statut
              </label>
              <select
                id="filter-status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="h-9 min-w-[180px] rounded-lg border px-3 py-1.5 text-xs shadow-sm focus:outline-none transition"
                style={{
                  background: "var(--maison-card)",
                  borderColor: "var(--maison-border)",
                  color: "var(--maison-text-primary)",
                }}
              >
                <option value="all">Tous les statuts</option>
                {categories.map((c) => (
                  <option key={c.statusKey} value={c.statusKey}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="filter-company"
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                Filtre par Entreprise
              </label>
              <select
                id="filter-company"
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
                className="h-9 min-w-[180px] rounded-lg border px-3 py-1.5 text-xs shadow-sm focus:outline-none transition"
                style={{
                  background: "var(--maison-card)",
                  borderColor: "var(--maison-border)",
                  color: "var(--maison-text-primary)",
                }}
              >
                <option value="all">Toutes les entreprises</option>
                {uniqueCompanies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {(filterStatus !== "all" || filterCompany !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setFilterStatus("all");
                  setFilterCompany("all");
                }}
                className="mt-4 text-xs font-semibold hover:underline transition"
                style={{ color: "var(--maison-brass)" }}
              >
                Réinitialiser les filtres
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-left text-sm">
              <thead
                className="border-b"
                style={{
                  borderColor: "var(--maison-border)",
                  background: "var(--maison-page)",
                }}
              >
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    Sujet
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    Entreprise / Contact
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    Statut
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    Prochaine Action
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    Créé le
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody
                className="divide-y divide-stone-200"
                style={{ borderColor: "var(--maison-border)" }}
              >
                {filteredLeads.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-10 text-center text-sm text-stone-400"
                    >
                      Aucun lead correspondant aux critères.
                    </td>
                  </tr>
                ) : (
                  filteredLeads.map((lead) => {
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
                            onClick={() => openEditModal(lead)}
                            className="hover:text-teal-700 hover:underline text-left font-semibold text-stone-900 block"
                          >
                            {lead.topic}
                          </button>
                          {/* Tags & Assignee row */}
                          <div className="flex flex-wrap gap-1.5 items-center mt-1.5">
                            {lead.assignedToName && (
                              <span className="inline-flex items-center gap-1 rounded bg-stone-100 dark:bg-stone-900 px-1 py-0.5 text-[9px] font-bold text-stone-600 dark:text-stone-300 border border-stone-200 dark:border-stone-800">
                                <span className="flex h-3 w-3 items-center justify-center rounded-full bg-teal-650 text-[8px] font-bold text-white">
                                  {lead.assignedToName.charAt(0).toUpperCase()}
                                </span>
                                {lead.assignedToName}
                              </span>
                            )}
                            {lead.tags &&
                              lead.tags.map((t) => (
                                <span
                                  key={t.id}
                                  className="inline-flex items-center rounded-full border px-1.5 py-0.1 text-[9px] font-bold bg-stone-50 border-stone-200 text-stone-600"
                                >
                                  {t.name}
                                </span>
                              ))}
                          </div>
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
                              {lead.leadDate && (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200/50">
                                  <Calendar className="h-3 w-3" />
                                  {formatLeadDateForDisplay(lead.leadDate)}
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
                              onClick={() => openEditModal(lead)}
                              variant="outline"
                              className="h-8 px-2.5 text-xs border-stone-200 text-stone-700 hover:bg-stone-50"
                            >
                              Détails
                            </Button>
                            <Button
                              onClick={() => handleDelete(lead.id)}
                              variant="ghost"
                              className="h-8 px-2 text-red-650 hover:bg-red-50 hover:text-red-700"
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
          const year = calendarDate.getFullYear();
          const month = calendarDate.getMonth();
          const firstDay = new Date(year, month, 1).getDay();
          const daysInMonth = new Date(year, month + 1, 0).getDate();

          // Group leads by date string 'YYYY-MM-DD'
          const leadsByDate: Record<string, CrmLeadSummary[]> = {};
          leads.forEach((lead) => {
            const d = lead.leadDate
              ? new Date(lead.leadDate)
              : new Date(lead.createdAt);
            if (isNaN(d.getTime())) return;
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
          const dateKey = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, "0")}-${String(calendarDate.getDate()).padStart(2, "0")}`;
          const dayLeads = leadsByDate[dateKey] || [];
          const isCurrentDay =
            calendarDate.getDate() === today.getDate() &&
            calendarDate.getMonth() === today.getMonth() &&
            calendarDate.getFullYear() === today.getFullYear();

          return (
            <div
              className="rounded-xl border overflow-hidden shadow-sm"
              style={{
                background: "var(--maison-card)",
                borderColor: "var(--maison-border)",
              }}
            >
              {/* Calendar control header */}
              <div
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 border-b"
                style={{
                  background: "var(--maison-page)",
                  borderColor: "var(--maison-border)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handlePrevCalendar}
                      className="p-1.5 rounded-lg border transition shadow-sm opacity-80 hover:opacity-100"
                      style={{
                        background: "var(--maison-card)",
                        borderColor: "var(--maison-border)",
                        color: "var(--maison-text-secondary)",
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleNextCalendar}
                      className="p-1.5 rounded-lg border transition shadow-sm opacity-80 hover:opacity-100"
                      style={{
                        background: "var(--maison-card)",
                        borderColor: "var(--maison-border)",
                        color: "var(--maison-text-secondary)",
                      }}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="text-left">
                    <h3
                      className="text-sm font-bold capitalize"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {getPeriodLabel()}
                    </h3>
                    <p
                      className="text-xs"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      {leads.length} lead{leads.length !== 1 ? "s" : ""} au
                      total
                    </p>
                  </div>
                </div>

                {/* Calendar View Mode Selectors */}
                <div
                  className="flex items-center gap-1 rounded-lg border p-1 self-start sm:self-auto"
                  style={{
                    borderColor: "var(--maison-border)",
                    background: "var(--maison-page)",
                  }}
                >
                  <button
                    onClick={() => setCalendarMode("month")}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                      calendarMode === "month"
                        ? "shadow-sm border"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    style={{
                      background:
                        calendarMode === "month"
                          ? "var(--maison-card)"
                          : "transparent",
                      borderColor:
                        calendarMode === "month"
                          ? "var(--maison-border)"
                          : "transparent",
                      color:
                        calendarMode === "month"
                          ? "var(--maison-text-primary)"
                          : "var(--maison-text-secondary)",
                    }}
                  >
                    Mois
                  </button>
                  <button
                    onClick={() => setCalendarMode("week")}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                      calendarMode === "week"
                        ? "shadow-sm border"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    style={{
                      background:
                        calendarMode === "week"
                          ? "var(--maison-card)"
                          : "transparent",
                      borderColor:
                        calendarMode === "week"
                          ? "var(--maison-border)"
                          : "transparent",
                      color:
                        calendarMode === "week"
                          ? "var(--maison-text-primary)"
                          : "var(--maison-text-secondary)",
                    }}
                  >
                    Semaine
                  </button>
                  <button
                    onClick={() => setCalendarMode("day")}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                      calendarMode === "day"
                        ? "shadow-sm border"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    style={{
                      background:
                        calendarMode === "day"
                          ? "var(--maison-card)"
                          : "transparent",
                      borderColor:
                        calendarMode === "day"
                          ? "var(--maison-border)"
                          : "transparent",
                      color:
                        calendarMode === "day"
                          ? "var(--maison-text-primary)"
                          : "var(--maison-text-secondary)",
                    }}
                  >
                    Jour
                  </button>
                </div>
              </div>

              {/* View Rendering based on calendarMode */}
              {calendarMode === "month" && (
                <>
                  {/* Day Labels */}
                  <div
                    className="grid grid-cols-7 border-b"
                    style={{
                      borderColor: "var(--maison-border)",
                      background: "var(--maison-page)",
                    }}
                  >
                    {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(
                      (d) => (
                        <div
                          key={d}
                          className="py-2 text-center text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: "var(--maison-text-secondary)" }}
                        >
                          {d}
                        </div>
                      ),
                    )}
                  </div>

                  {/* Calendar Grid */}
                  <div className="grid grid-cols-7">
                    {Array.from({ length: paddedStart }).map((_, i) => (
                      <div
                        key={`empty-${i}`}
                        className="min-h-[100px] border-b border-r"
                        style={{ borderColor: "var(--maison-border)" }}
                      />
                    ))}

                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(
                      (day) => {
                        const cellDateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                        const cellLeads = leadsByDate[cellDateKey] || [];
                        const isCurrentDay = isToday(day);

                        return (
                          <div
                            key={day}
                            className={`min-h-[120px] border-b border-r p-2 flex flex-col gap-1.5 transition-colors group relative`}
                            style={{
                              borderColor: "var(--maison-border)",
                              background: isCurrentDay
                                ? "var(--maison-page)"
                                : "transparent",
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isCurrentDay ? "shadow-sm font-extrabold" : ""}`}
                                style={{
                                  background: isCurrentDay
                                    ? "var(--maison-brass)"
                                    : "transparent",
                                  color: isCurrentDay
                                    ? "var(--maison-brass-text)"
                                    : "var(--maison-text-secondary)",
                                }}
                              >
                                {day}
                              </span>
                              <button
                                onClick={() => handleCellClick(cellDateKey)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-stone-100 text-stone-400 hover:text-teal-700 transition"
                                title="Ajouter un lead pour ce jour"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <div className="flex flex-col gap-1 overflow-hidden flex-1">
                              {cellLeads.slice(0, 3).map((lead) => (
                                <button
                                  key={lead.id}
                                  onClick={() => openEditModal(lead)}
                                  className={`w-full text-left px-1.5 py-0.5 rounded border text-[9px] font-semibold truncate cursor-pointer hover:opacity-85 transition flex items-center gap-1 ${
                                    getColumnConfig(lead.status).color
                                  }`}
                                >
                                  <span
                                    className={`h-1 w-1 rounded-full shrink-0 ${getColumnConfig(lead.status).dot}`}
                                  />
                                  <span className="truncate">{lead.topic}</span>
                                </button>
                              ))}
                              {cellLeads.length > 3 && (
                                <span className="text-[9px] text-stone-400 pl-1 font-medium">
                                  +{cellLeads.length - 3} autres
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </>
              )}

              {calendarMode === "week" && (
                <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-stone-200">
                  {getDaysOfWeek(calendarDate).map((day) => {
                    const cellDateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
                    const cellLeads = leadsByDate[cellDateKey] || [];
                    const isCurrentDay =
                      day.getDate() === today.getDate() &&
                      day.getMonth() === today.getMonth() &&
                      day.getFullYear() === today.getFullYear();

                    const formattedDayLabel = day.toLocaleDateString("fr-FR", {
                      weekday: "short",
                    });
                    const formattedDateLabel = day.getDate();

                    return (
                      <div
                        key={cellDateKey}
                        className={`min-h-[300px] p-3 flex flex-col gap-3 transition-colors group ${
                          isCurrentDay
                            ? "bg-teal-50/20"
                            : "hover:bg-stone-50/20"
                        }`}
                      >
                        {/* Day header */}
                        <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider ${isCurrentDay ? "text-teal-700" : "text-stone-400"}`}
                            >
                              {formattedDayLabel}
                            </span>
                            <span
                              className={`text-xs font-extrabold h-5 w-5 flex items-center justify-center rounded-full ${
                                isCurrentDay
                                  ? "bg-teal-700 text-white shadow-xs font-extrabold"
                                  : "text-stone-700"
                              }`}
                            >
                              {formattedDateLabel}
                            </span>
                          </div>
                          <button
                            onClick={() => handleCellClick(cellDateKey)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-stone-100 text-stone-400 hover:text-teal-700 transition"
                            title="Ajouter un lead pour ce jour"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Leads list */}
                        <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
                          {cellLeads.length === 0 ? (
                            <button
                              onClick={() => handleCellClick(cellDateKey)}
                              className="flex flex-col items-center justify-center border border-dashed border-stone-200 rounded-lg p-3 text-center text-[10px] text-stone-400 hover:border-teal-300 hover:bg-teal-50/5 transition-all flex-1 min-h-[120px]"
                            >
                              <Plus className="h-3.5 w-3.5 mb-1 text-stone-300" />
                              <span>Planifier</span>
                            </button>
                          ) : (
                            cellLeads.map((lead) => (
                              <button
                                key={lead.id}
                                onClick={() => openEditModal(lead)}
                                className={`w-full text-left p-2 rounded-lg border text-xs font-semibold shadow-xs hover:shadow transition-all flex flex-col gap-1 ${
                                  getColumnConfig(lead.status).color
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${getColumnConfig(lead.status).dot}`}
                                  />
                                  <span className="truncate font-bold text-[10px]">
                                    {lead.topic}
                                  </span>
                                </div>
                                {lead.notes && (
                                  <p className="text-[9px] text-stone-500 font-normal line-clamp-2 pl-3">
                                    {lead.notes
                                      .replace(/Entreprise:[^\n]*\n?/, "")
                                      .replace(/Contact:[^\n]*\n?/, "")
                                      .replace(/Fonction:[^\n]*\n?/, "")
                                      .replace(/LinkedIn:[^\n]*\n?/, "")
                                      .replace(/Email:[^\n]*\n?/, "")
                                      .replace(/Tél:[^\n]*\n?/, "")
                                      .trim()}
                                  </p>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {calendarMode === "day" && (
                <div
                  className="p-5 sm:p-6 transition-all"
                  style={{ background: "var(--maison-card)" }}
                >
                  <div
                    className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4 mb-6"
                    style={{ borderColor: "var(--maison-border)" }}
                  >
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h4
                          className="text-lg font-bold capitalize tracking-tight"
                          style={{
                            fontFamily: "var(--font-playfair), Georgia, serif",
                            color: "var(--maison-text-primary)",
                          }}
                        >
                          {calendarDate.toLocaleDateString("fr-FR", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                        </h4>
                        {isCurrentDay && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold shadow-2xs"
                            style={{
                              background: "rgba(176,141,79,0.12)",
                              borderColor: "var(--maison-border)",
                              color: "var(--maison-brass)",
                            }}
                          >
                            ● Aujourd&apos;hui
                          </span>
                        )}
                      </div>
                      <p
                        className="text-xs mt-1"
                        style={{ color: "var(--maison-text-secondary)" }}
                      >
                        {dayLeads.length} lead{dayLeads.length !== 1 ? "s" : ""}{" "}
                        planifié{dayLeads.length !== 1 ? "s" : ""} pour ce jour
                      </p>
                    </div>
                    <Button
                      onClick={() => handleCellClick(dateKey)}
                      className="text-xs font-semibold uppercase tracking-wider gap-1.5 self-start md:self-auto rounded-xl shadow-2xs"
                      style={{
                        background: "var(--maison-sidebar)",
                        color: "#FFFFFF",
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      Planifier un lead
                    </Button>
                  </div>

                  {dayLeads.length === 0 ? (
                    <div
                      className="flex flex-col items-center justify-center py-12 sm:py-16 border border-dashed rounded-xl transition-all"
                      style={{
                        background: "rgba(176,141,79,0.03)",
                        borderColor: "var(--maison-border)",
                      }}
                    >
                      <div
                        className="rounded-xl p-3.5 mb-3 shadow-2xs flex items-center justify-center"
                        style={{
                          background: "rgba(176,141,79,0.12)",
                          color: "var(--maison-brass)",
                        }}
                      >
                        <CalendarDays className="h-7 w-7" aria-hidden="true" />
                      </div>
                      <h5
                        className="text-base font-semibold tracking-tight"
                        style={{
                          fontFamily: "var(--font-playfair), Georgia, serif",
                          color: "var(--maison-text-primary)",
                        }}
                      >
                        Aucun lead planifié
                      </h5>
                      <p
                        className="text-xs mt-1.5 max-w-sm text-center leading-relaxed"
                        style={{ color: "var(--maison-text-secondary)" }}
                      >
                        Il n&apos;y a aucun lead ou rappel d&apos;action
                        enregistré pour cette date. Cliquer ci-dessous pour en
                        ajouter un.
                      </p>
                      <button
                        onClick={() => handleCellClick(dateKey)}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition hover:opacity-85 shadow-2xs"
                        style={{
                          background: "var(--maison-page)",
                          borderColor: "var(--maison-border)",
                          color: "var(--maison-text-primary)",
                        }}
                        type="button"
                      >
                        <Plus
                          className="h-3.5 w-3.5"
                          style={{ color: "var(--maison-brass)" }}
                        />
                        Nouveau lead
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {dayLeads.map((lead) => {
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
                          <div
                            key={lead.id}
                            className={`rounded-xl border p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between ${
                              colConfig.color
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-3">
                                <button
                                  onClick={() => openEditModal(lead)}
                                  className="text-left font-bold tracking-tight hover:underline transition leading-snug text-sm"
                                  style={{
                                    fontFamily:
                                      "var(--font-playfair), Georgia, serif",
                                    color: "var(--maison-text-primary)",
                                  }}
                                >
                                  {lead.topic}
                                </button>
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-bold shrink-0 ${colConfig.color}`}
                                >
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${colConfig.dot}`}
                                  />
                                  {colConfig.label}
                                </span>
                              </div>

                              <div className="mt-3 space-y-1.5 text-xs">
                                {companyName && (
                                  <div
                                    className="flex items-center gap-1.5 font-medium"
                                    style={{
                                      color: "var(--maison-text-primary)",
                                    }}
                                  >
                                    <Building2 className="h-3.5 w-3.5 text-stone-400" />
                                    {companyName}
                                  </div>
                                )}
                                {contactName && (
                                  <div
                                    className="flex items-center gap-1.5"
                                    style={{
                                      color: "var(--maison-text-secondary)",
                                    }}
                                  >
                                    <User className="h-3.5 w-3.5 text-stone-400" />
                                    {contactName}
                                  </div>
                                )}
                              </div>

                              {lead.notes && (
                                <div
                                  className="mt-3 text-xs p-2.5 rounded-lg border line-clamp-3 leading-relaxed"
                                  style={{
                                    background: "var(--maison-page)",
                                    borderColor: "var(--maison-border)",
                                    color: "var(--maison-text-secondary)",
                                  }}
                                >
                                  {lead.notes
                                    .replace(/Entreprise:[^\n]*\n?/, "")
                                    .replace(/Contact:[^\n]*\n?/, "")
                                    .replace(/Fonction:[^\n]*\n?/, "")
                                    .replace(/LinkedIn:[^\n]*\n?/, "")
                                    .replace(/Email:[^\n]*\n?/, "")
                                    .replace(/Tél:[^\n]*\n?/, "")
                                    .trim()}
                                </div>
                              )}
                            </div>

                            <div className="mt-4 flex items-center justify-between border-t border-stone-200/50 pt-3">
                              <div className="flex items-center gap-1.5">
                                <Button
                                  onClick={() => openEditModal(lead)}
                                  variant="outline"
                                  className="h-8 px-2.5 text-[11px] border-stone-200 bg-white hover:bg-stone-50 text-stone-700"
                                >
                                  Détails
                                </Button>
                                <Button
                                  onClick={() => handleGenerateDraft(lead)}
                                  variant="outline"
                                  className="h-8 px-2 text-[11px] border-teal-200 hover:bg-teal-50 text-teal-700"
                                >
                                  <Bot className="h-3.5 w-3.5" />
                                  Relance IA
                                </Button>
                              </div>
                              <Button
                                onClick={() => handleDelete(lead.id)}
                                variant="ghost"
                                className="h-8 px-2 text-red-650 hover:bg-red-50 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Legend footer */}
              <div className="px-5 py-3 border-t border-stone-200 bg-stone-50/40 flex flex-wrap gap-4">
                {categories.map((col) => {
                  const style = getCategoryStyle(col.color);
                  return (
                    <div key={col.id} className="flex items-center gap-1.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${style.dot}`}
                      />
                      <span className="text-[10px] text-stone-600 font-semibold uppercase tracking-wider">
                        {col.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()
      )}

      {/* ── Add Lead Modal ────────────────────────────── */}
      {isAddOpen && (
        <Modal title="Nouveau lead" onClose={closeAddModal}>
          <form onSubmit={handleCreateLead} className="space-y-5">
            {/* Natural language intake */}
            <div className="rounded-lg border border-teal-200 bg-teal-50 dark:border-teal-900/50 dark:bg-teal-950/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-800 dark:text-teal-400">
                <Bot className="h-4 w-4" />
                Saisie en langage naturel (IA Groq)
              </div>
              <p className="mt-1 text-xs text-teal-600 dark:text-teal-500">
                Décrivez le lead et l&apos;IA remplira le formulaire
                automatiquement.
              </p>
              <textarea
                id="natural-text-input"
                className="mt-3 w-full rounded-md border border-teal-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 dark:border-teal-900/50 dark:bg-stone-950/50 dark:text-stone-200"
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
              {isRecording ? (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50/50 dark:border-red-950/10 dark:bg-red-950/20 px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* Blinking red dot */}
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500"></span>
                    </span>

                    {/* Timer */}
                    <span className="text-xs font-semibold text-red-600 dark:text-red-400 font-mono">
                      {formatTime(recordingTime)}
                    </span>

                    {/* Sound waves visualizer */}
                    <div className="flex items-end gap-0.5 h-4 px-1.5">
                      <span
                        className="w-0.5 h-2 bg-red-500 rounded-full animate-bounce"
                        style={{
                          animationDelay: "0.1s",
                          animationDuration: "0.6s",
                        }}
                      />
                      <span
                        className="w-0.5 h-4 bg-red-500 rounded-full animate-bounce"
                        style={{
                          animationDelay: "0.2s",
                          animationDuration: "0.6s",
                        }}
                      />
                      <span
                        className="w-0.5 h-3 bg-red-500 rounded-full animate-bounce"
                        style={{
                          animationDelay: "0.3s",
                          animationDuration: "0.6s",
                        }}
                      />
                      <span
                        className="w-0.5 h-5 bg-red-500 rounded-full animate-bounce"
                        style={{
                          animationDelay: "0.4s",
                          animationDuration: "0.6s",
                        }}
                      />
                      <span
                        className="w-0.5 h-2 bg-red-500 rounded-full animate-bounce"
                        style={{
                          animationDelay: "0.5s",
                          animationDuration: "0.6s",
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Discard button */}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2 text-stone-500 hover:text-red-600 hover:bg-red-50 dark:text-stone-400 dark:hover:text-red-400 dark:hover:bg-red-950/20"
                      onClick={cancelRecording}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Annuler
                    </Button>

                    {/* Done button */}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-3 bg-red-600 hover:bg-red-700 text-white border-transparent flex items-center justify-center"
                      onClick={stopRecording}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Terminer
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 text-xs px-2.5 border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-900/80 dark:text-teal-400 dark:hover:bg-teal-950/50"
                    disabled={isExtracting || !naturalText.trim()}
                    onClick={() => handleExtract()}
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{" "}
                        Extraction…
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Extraire
                        avec l&apos;IA
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 text-xs px-2.5 border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-900/80 dark:text-teal-400 dark:hover:bg-teal-950/50"
                    disabled={isExtracting || isTranscribing}
                    onClick={startRecording}
                  >
                    {isTranscribing ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Transcription...
                      </>
                    ) : (
                      <>
                        <Mic className="mr-1.5 h-3.5 w-3.5" />
                        Enregistrer ma voix
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Manual form */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Projet *" id="form-topic">
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

              <FormField label="Fonction / Poste" id="form-job-title">
                <input
                  id="form-job-title"
                  className={inputCls}
                  placeholder="Ex: CEO, CTO, Manager commercial..."
                  value={formJobTitle}
                  onChange={(e) => setFormJobTitle(e.target.value)}
                />
              </FormField>

              <FormField label="LinkedIn" id="form-linkedin">
                <div className="flex gap-2">
                  <input
                    id="form-linkedin"
                    className={inputCls + " flex-1"}
                    placeholder="https://linkedin.com/in/profil ou laisser vide"
                    value={formLinkedin}
                    onChange={(e) => setFormLinkedin(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    title="Rechercher automatiquement sur LinkedIn"
                    className="h-10 shrink-0 gap-1.5 text-xs border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                    onClick={() => {
                      const name = formContactName.trim();
                      const company = formCompanyName.trim();
                      if (!name && !company) return;
                      const q = encodeURIComponent(
                        `site:linkedin.com/in ${name}${company ? ` "${company}"` : ""}`,
                      );
                      window.open(
                        `https://www.google.com/search?q=${q}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-4 w-4 text-blue-600"
                    >
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                    Rechercher
                  </Button>
                </div>
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

              <FormField label="Date planifiée" id="form-lead-date">
                <input
                  id="form-lead-date"
                  className={inputCls}
                  type="datetime-local"
                  value={formLeadDate}
                  onChange={(e) => setFormLeadDate(e.target.value)}
                />
              </FormField>
            </div>

            <div className="space-y-1.5 relative">
              <label className="text-sm font-medium text-stone-850 block">
                Statut Initial
              </label>
              {(() => {
                const currentCfg = getColumnConfig(formStatus);
                return (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setIsFormStatusDropdownOpen(!isFormStatusDropdownOpen)
                      }
                      className="flex h-10 w-full items-center justify-between rounded-md border border-stone-305 bg-white px-3 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50 transition focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${currentCfg.dot}`}
                        />
                        <span
                          className={`px-2 py-0.5 rounded border text-[11px] font-bold ${currentCfg.color}`}
                        >
                          {currentCfg.label}
                        </span>
                      </span>
                      <span className="text-xs text-stone-400 font-bold">
                        {isFormStatusDropdownOpen ? "▲" : "▼"}
                      </span>
                    </button>

                    {isFormStatusDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setIsFormStatusDropdownOpen(false)}
                        />
                        <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-stone-200 bg-white py-1 shadow-lg animate-fadeIn">
                          {categories.map((c) => {
                            const style = getCategoryStyle(c.color);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setFormStatus(c.statusKey);
                                  setIsFormStatusDropdownOpen(false);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-stone-50 transition-colors"
                              >
                                <span
                                  className={`h-2 w-2 rounded-full ${style.dot}`}
                                />
                                <span
                                  className={`px-2 py-0.5 rounded border text-[11px] font-bold ${style.color}`}
                                >
                                  {c.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Assignee select field */}
            <FormField label="Assigné à" id="form-assignee">
              <select
                id="form-assignee"
                className={inputCls}
                value={formAssignee}
                onChange={(e) => setFormAssignee(e.target.value)}
              >
                <option value="">Non assigné</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </FormField>

            {/* Tags Associated section */}
            <div className="space-y-2 border-t border-stone-100 pt-3">
              <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider block">
                Tags associés
              </span>

              {/* Selected Tags list */}
              <div className="flex flex-wrap gap-1.5 min-h-[36px] rounded-lg border border-stone-200 bg-stone-50/50 p-2">
                {formTags.length === 0 ? (
                  <span className="text-xs text-stone-400 italic">
                    Aucun tag sélectionné
                  </span>
                ) : (
                  formTags.map((tagId) => {
                    const t = tags.find((x) => x.id === tagId);
                    if (!t) return null;
                    return (
                      <button
                        key={tagId}
                        type="button"
                        onClick={() =>
                          setFormTags((prev) => prev.filter((x) => x !== tagId))
                        }
                        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-stone-100 border-stone-200 text-stone-755 hover:bg-red-50 hover:text-red-755 hover:border-red-200 transition"
                        title="Retirer"
                      >
                        {t.name}
                        <X className="h-3 w-3" />
                      </button>
                    );
                  })
                )}
              </div>

              {/* Available tags list */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-stone-550">Ajouter un tag :</span>
                {tags
                  .filter((t) => !formTags.includes(t.id))
                  .map((t) => (
                    <div
                      key={t.id}
                      className="inline-flex items-center rounded-full border bg-stone-50 border-stone-200 text-[11px] font-semibold pl-2 pr-1.5 py-0.5 hover:border-teal-500 hover:bg-teal-50 transition gap-1"
                    >
                      <button
                        type="button"
                        onClick={() => setFormTags((prev) => [...prev, t.id])}
                        className="hover:text-teal-700 font-bold"
                      >
                        + {t.name}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const newName = window.prompt(
                            "Modifier le nom du tag :",
                            t.name,
                          );
                          if (newName === null) return;
                          if (!newName.trim()) return;
                          const res = await updateTagAction(
                            t.id,
                            newName.trim(),
                            t.color,
                          );
                          if (res.success && res.tag) {
                            setTags((prev) =>
                              prev
                                .map((x) => (x.id === t.id ? res.tag! : x))
                                .sort((a, b) => a.name.localeCompare(b.name)),
                            );
                            toast.success("Tag modifié !");
                          } else {
                            toast.error(res.error ?? "Erreur");
                          }
                        }}
                        className="text-stone-400 hover:text-blue-650 font-bold text-[10px]"
                        title="Modifier"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const confirm = window.confirm(
                            `Supprimer le tag "${t.name}" ?`,
                          );
                          if (!confirm) return;
                          const res = await deleteTagAction(t.id);
                          if (res.success) {
                            setTags((prev) =>
                              prev.filter((x) => x.id !== t.id),
                            );
                            setFormTags((prev) =>
                              prev.filter((x) => x !== t.id),
                            );
                            setEditTags((prev) =>
                              prev.filter((x) => x !== t.id),
                            );
                            toast.success("Tag supprimé !");
                          } else {
                            toast.error(res.error ?? "Erreur");
                          }
                        }}
                        className="text-stone-400 hover:text-red-650 font-bold text-[10px]"
                        title="Supprimer"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                {/* Create tag button inline */}
                {!isCreatingTag ? (
                  <button
                    type="button"
                    onClick={() => setIsCreatingTag(true)}
                    className="text-xs text-teal-600 hover:text-teal-800 font-semibold hover:underline"
                  >
                    + Créer un nouveau tag
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white p-1">
                    <input
                      placeholder="Nom du tag"
                      className="h-7 w-28 rounded border border-stone-305 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-teal-650"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                    />
                    <select
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="h-7 rounded border border-stone-305 px-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-650"
                    >
                      <option value="teal">Sarcelle</option>
                      <option value="blue">Bleu</option>
                      <option value="yellow">Jaune</option>
                      <option value="indigo">Indigo</option>
                      <option value="emerald">Émeraude</option>
                      <option value="red">Rouge</option>
                      <option value="purple">Violet</option>
                      <option value="pink">Rose</option>
                      <option value="orange">Orange</option>
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!newTagName.trim()) return;
                        const res = await createTagAction(
                          newTagName,
                          newTagColor,
                        );
                        if (res.success && res.tag) {
                          setTags((prev) =>
                            [...prev, res.tag!].sort((a, b) =>
                              a.name.localeCompare(b.name),
                            ),
                          );
                          setFormTags((prev) => [...prev, res.tag!.id]);
                          setNewTagName("");
                          setIsCreatingTag(false);
                          toast.success("Tag créé !");
                        } else {
                          toast.error(res.error ?? "Erreur");
                        }
                      }}
                      className="rounded bg-teal-600 px-2 py-1 text-xs font-bold text-white hover:bg-teal-700"
                    >
                      Créer
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingTag(false)}
                      className="text-stone-400 hover:text-stone-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
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
              <Button type="button" variant="outline" onClick={closeAddModal}>
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
          <form onSubmit={handleUpdateLead} className="space-y-5">
            {/* Manual edit form fields */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Projet *" id="edit-topic">
                <input
                  id="edit-topic"
                  className={inputCls}
                  required
                  placeholder="Ex: Intégration IA CRM"
                  value={editTopic}
                  onChange={(e) => setEditTopic(e.target.value)}
                />
              </FormField>

              <FormField label="Entreprise (Optionnel)" id="edit-company">
                <input
                  id="edit-company"
                  className={inputCls}
                  placeholder="Ex: Atlas Telecom"
                  value={editCompanyName}
                  onChange={(e) => setEditCompanyName(e.target.value)}
                />
              </FormField>

              <FormField label="Contact principal" id="edit-contact">
                <input
                  id="edit-contact"
                  className={inputCls}
                  placeholder="Ex: Karim Saidi"
                  value={editContactName}
                  onChange={(e) => setEditContactName(e.target.value)}
                />
              </FormField>

              <FormField label="Fonction / Poste" id="edit-job-title">
                <input
                  id="edit-job-title"
                  className={inputCls}
                  placeholder="Ex: CEO, CTO, Manager commercial..."
                  value={editJobTitle}
                  onChange={(e) => setEditJobTitle(e.target.value)}
                />
              </FormField>

              <FormField label="LinkedIn" id="edit-linkedin">
                <div className="flex gap-2">
                  <input
                    id="edit-linkedin"
                    className={inputCls + " flex-1"}
                    placeholder="https://linkedin.com/in/profil ou laisser vide"
                    value={editLinkedin}
                    onChange={(e) => setEditLinkedin(e.target.value)}
                  />
                  {editLinkedin && (
                    <a
                      href={
                        editLinkedin.startsWith("http")
                          ? editLinkedin
                          : `https://${editLinkedin}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 text-xs font-medium text-blue-700 transition hover:bg-blue-50"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-4 w-4"
                      >
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                      </svg>
                      Ouvrir
                    </a>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    title="Rechercher automatiquement sur LinkedIn"
                    className="h-10 shrink-0 gap-1.5 text-xs border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                    onClick={() => {
                      const name = editContactName.trim();
                      const company = editCompanyName.trim();
                      if (!name && !company) return;
                      const q = encodeURIComponent(
                        `site:linkedin.com/in ${name}${company ? ` "${company}"` : ""}`,
                      );
                      window.open(
                        `https://www.google.com/search?q=${q}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-4 w-4 text-blue-600"
                    >
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                    Rechercher
                  </Button>
                </div>
              </FormField>

              <FormField label="Email" id="edit-email">
                <input
                  id="edit-email"
                  className={inputCls}
                  type="email"
                  placeholder="Ex: karim@atlas.ma"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </FormField>

              <FormField label="Téléphone" id="edit-phone">
                <input
                  id="edit-phone"
                  className={inputCls}
                  placeholder="Ex: +212 600000000"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </FormField>

              <FormField label="Source du lead" id="edit-source">
                <input
                  id="edit-source"
                  className={inputCls}
                  placeholder="Ex: LinkedIn, Salon..."
                  value={editSource}
                  onChange={(e) => setEditSource(e.target.value)}
                />
              </FormField>

              <FormField label="Action suivante" id="edit-next-action">
                <input
                  id="edit-next-action"
                  className={inputCls}
                  placeholder="Ex: Envoyer la proposition commerciale"
                  value={editNextAction}
                  onChange={(e) => setEditNextAction(e.target.value)}
                />
              </FormField>

              <FormField label="Date planifiée" id="edit-lead-date">
                <input
                  id="edit-lead-date"
                  className={inputCls}
                  type="datetime-local"
                  value={editLeadDate}
                  onChange={(e) => setEditLeadDate(e.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Notes & Contexte" id="edit-notes">
              <textarea
                id="edit-notes"
                className="flex w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-950 placeholder:text-stone-400 focus:border-teal-750 focus:outline-none focus:ring-2"
                rows={3}
                placeholder="Détails du premier contact, besoins identifiés..."
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </FormField>

            {/* Edit Assignee field */}
            <FormField label="Assigné à" id="edit-assignee">
              <select
                id="edit-assignee"
                className={inputCls}
                value={editAssignee}
                onChange={(e) => setEditAssignee(e.target.value)}
              >
                <option value="">Non assigné</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </FormField>

            {/* Edit Tags field */}
            <div className="space-y-2 border-t border-stone-100 pt-3">
              <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider block">
                Tags associés
              </span>

              {/* Selected Tags list */}
              <div className="flex flex-wrap gap-1.5 min-h-[36px] rounded-lg border border-stone-200 bg-stone-50/50 p-2">
                {editTags.length === 0 ? (
                  <span className="text-xs text-stone-400 italic">
                    Aucun tag sélectionné
                  </span>
                ) : (
                  editTags.map((tagId) => {
                    const t = tags.find((x) => x.id === tagId);
                    if (!t) return null;
                    return (
                      <button
                        key={tagId}
                        type="button"
                        onClick={() =>
                          setEditTags((prev) => prev.filter((x) => x !== tagId))
                        }
                        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-stone-100 border-stone-200 text-stone-755 hover:bg-red-50 hover:text-red-755 hover:border-red-200 transition"
                        title="Retirer"
                      >
                        {t.name}
                        <X className="h-3 w-3" />
                      </button>
                    );
                  })
                )}
              </div>

              {/* Available tags dropdown / list to select from */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-stone-500">Ajouter un tag :</span>
                {tags
                  .filter((t) => !editTags.includes(t.id))
                  .map((t) => (
                    <div
                      key={t.id}
                      className="inline-flex items-center rounded-full border bg-stone-50 border-stone-200 text-[11px] font-semibold pl-2 pr-1.5 py-0.5 hover:border-teal-500 hover:bg-teal-50 transition gap-1"
                    >
                      <button
                        type="button"
                        onClick={() => setEditTags((prev) => [...prev, t.id])}
                        className="hover:text-teal-700 font-bold"
                      >
                        + {t.name}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const newName = window.prompt(
                            "Modifier le nom du tag :",
                            t.name,
                          );
                          if (newName === null) return;
                          if (!newName.trim()) return;
                          const res = await updateTagAction(
                            t.id,
                            newName.trim(),
                            t.color,
                          );
                          if (res.success && res.tag) {
                            setTags((prev) =>
                              prev
                                .map((x) => (x.id === t.id ? res.tag! : x))
                                .sort((a, b) => a.name.localeCompare(b.name)),
                            );
                            toast.success("Tag modifié !");
                          } else {
                            toast.error(res.error ?? "Erreur");
                          }
                        }}
                        className="text-stone-400 hover:text-blue-650 font-bold text-[10px]"
                        title="Modifier"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const confirm = window.confirm(
                            `Supprimer le tag "${t.name}" ?`,
                          );
                          if (!confirm) return;
                          const res = await deleteTagAction(t.id);
                          if (res.success) {
                            setTags((prev) =>
                              prev.filter((x) => x.id !== t.id),
                            );
                            setFormTags((prev) =>
                              prev.filter((x) => x !== t.id),
                            );
                            setEditTags((prev) =>
                              prev.filter((x) => x !== t.id),
                            );
                            toast.success("Tag supprimé !");
                          } else {
                            toast.error(res.error ?? "Erreur");
                          }
                        }}
                        className="text-stone-400 hover:text-red-650 font-bold text-[10px]"
                        title="Supprimer"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                {/* Create tag button inline */}
                {!isCreatingTag ? (
                  <button
                    type="button"
                    onClick={() => setIsCreatingTag(true)}
                    className="text-xs text-teal-600 hover:text-teal-800 font-semibold hover:underline"
                  >
                    + Créer un nouveau tag
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white p-1">
                    <input
                      placeholder="Nom du tag"
                      className="h-7 w-28 rounded border border-stone-305 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-teal-650"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                    />
                    <select
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="h-7 rounded border border-stone-305 px-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-650"
                    >
                      <option value="teal">Sarcelle</option>
                      <option value="blue">Bleu</option>
                      <option value="yellow">Jaune</option>
                      <option value="indigo">Indigo</option>
                      <option value="emerald">Émeraude</option>
                      <option value="red">Rouge</option>
                      <option value="purple">Violet</option>
                      <option value="pink">Rose</option>
                      <option value="orange">Orange</option>
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!newTagName.trim()) return;
                        const res = await createTagAction(
                          newTagName,
                          newTagColor,
                        );
                        if (res.success && res.tag) {
                          setTags((prev) =>
                            [...prev, res.tag!].sort((a, b) =>
                              a.name.localeCompare(b.name),
                            ),
                          );
                          setEditTags((prev) => [...prev, res.tag!.id]);
                          setNewTagName("");
                          setIsCreatingTag(false);
                          toast.success("Tag créé !");
                        } else {
                          toast.error(res.error ?? "Erreur");
                        }
                      }}
                      className="rounded bg-teal-600 px-2 py-1 text-xs font-bold text-white hover:bg-teal-700"
                    >
                      Créer
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingTag(false)}
                      className="text-stone-400 hover:text-stone-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {modalError && (
              <p className="text-xs text-red-650 font-semibold">{modalError}</p>
            )}

            {/* Quick automation actions & Status workflow selector inside editing */}
            <div className="pt-4 border-t border-stone-200 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                {/* Status selector */}
                <div className="space-y-1.5 relative">
                  <label className="text-xs font-semibold uppercase tracking-wider text-stone-500 block">
                    Statut du lead
                  </label>
                  {(() => {
                    const currentCfg = getColumnConfig(editStatus);
                    return (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setIsStatusDropdownOpen(!isStatusDropdownOpen)
                          }
                          className="flex h-9 w-full items-center justify-between rounded-md border border-stone-205 bg-white px-3 py-1.5 text-xs font-semibold text-stone-850 hover:bg-stone-50 transition focus:outline-none"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${currentCfg.dot}`}
                            />
                            <span
                              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${currentCfg.color}`}
                            >
                              {currentCfg.label}
                            </span>
                          </span>
                          <span className="text-[10px] text-stone-400 font-bold">
                            {isStatusDropdownOpen ? "▲" : "▼"}
                          </span>
                        </button>

                        {isStatusDropdownOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setIsStatusDropdownOpen(false)}
                            />
                            <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-stone-200 bg-white py-1 shadow-lg animate-fadeIn">
                              {categories.map((c) => {
                                const style = getCategoryStyle(c.color);
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      setEditStatus(c.statusKey);
                                      setIsStatusDropdownOpen(false);
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-stone-50 transition-colors"
                                  >
                                    <span
                                      className={`h-2 w-2 rounded-full ${style.dot}`}
                                    />
                                    <span
                                      className={`px-2 py-0.5 rounded border text-[10px] font-bold ${style.color}`}
                                    >
                                      {c.name}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Automation trigger action buttons */}
                <div className="flex flex-col justify-end">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() => handleGenerateDraft(selectedLead)}
                      disabled={isGenerating}
                      variant="outline"
                      className="text-xs border-teal-200 text-teal-700 hover:bg-teal-50 h-9"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          IA...
                        </>
                      ) : (
                        <>
                          <Bot className="mr-1.5 h-3.5 w-3.5" /> Relance IA
                        </>
                      )}
                    </Button>

                    {driveLink ? (
                      <Button
                        type="button"
                        onClick={() => window.open(driveLink, "_blank")}
                        variant="outline"
                        className="text-xs border-emerald-255 bg-emerald-50/20 text-emerald-750 hover:bg-emerald-50 h-9"
                      >
                        <FolderPlus className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                        Drive ↗
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={() => handleCreateDriveFolder(selectedLead)}
                        disabled={isCreatingFolder}
                        variant="outline"
                        className="text-xs border-teal-200 text-teal-700 hover:bg-teal-50 h-9"
                      >
                        {isCreatingFolder ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Dossier...
                          </>
                        ) : (
                          <>
                            <FolderPlus className="mr-1.5 h-3.5 w-3.5 text-teal-600" />
                            Drive Client
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {calendarLink ? (
                <Button
                  type="button"
                  onClick={() => window.open(calendarLink, "_blank")}
                  variant="outline"
                  className="w-full text-xs border-amber-250 bg-amber-50/20 text-amber-750 hover:bg-amber-50 h-9"
                >
                  <Calendar className="mr-2 h-4 w-4 text-amber-600" />
                  Voir dans Google Calendar ↗
                </Button>
              ) : selectedLead.leadDate ? (
                <Button
                  type="button"
                  onClick={() => handleSyncCalendar(selectedLead)}
                  disabled={isSyncingCalendar}
                  variant="outline"
                  className="w-full text-xs border-amber-200 bg-amber-50/15 text-amber-800 hover:bg-amber-50 h-9"
                >
                  {isSyncingCalendar ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-amber-600" />
                      Synchronisation...
                    </>
                  ) : (
                    <>
                      <Calendar className="mr-2 h-4 w-4 text-amber-600" />
                      Ajouter à Google Calendar
                    </>
                  )}
                </Button>
              ) : null}
            </div>

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

                const emailSubject = `NAIA-os - Relance concernant votre projet : ${selectedLead.topic}`;
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
                          Ouvrir dans Gmail ↗
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
                          Ouvrir dans WhatsApp ↗
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

            {/* Notes Management Section */}
            <div className="pt-4 border-t border-stone-200 space-y-4">
              <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-stone-400" />
                Notes de suivi commercial
              </h4>

              {/* Notes List */}
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {isNotesLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-teal-650" />
                  </div>
                ) : notes.length === 0 ? (
                  <p className="text-xs text-stone-500 italic py-2 text-center">
                    Aucune note de suivi enregistrée pour le moment.
                  </p>
                ) : (
                  notes.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-lg border border-stone-150 bg-stone-50/40 p-2.5 space-y-1.5 hover:border-stone-250 transition-colors"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-stone-750 flex items-center gap-1">
                            <span className="h-4 w-4 rounded-full bg-stone-200 flex items-center justify-center text-[9px]">
                              {(n.createdByName || "M").charAt(0).toUpperCase()}
                            </span>
                            {n.createdByName || "Membre"}
                          </span>
                          {n.assignedToName && (
                            <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-1 py-0.5 text-[9px] font-bold text-teal-700 border border-teal-200/50">
                              Assigné à : {n.assignedToName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-stone-450 font-medium">
                          <span className="flex flex-col items-end text-[9px] text-stone-500 leading-tight">
                            <span>
                              {new Date(n.createdAt).toLocaleString("fr-FR", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </span>
                            {n.updatedAt &&
                              new Date(n.updatedAt).getTime() -
                                new Date(n.createdAt).getTime() >
                                1000 && (
                                <span className="text-amber-600 font-semibold text-[8px]">
                                  Modifié le :{" "}
                                  {new Date(n.updatedAt).toLocaleString(
                                    "fr-FR",
                                    {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    },
                                  )}
                                </span>
                              )}
                          </span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteId(n.id);
                                setEditingNoteText(n.content);
                                setEditingNoteAssigneeId(
                                  n.assignedToProfileId ?? "",
                                );
                              }}
                              className="text-teal-650 hover:underline font-bold"
                            >
                              Modifier
                            </button>
                            <span>•</span>
                            <button
                              type="button"
                              onClick={async () => {
                                const confirm = window.confirm(
                                  "Supprimer cette note ?",
                                );
                                if (!confirm) return;
                                const res = await deleteLeadNoteAction(n.id);
                                if (res.success) {
                                  setNotes((prev) =>
                                    prev.filter((x) => x.id !== n.id),
                                  );
                                  toast.success("Note supprimée.");
                                } else {
                                  toast.error(res.error ?? "Erreur");
                                }
                              }}
                              className="text-red-650 hover:underline font-bold"
                            >
                              Supprimer
                            </button>
                          </div>
                        </div>
                      </div>

                      {editingNoteId === n.id ? (
                        <div className="space-y-2 mt-1">
                          <textarea
                            className="w-full rounded border border-stone-300 bg-white p-2 text-xs text-stone-900 focus:border-teal-750 focus:outline-none"
                            rows={2}
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value)}
                          />
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-stone-500 font-medium">
                              Assigner à :
                            </label>
                            <select
                              className="rounded border border-stone-300 bg-white p-1 text-[11px] text-stone-850 focus:border-teal-750 focus:outline-none"
                              value={editingNoteAssigneeId}
                              onChange={(e) =>
                                setEditingNoteAssigneeId(e.target.value)
                              }
                            >
                              <option value="">Non assigné</option>
                              {teamMembers.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.fullName}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-7 text-[10px] px-2 text-stone-500 hover:bg-stone-100"
                              onClick={() => setEditingNoteId(null)}
                            >
                              Annuler
                            </Button>
                            <Button
                              type="button"
                              className="h-7 text-[10px] px-2.5 bg-teal-600 hover:bg-teal-700 text-white"
                              onClick={async () => {
                                if (!editingNoteText.trim()) return;
                                const res = await updateLeadNoteAction(
                                  n.id,
                                  editingNoteText,
                                  editingNoteAssigneeId || undefined,
                                );
                                if (res.success && res.note) {
                                  setNotes((prev) =>
                                    prev.map((x) =>
                                      x.id === n.id ? res.note! : x,
                                    ),
                                  );
                                  setEditingNoteId(null);
                                  toast.success("Note modifiée.");
                                } else {
                                  toast.error(res.error ?? "Erreur");
                                }
                              }}
                            >
                              Enregistrer
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-stone-800 whitespace-pre-wrap leading-relaxed">
                          {n.content}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Add Note form */}
              <div className="space-y-2">
                <textarea
                  className="w-full rounded-lg border border-stone-300 bg-white p-2.5 text-xs text-stone-900 placeholder:text-stone-400 focus:border-teal-750 focus:outline-none focus:ring-1 focus:ring-teal-750"
                  rows={2}
                  placeholder="Saisir une nouvelle note commerciale (partagée avec l'équipe)..."
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] text-stone-500 font-medium">
                      Assigner à :
                    </label>
                    <select
                      className="rounded border border-stone-300 bg-white px-1.5 py-1 text-[11px] text-stone-850 focus:border-teal-750 focus:outline-none"
                      value={newNoteAssigneeId}
                      onChange={(e) => setNewNoteAssigneeId(e.target.value)}
                    >
                      <option value="">Non assigné</option>
                      {teamMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="button"
                    disabled={!newNoteText.trim()}
                    className="h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1.5"
                    onClick={async () => {
                      if (!newNoteText.trim()) return;
                      const res = await createLeadNoteAction(
                        selectedLead.id,
                        newNoteText,
                        newNoteAssigneeId || undefined,
                      );
                      if (res.success && res.note) {
                        setNotes((prev) => [...prev, res.note!]);
                        setNewNoteText("");
                        setNewNoteAssigneeId("");
                        toast.success("Note ajoutée !");
                      } else {
                        toast.error(res.error ?? "Erreur");
                      }
                    }}
                  >
                    Ajouter la note
                  </Button>
                </div>
              </div>
            </div>

            {/* History tracking details */}
            <div className="pt-2.5 pb-1 border-t border-stone-150 flex items-center justify-between text-[11px] text-stone-500 italic">
              <span>
                Dernière mise à jour par :{" "}
                <strong>{selectedLead.lastUpdatedByName || "Inconnu"}</strong>
              </span>
              <span>
                Le :{" "}
                {selectedLead.lastUpdatedAt
                  ? new Date(selectedLead.lastUpdatedAt).toLocaleString(
                      "fr-FR",
                      { dateStyle: "short", timeStyle: "short" },
                    )
                  : "Non renseigné"}
              </span>
            </div>

            {/* Bottom Actions aligned with Creation modal */}
            <div className="flex justify-between items-center border-t border-stone-100 pt-4">
              <Button
                type="button"
                variant="ghost"
                className="gap-2 text-red-650 hover:bg-red-50 hover:text-red-700 h-9 px-3"
                onClick={() => handleDelete(selectedLead.id)}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer ce lead
              </Button>

              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedLead(null)}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? "Enregistrement…"
                    : "Enregistrer les modifications"}
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Category Management Modal ────────────────────────── */}
      {isCategoryModalOpen && (
        <Modal
          title={editingCategory ? "Modifier la colonne" : "Nouvelle colonne"}
          onClose={() => setIsCategoryModalOpen(false)}
        >
          <form onSubmit={handleSaveCategory} className="space-y-5">
            <FormField label="Nom de la colonne *" id="category-name">
              <input
                id="category-name"
                className={inputCls}
                required
                placeholder="Ex: Négociation"
                value={categoryFormName}
                onChange={(e) => setCategoryFormName(e.target.value)}
              />
            </FormField>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-stone-850 block">
                Couleur de la colonne
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.keys(categoryColors).map((colorKey) => {
                  const style = categoryColors[colorKey];
                  const isSelected = categoryFormColor === colorKey;
                  return (
                    <button
                      key={colorKey}
                      type="button"
                      onClick={() => setCategoryFormColor(colorKey)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                        style.color
                      } ${
                        isSelected
                          ? "ring-2 ring-teal-600 scale-105"
                          : "opacity-60 hover:opacity-100"
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                      <span className="capitalize">{colorKey}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between items-center border-t border-stone-100 pt-4">
              {editingCategory ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2 text-red-650 hover:bg-red-50 hover:text-red-700 h-9 px-3"
                  onClick={handleDeleteCategory}
                  disabled={isCategorySubmitting}
                >
                  <Trash2 className="h-4 w-4" />
                  Supprimer
                </Button>
              ) : (
                <div />
              )}

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCategoryModalOpen(false)}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={isCategorySubmitting}>
                  {isCategorySubmitting ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

const inputCls =
  "h-10 w-full rounded-xl border border-[#e0d8c8] bg-[#fcfbf7] px-3.5 text-xs font-medium text-[#14293c] outline-none transition-all placeholder:text-[#5c6b7a] focus:border-[#b08d4f] focus:ring-2 focus:ring-[rgba(176,141,79,0.2)] shadow-2xs";

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
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-wider block"
        style={{ color: "var(--maison-text-primary)" }}
      >
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
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md transition-all"
      style={{ background: "rgba(20, 41, 60, 0.55)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl transition-all"
        style={{
          background: "#f6f3ec",
          borderColor: "#e0d8c8",
          boxShadow: "0 25px 60px rgba(20, 41, 60, 0.28)",
        }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4 backdrop-blur-md"
          style={{
            background: "#f6f3ec",
            borderColor: "#e0d8c8",
          }}
        >
          <h2
            className="text-xl font-bold tracking-tight truncate"
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              color: "#14293c",
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border transition hover:opacity-80 shadow-2xs"
            style={{
              background: "#fcfbf7",
              borderColor: "#e0d8c8",
              color: "#14293c",
            }}
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
  onDriveClick,
}: {
  lead: CrmLeadSummary;
  nextStatus: CrmLeadStatus | null;
  onSelect: () => void;
  onMove: (lead: CrmLeadSummary, status: CrmLeadStatus) => void;
  onDelete: (id: string) => void;
  onGenerateDraft: (lead: CrmLeadSummary) => void;
  onDriveClick: (lead: CrmLeadSummary) => void;
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
  const companyName =
    lead.companyName?.trim() ||
    companyLine ||
    inferCompanyNameFromTopic(lead.topic) ||
    "Sans entreprise";
  const contactName =
    lead.contactName?.trim() || contactLine || "Contact à qualifier";
  const showProject = React.useMemo(() => {
    const t = lead.topic.trim();
    if (!t) return false;
    const lowerCompany = companyName.toLowerCase();
    return t.toLowerCase() !== lowerCompany;
  }, [lead.topic, companyName]);

  const displayTopic = React.useMemo(() => {
    let t = lead.topic.trim();
    if (!t) return "";
    const lowerCompany = companyName.toLowerCase();
    if (t.toLowerCase().startsWith(lowerCompany)) {
      t = t
        .slice(companyName.length)
        .replace(/^[\s\-\·\–\—\:]+/, "")
        .trim();
    }
    if (t) {
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    return "";
  }, [lead.topic, companyName]);

  const isOverdue = React.useMemo(() => {
    if (!lead.leadDate) return false;
    if (lead.status === "won" || lead.status === "dead-end") return false;
    try {
      return new Date(lead.leadDate) < new Date();
    } catch {
      return false;
    }
  }, [lead.leadDate, lead.status]);

  // Determine status color indicator
  const statusColorMap: Record<CrmLeadStatus, string> = {
    "lead-to-contact": "bg-blue-500",
    contacted: "bg-stone-400",
    "to-follow-up": "bg-amber-500",
    "meeting-booked": "bg-indigo-500",
    "proposal-sent": "bg-emerald-500",
    won: "bg-teal-500",
    "dead-end": "bg-red-400",
  };
  const statusDotBg = statusColorMap[lead.status] || "bg-stone-300";

  const statusLabels: Record<CrmLeadStatus, string> = {
    "lead-to-contact": "CONTACT",
    contacted: "CONTACTÉ",
    "to-follow-up": "RELANCE",
    "meeting-booked": "MEETING",
    "proposal-sent": "PROPALE",
    won: "GAGNÉ",
    "dead-end": "DEAD END",
  };

  const tagBarColors: Record<string, string> = {
    blue: "bg-blue-500",
    gray: "bg-stone-400",
    yellow: "bg-amber-500",
    indigo: "bg-indigo-500",
    emerald: "bg-emerald-500",
    teal: "bg-teal-500",
    red: "bg-red-500",
    purple: "bg-purple-500",
    pink: "bg-pink-500",
    orange: "bg-orange-500",
    sky: "bg-sky-500",
    lime: "bg-lime-500",
    rose: "bg-rose-500",
  };

  // Compute a stable avatar index from company name (palette has 8 entries)
  const avatarIdx =
    companyName.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 8;

  // 2-letter initials from contact name (e.g. "Hicham El Alami" → "HE")
  const avatarInitials = React.useMemo(() => {
    const words = contactName.split(" ").filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return contactName.charAt(0).toUpperCase();
  }, [contactName]);

  // Source display — plain text, no badge
  const sourceDisplay = lead.source?.trim()?.toUpperCase();

  // Compact date: "18 juil." — manual format avoids fr-FR locale dot-separator bugs
  const cardDateDisplay = React.useMemo(() => {
    if (!lead.leadDate) return "";
    try {
      const d = new Date(lead.leadDate);
      if (isNaN(d.getTime())) return "";
      const months = [
        "janv.",
        "févr.",
        "mars",
        "avr.",
        "mai",
        "juin",
        "juil.",
        "août",
        "sept.",
        "oct.",
        "nov.",
        "déc.",
      ];
      return `${d.getDate()} ${months[d.getMonth()]}`;
    } catch {
      return "";
    }
  }, [lead.leadDate]);

  // Dark avatar colors matching the reference (dark circle, light initials)
  const darkAvatarPalette = [
    { bg: "#1e3a5f", text: "#ffffff" }, // dark navy
    { bg: "#2d4a3e", text: "#ffffff" }, // dark green
    { bg: "#4a2d5f", text: "#ffffff" }, // dark purple
    { bg: "#5f3a2d", text: "#ffffff" }, // dark brown
    { bg: "#2d3a5f", text: "#ffffff" }, // dark indigo
    { bg: "#5f4a2d", text: "#ffffff" }, // dark amber
    { bg: "#2d5f4a", text: "#ffffff" }, // dark teal
    { bg: "#5f2d3a", text: "#ffffff" }, // dark rose
  ];
  const darkAvatarColor = darkAvatarPalette[avatarIdx];

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", lead.id);
      }}
      style={{
        background: "var(--maison-card)",
        border: "1px solid var(--maison-border)",
        borderRadius: "8px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
      }}
      className="group relative cursor-grab transition-shadow hover:shadow-md active:cursor-grabbing"
    >
      {/* Hover action buttons */}
      <div
        className="absolute right-2 top-2 z-10 hidden items-center gap-0.5 rounded-lg p-0.5 group-hover:flex"
        style={{
          background: "var(--maison-card)",
          border: "1px solid var(--maison-border)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        {nextStatus && (
          <button
            type="button"
            title="Avancer"
            onClick={(e) => {
              e.stopPropagation();
              onMove(lead, nextStatus);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
          >
            <MoveRight className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          title={lead.driveFolderUrl ? "Ouvrir Drive" : "Créer dossier Drive"}
          onClick={(e) => {
            e.stopPropagation();
            onDriveClick(lead);
          }}
          className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
            lead.driveFolderUrl
              ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
              : "text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-700"
          }`}
        >
          <FolderOpen className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Relance IA"
          onClick={(e) => {
            e.stopPropagation();
            onGenerateDraft(lead);
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
        >
          <Bot className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Supprimer"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(lead.id);
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Clickable card body */}
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <div className="p-2.5 pb-1.5">
          {/* Tag bars */}
          {lead.tags && lead.tags.length > 0 && (
            <div className="mb-2 flex gap-1">
              {lead.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  aria-label={tag.name}
                  className={`h-[3px] flex-1 rounded-full ${tagBarColors[tag.color] ?? "bg-stone-400"}`}
                />
              ))}
            </div>
          )}

          {/* Company name + Dark avatar (2-letter initials) */}
          <div className="flex items-start justify-between gap-1.5">
            <p
              className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-snug"
              style={{ color: "var(--maison-text-primary)" }}
            >
              {companyName}
            </p>
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none"
              style={{
                background: darkAvatarColor.bg,
                color: darkAvatarColor.text,
              }}
            >
              {avatarInitials}
            </span>
          </div>

          {/* Topic / subtitle — 1 line truncated */}
          {showProject && (
            <p
              className="mt-0.5 min-w-0 truncate text-[10px]"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              {displayTopic}
            </p>
          )}

          {/* Next action — 1 line max for compact uniform height */}
          {lead.nextAction && (
            <p
              className="mt-1 flex items-start gap-1 text-[10px] leading-snug"
              style={{ color: "var(--maison-text-muted)" }}
            >
              <span className="mt-px shrink-0">→</span>
              <span className="min-w-0 flex-1 truncate">{lead.nextAction}</span>
            </p>
          )}
        </div>

        {/* Footer — date + source, no separator */}
        <div className="flex flex-wrap items-center justify-between gap-1 px-2.5 pb-2.5 pt-1">
          {/* Date: compact "18 juil." with calendar icon; red if overdue */}
          {cardDateDisplay ? (
            <span
              className="inline-flex min-w-0 max-w-full items-center gap-1 text-[9px]"
              style={{
                color: isOverdue ? "#dc2626" : "var(--maison-text-muted)",
              }}
            >
              <Calendar className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{cardDateDisplay}</span>
              {isOverdue && (
                <span className="shrink-0 font-semibold text-red-600">
                  · retard
                </span>
              )}
            </span>
          ) : (
            <span />
          )}

          {/* Source: plain uppercase text, no box */}
          {sourceDisplay ? (
            <span
              className="min-w-0 truncate text-[9px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--maison-text-muted)" }}
            >
              {sourceDisplay}
            </span>
          ) : (
            <div className="flex min-w-0 shrink-0 items-center gap-1">
              <span
                className={`h-1 w-1 shrink-0 rounded-full ${statusDotBg}`}
              />
              <span
                className="min-w-0 truncate text-[9px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--maison-text-muted)" }}
              >
                {statusLabels[lead.status] || lead.status}
              </span>
            </div>
          )}
        </div>
      </button>
    </article>
  );
}
