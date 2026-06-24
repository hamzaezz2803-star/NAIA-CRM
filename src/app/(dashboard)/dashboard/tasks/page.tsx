"use client";

import React, { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  CheckCircle2,
  Calendar,
  Loader2,
  Bot,
  Clock,
  AlertTriangle,
  Circle,
} from "lucide-react";
import { fetchLeadsAction } from "@/features/crm/actions";

type TaskItem = {
  leadId: string;
  topic: string;
  action: string;
  date: string | undefined;
  isOverdue: boolean;
  isToday: boolean;
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchLeadsAction().then((leads) => {
      const today = new Date().toISOString().split("T")[0];

      const items: TaskItem[] = leads
        .filter(
          (l) => l.nextAction && l.status !== "won" && l.status !== "dead-end",
        )
        .map((lead) => ({
          leadId: lead.id,
          topic: lead.topic,
          action: lead.nextAction!,
          date: lead.nextActionDate,
          isOverdue: Boolean(
            lead.nextActionDate && lead.nextActionDate < today,
          ),
          isToday: lead.nextActionDate === today,
        }))
        .sort((a, b) => {
          // Overdue first, then by date
          if (a.isOverdue && !b.isOverdue) return -1;
          if (!a.isOverdue && b.isOverdue) return 1;
          if (a.date && b.date) return a.date.localeCompare(b.date);
          if (a.date) return -1;
          if (b.date) return 1;
          return 0;
        });

      setTasks(items);
      setIsLoading(false);
    });
  }, []);

  const overdue = tasks.filter((t) => t.isOverdue);
  const today = tasks.filter((t) => t.isToday && !t.isOverdue);
  const upcoming = tasks.filter((t) => !t.isOverdue && !t.isToday && t.date);
  const noDueDate = tasks.filter((t) => !t.date);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="CRM · Tâches"
        title="Prochaines actions"
        description="Toutes les actions de relance extraites de votre pipeline CRM, triées par urgence."
        actions={<StatusBadge status="live" />}
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "En retard", value: overdue.length, color: "text-red-600" },
          {
            label: "Aujourd'hui",
            value: today.length,
            color: "text-amber-600",
          },
          { label: "À venir", value: upcoming.length, color: "text-teal-700" },
          {
            label: "Sans date",
            value: noDueDate.length,
            color: "text-stone-500",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
          >
            <p className="text-sm text-stone-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
          <span className="ml-3 text-sm text-stone-500">
            Chargement des tâches…
          </span>
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-emerald-50">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-stone-950">
            Aucune tâche en attente
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-stone-500">
            Toutes les actions de suivi sont à jour. L&apos;IA ajoutera
            automatiquement des relances basées sur vos leads.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <TaskGroup
              label="En retard"
              icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
              labelColor="text-red-700"
              tasks={overdue}
              variant="overdue"
            />
          )}
          {today.length > 0 && (
            <TaskGroup
              label="Aujourd'hui"
              icon={<Clock className="h-4 w-4 text-amber-500" />}
              labelColor="text-amber-700"
              tasks={today}
              variant="today"
            />
          )}
          {upcoming.length > 0 && (
            <TaskGroup
              label="À venir"
              icon={<Calendar className="h-4 w-4 text-teal-600" />}
              labelColor="text-teal-800"
              tasks={upcoming}
              variant="upcoming"
            />
          )}
          {noDueDate.length > 0 && (
            <TaskGroup
              label="Sans date d'échéance"
              icon={<Bot className="h-4 w-4 text-stone-400" />}
              labelColor="text-stone-600"
              tasks={noDueDate}
              variant="none"
            />
          )}
        </div>
      )}
    </div>
  );
}

function TaskGroup({
  label,
  icon,
  labelColor,
  tasks,
  variant,
}: {
  label: string;
  icon: React.ReactNode;
  labelColor: string;
  tasks: TaskItem[];
  variant: "overdue" | "today" | "upcoming" | "none";
}) {
  const borderMap = {
    overdue: "border-red-200",
    today: "border-amber-200",
    upcoming: "border-teal-200",
    none: "border-stone-200",
  };

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className={`text-sm font-semibold ${labelColor}`}>
          {label} ({tasks.length})
        </h2>
      </div>
      <div
        className={`divide-y divide-stone-100 overflow-hidden rounded-lg border ${borderMap[variant]} bg-white shadow-sm`}
      >
        {tasks.map((task) => (
          <div key={task.leadId} className="flex items-start gap-4 px-5 py-4">
            <div className="mt-0.5 flex-none">
              <Circle className="h-4 w-4 text-stone-300" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-stone-950 truncate">
                {task.action}
              </p>
              <p className="mt-0.5 truncate text-xs text-stone-500">
                Lead : {task.topic}
              </p>
            </div>
            {task.date && (
              <div
                className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  task.isOverdue
                    ? "bg-red-50 text-red-700"
                    : task.isToday
                      ? "bg-amber-50 text-amber-700"
                      : "bg-stone-100 text-stone-600"
                }`}
              >
                {task.date}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
