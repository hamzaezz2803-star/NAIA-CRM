"use client";

import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import {
  Clock,
  Calendar,
  User,
  Building2,
  Phone,
  Users,
  Search,
  ArrowRight,
  AlertCircle,
  Tag,
  Briefcase,
  MessageSquare,
  Loader2,
  ExternalLink,
} from "lucide-react";
import {
  fetchLeadsForTodoAction,
  fetchTagsAction,
  fetchTeamMembersAction,
  updateLeadAction,
} from "@/features/crm/actions";
import type { LeadTodoCard } from "@/features/crm/actions";
import type { CrmTag } from "@/features/crm/contracts";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type KanbanColumn = "todo" | "in-progress" | "done";

const STATUS_TO_COLUMN: Record<string, KanbanColumn> = {
  "lead-to-contact": "todo",
  contacted: "todo",
  "to-follow-up": "todo",
  "meeting-booked": "in-progress",
  "proposal-sent": "in-progress",
  won: "done",
  "dead-end": "done",
};

// The representative status to assign when dropping into a column
const COLUMN_TO_STATUS: Record<KanbanColumn, string> = {
  todo: "to-follow-up",
  "in-progress": "meeting-booked",
  done: "won",
};

const STATUS_LABELS: Record<string, string> = {
  "lead-to-contact": "A contacter",
  contacted: "Contacte",
  "to-follow-up": "A relancer",
  "meeting-booked": "Meeting fixe",
  "proposal-sent": "Propale envoyee",
  won: "Gagne",
  "dead-end": "Clos",
};

const STATUS_COLORS: Record<string, string> = {
  "lead-to-contact": "bg-stone-100 text-stone-700 border-stone-200",
  contacted: "bg-blue-50 text-blue-700 border-blue-200",
  "to-follow-up": "bg-amber-50 text-amber-700 border-amber-200",
  "meeting-booked": "bg-purple-50 text-purple-700 border-purple-200",
  "proposal-sent": "bg-teal-50 text-teal-700 border-teal-200",
  won: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "dead-end": "bg-stone-100 text-stone-500 border-stone-200",
};

function detectActionType(nextAction?: string) {
  if (!nextAction)
    return {
      label: "Suivi",
      icon: <ArrowRight className="h-3 w-3" />,
      color: "text-stone-500",
    };
  const lower = nextAction.toLowerCase();
  if (
    lower.includes("meeting") ||
    lower.includes("reunion") ||
    lower.includes("reunion")
  )
    return {
      label: "Meeting",
      icon: <Users className="h-3 w-3" />,
      color: "text-purple-600",
    };
  if (
    lower.includes("appel") ||
    lower.includes("call") ||
    lower.includes("telephone")
  )
    return {
      label: "Appel",
      icon: <Phone className="h-3 w-3" />,
      color: "text-blue-600",
    };
  if (lower.includes("relance"))
    return {
      label: "Relance",
      icon: <Clock className="h-3 w-3" />,
      color: "text-amber-600",
    };
  if (
    lower.includes("propale") ||
    lower.includes("proposition") ||
    lower.includes("offre")
  )
    return {
      label: "Proposition",
      icon: <Briefcase className="h-3 w-3" />,
      color: "text-teal-600",
    };
  if (
    lower.includes("message") ||
    lower.includes("email") ||
    lower.includes("mail")
  )
    return {
      label: "Message",
      icon: <MessageSquare className="h-3 w-3" />,
      color: "text-indigo-600",
    };
  return {
    label: "Suivi",
    icon: <ArrowRight className="h-3 w-3" />,
    color: "text-stone-500",
  };
}

const tagColorMap: Record<string, string> = {
  stone: "bg-stone-100 text-stone-700 border-stone-200",
  red: "bg-red-50 text-red-700 border-red-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
  lime: "bg-lime-50 text-lime-700 border-lime-200",
  green: "bg-green-50 text-green-700 border-green-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  fuchsia: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  pink: "bg-pink-50 text-pink-700 border-pink-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
};

function getDueDateInfo(dateStr?: string) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(date);
  due.setHours(0, 0, 0, 0);
  const diff = due.getTime() - now.getTime();
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  const formatted = date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
  if (days < 0)
    return {
      label: `En retard - ${formatted}`,
      cls: "text-red-700 bg-red-50 border-red-200",
      isOverdue: true,
    };
  if (days === 0)
    return {
      label: `Aujourd'hui - ${formatted}`,
      cls: "text-amber-700 bg-amber-50 border-amber-200",
      isOverdue: false,
    };
  if (days <= 3)
    return {
      label: `J+${days} - ${formatted}`,
      cls: "text-orange-600 bg-orange-50 border-orange-200",
      isOverdue: false,
    };
  return {
    label: formatted,
    cls: "text-stone-500 bg-stone-50 border-stone-200",
    isOverdue: false,
  };
}

function LeadCard({
  lead,
  onClick,
  onDragStart,
  isDragging,
}: {
  lead: LeadTodoCard;
  onClick: () => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  isDragging: boolean;
}) {
  const dueInfo = getDueDateInfo(lead.leadDate);
  const actionType = detectActionType(lead.nextAction);
  const initials = lead.assignedToName
    ? lead.assignedToName
        .split(" ")
        .map((n) => n.charAt(0).toUpperCase())
        .join("")
        .substring(0, 2)
    : null;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onClick={onClick}
      className={`group relative rounded-xl border bg-white p-4 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing select-none ${
        isDragging
          ? "opacity-40 scale-95 rotate-1 shadow-lg border-teal-300"
          : dueInfo?.isOverdue
            ? "border-red-200 hover:border-red-300"
            : "border-stone-200 hover:border-stone-300"
      }`}
    >
      {dueInfo?.isOverdue && (
        <div className="flex items-center gap-1.5 mb-2.5 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>ECHEANCE DEPASSEE</span>
        </div>
      )}
      <h4 className="font-bold text-stone-900 text-sm leading-snug group-hover:text-teal-700 transition-colors pr-5">
        {lead.topic}
      </h4>
      <div className="mt-2 space-y-1">
        {lead.companyName && (
          <div className="flex items-center gap-1.5 text-xs text-stone-600">
            <Building2 className="h-3 w-3 text-stone-400 shrink-0" />
            <span className="truncate font-medium">{lead.companyName}</span>
          </div>
        )}
        {lead.contactName && (
          <div className="flex items-center gap-1.5 text-xs text-stone-500">
            <User className="h-3 w-3 text-stone-400 shrink-0" />
            <span className="truncate">{lead.contactName}</span>
            {lead.contactJobTitle && (
              <span className="text-stone-400 truncate">
                - {lead.contactJobTitle}
              </span>
            )}
          </div>
        )}
      </div>
      {lead.nextAction && (
        <div
          className={`mt-2.5 flex items-center gap-1 text-[11px] font-semibold ${actionType.color}`}
        >
          {actionType.icon}
          <span className="truncate">{lead.nextAction}</span>
        </div>
      )}
      {lead.tags && lead.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {lead.tags.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
                tagColorMap[t.color] ??
                "bg-stone-100 text-stone-600 border-stone-200"
              }`}
            >
              <Tag className="h-2 w-2" />
              {t.name}
            </span>
          ))}
          {lead.tags.length > 3 && (
            <span className="text-[9px] text-stone-400 font-semibold">
              +{lead.tags.length - 3}
            </span>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
            STATUS_COLORS[lead.status] ??
            "bg-stone-100 text-stone-600 border-stone-200"
          }`}
        >
          {STATUS_LABELS[lead.status] ?? lead.status}
        </span>
        <div className="flex items-center gap-2">
          {dueInfo && (
            <span
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${dueInfo.cls}`}
            >
              <Calendar className="h-2.5 w-2.5" />
              {dueInfo.label}
            </span>
          )}
          {initials ? (
            <div
              title={`Assigne a ${lead.assignedToName}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 border border-teal-200 text-[10px] font-bold text-teal-700"
            >
              {initials}
            </div>
          ) : (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-stone-300 text-stone-400">
              <User className="h-3 w-3" />
            </div>
          )}
        </div>
      </div>
      <div className="absolute right-3 top-3.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 bg-stone-50 border border-stone-200 rounded text-stone-400 hover:text-teal-600">
        <ExternalLink className="h-3.5 w-3.5" />
      </div>
    </div>
  );
}

const COLUMNS: { key: KanbanColumn; label: string; dot: string }[] = [
  { key: "todo", label: "A faire", dot: "bg-stone-500" },
  { key: "in-progress", label: "En cours", dot: "bg-amber-500" },
  { key: "done", label: "Termine", dot: "bg-emerald-500" },
];

export default function TodoPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadTodoCard[]>([]);
  const [tags, setTags] = useState<CrmTag[]>([]);
  const [team, setTeam] = useState<
    { id: string; fullName: string; email: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [selectedAssigneeId, setSelectedAssigneeId] = useState("");
  const [selectedActionType, setSelectedActionType] = useState("");

  // Drag and drop state
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumn | null>(
    null,
  );

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const [leadsData, tagsData, teamData] = await Promise.all([
          fetchLeadsForTodoAction(),
          fetchTagsAction(),
          fetchTeamMembersAction(),
        ]);
        setLeads(leadsData);
        setTags(tagsData);
        setTeam(teamData);
      } catch (err) {
        console.error("Failed to load Todo data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        lead.topic.toLowerCase().includes(q) ||
        (lead.companyName ?? "").toLowerCase().includes(q) ||
        (lead.contactName ?? "").toLowerCase().includes(q) ||
        (lead.nextAction ?? "").toLowerCase().includes(q);
      const matchesTag =
        !selectedTagId || (lead.tags ?? []).some((t) => t.id === selectedTagId);
      const matchesAssignee =
        !selectedAssigneeId || lead.assignedToProfileId === selectedAssigneeId;
      const matchesAction =
        !selectedActionType ||
        detectActionType(lead.nextAction).label === selectedActionType;
      return matchesSearch && matchesTag && matchesAssignee && matchesAction;
    });
  }, [leads, search, selectedTagId, selectedAssigneeId, selectedActionType]);

  const getColumnLeads = (col: KanbanColumn) => {
    const colLeads = filteredLeads.filter(
      (l) => (STATUS_TO_COLUMN[l.status] ?? "todo") === col,
    );
    return [...colLeads].sort((a, b) => {
      const aO = getDueDateInfo(a.leadDate)?.isOverdue ? -1 : 1;
      const bO = getDueDateInfo(b.leadDate)?.isOverdue ? -1 : 1;
      return aO - bO;
    });
  };

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    setDraggedLeadId(leadId);
    e.dataTransfer.setData("text/plain", leadId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, col: KanbanColumn) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverColumn !== col) setDragOverColumn(col);
  };

  const handleDragLeave = () => setDragOverColumn(null);

  const handleDrop = async (e: React.DragEvent, targetCol: KanbanColumn) => {
    e.preventDefault();
    setDragOverColumn(null);
    const leadId = e.dataTransfer.getData("text/plain") || draggedLeadId;
    setDraggedLeadId(null);
    if (!leadId) return;

    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const currentCol = STATUS_TO_COLUMN[lead.status] ?? "todo";
    if (currentCol === targetCol) return;

    const newStatus = COLUMN_TO_STATUS[targetCol];

    // Optimistic update
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l)),
    );

    const toastId = toast.loading("Mise a jour du statut...");
    try {
      const res = await updateLeadAction(leadId, { status: newStatus });
      if (res.success) {
        toast.success(
          `Statut mis a jour : ${STATUS_LABELS[newStatus] ?? newStatus}`,
          { id: toastId },
        );
      } else {
        // Rollback
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId ? { ...l, status: lead.status } : l,
          ),
        );
        toast.error(res.error || "Echec de la mise a jour", { id: toastId });
      }
    } catch {
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status: lead.status } : l)),
      );
      toast.error("Erreur de communication", { id: toastId });
    }
  };

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const overdue = leads.filter((l) => {
    if (!l.leadDate) return false;
    const d = new Date(l.leadDate);
    d.setHours(0, 0, 0, 0);
    return d < now && STATUS_TO_COLUMN[l.status] !== "done";
  });
  const active = leads.filter((l) => STATUS_TO_COLUMN[l.status] !== "done");
  const doneLeads = leads.filter((l) => STATUS_TO_COLUMN[l.status] === "done");

  const selectCls =
    "flex w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600 transition";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          eyebrow="CRM - Taches"
          title="Todo List"
          description="Vue Kanban des leads - synchronisee automatiquement avec le Pipeline CRM."
        />
        <button
          onClick={() => router.push("/dashboard/leads")}
          className="inline-flex items-center gap-1.5 self-start rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 transition"
        >
          <ExternalLink className="h-4 w-4" />
          Gerer les leads
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: "Leads actifs",
            value: active.length,
            cls: "text-stone-900",
          },
          {
            label: "En retard",
            value: overdue.length,
            cls: overdue.length > 0 ? "text-red-600" : "text-stone-900",
          },
          {
            label: "Termines",
            value: doneLeads.length,
            cls: "text-emerald-600",
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-stone-200 bg-white px-5 py-4 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">
              {kpi.label}
            </p>
            <p className={`mt-1 text-3xl font-black ${kpi.cls}`}>{kpi.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
            <input
              type="text"
              placeholder="Rechercher un lead..."
              className="w-full rounded-lg border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600 transition"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className={selectCls}
            value={selectedAssigneeId}
            onChange={(e) => setSelectedAssigneeId(e.target.value)}
          >
            <option value="">Tous les collaborateurs</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </select>
          <select
            className={selectCls}
            value={selectedActionType}
            onChange={(e) => setSelectedActionType(e.target.value)}
          >
            <option value="">Tous les types d action</option>
            {[
              "Relance",
              "Meeting",
              "Appel",
              "Proposition",
              "Message",
              "Suivi",
            ].map((at) => (
              <option key={at} value={at}>
                {at}
              </option>
            ))}
          </select>
          <select
            className={selectCls}
            value={selectedTagId}
            onChange={(e) => setSelectedTagId(e.target.value)}
          >
            <option value="">Tous les tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
          <span className="ml-3 text-sm text-stone-500">
            Chargement des leads...
          </span>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const colLeads = getColumnLeads(col.key);
            const isOver = dragOverColumn === col.key;
            return (
              <div
                key={col.key}
                onDragOver={(e) => handleDragOver(e, col.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.key)}
                className={`flex flex-col min-h-[500px] rounded-xl border p-4 transition-all duration-150 ${
                  isOver
                    ? "border-teal-400 border-dashed bg-teal-50/40 shadow-inner"
                    : "border-stone-200 bg-stone-50/60"
                }`}
              >
                <div className="flex items-center gap-2 mb-4 px-1">
                  <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                  <h3 className="font-bold text-stone-900 text-sm">
                    {col.label}
                  </h3>
                  <span className="ml-auto rounded-full bg-stone-200 px-2 py-0.5 text-xs font-bold text-stone-600">
                    {colLeads.length}
                  </span>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto">
                  {isOver && draggedLeadId && (
                    <div className="h-16 rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/60 flex items-center justify-center text-teal-600 text-xs font-semibold animate-pulse">
                      Deposer ici
                    </div>
                  )}
                  {colLeads.length === 0 && !isOver ? (
                    <div className="flex flex-col items-center justify-center py-12 border border-dashed border-stone-200 rounded-xl bg-white/60 text-stone-400 text-xs">
                      <Briefcase className="h-5 w-5 mb-1.5 opacity-30" />
                      <span>Aucun lead</span>
                    </div>
                  ) : (
                    colLeads.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        isDragging={draggedLeadId === lead.id}
                        onDragStart={handleDragStart}
                        onClick={() => router.push("/dashboard/leads")}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
