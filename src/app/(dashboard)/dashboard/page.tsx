import React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { fetchLeadsAction } from "@/features/crm/actions";
import {
  ArrowRight,
  Users2,
  CalendarCheck,
  FileCheck2,
  FolderOpen,
  Bot,
  Clock,
} from "lucide-react";

export default async function DashboardPage() {
  // Real data from Supabase
  const leads = await fetchLeadsAction();

  const stats = [
    {
      name: "Leads à contacter",
      value: leads.filter((l) => l.status === "lead-to-contact").length,
      icon: Users2,
      color: "text-blue-700",
      bg: "bg-blue-50",
    },
    {
      name: "Meetings fixés",
      value: leads.filter((l) => l.status === "meeting-booked").length,
      icon: CalendarCheck,
      color: "text-indigo-700",
      bg: "bg-indigo-50",
    },
    {
      name: "Propales envoyées",
      value: leads.filter((l) => l.status === "proposal-sent").length,
      icon: FileCheck2,
      color: "text-emerald-700",
      bg: "bg-emerald-50",
    },
    {
      name: "Gagnés ce cycle",
      value: leads.filter((l) => l.status === "won").length,
      icon: FolderOpen,
      color: "text-teal-700",
      bg: "bg-teal-50",
    },
  ];

  // Latest leads for the activity feed
  const recentLeads = leads.slice(0, 5);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <PageHeader
        eyebrow="Vue d'ensemble"
        title="Qarizmi OS"
        description="Hub intelligent pour importer vos leads, automatiser vos relances et orchestrer vos espaces de stockage client."
        actions={<StatusBadge status="live" />}
      />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.name}
              className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
            >
              <div className={`inline-flex h-10 w-10 items-center justify-center rounded-md ${stat.bg}`}>
                <Icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <p className="mt-3 text-2xl font-bold text-stone-950">
                {stat.value}
              </p>
              <p className="mt-1 text-sm text-stone-500">{stat.name}</p>
            </div>
          );
        })}
      </div>

      {/* Two columns */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent leads */}
        <div className="lg:col-span-2 rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-stone-950">
                Leads récents
              </h2>
            </div>
            <Link
              href="/dashboard/leads"
              className="text-xs font-medium text-teal-700 hover:underline"
            >
              Voir tout
            </Link>
          </div>

          {recentLeads.length === 0 ? (
            <div className="p-8 text-center text-sm text-stone-400">
              Aucun lead encore. Commencez par en ajouter un dans le pipeline CRM.
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {recentLeads.map((lead) => (
                <div key={lead.id} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-950">
                      {lead.topic}
                    </p>
                    {lead.nextAction && (
                      <p className="truncate text-xs text-stone-500">
                        → {lead.nextAction}
                      </p>
                    )}
                  </div>
                  <span className="ml-3 flex-none rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium capitalize text-stone-600">
                    {lead.status.replace(/-/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI shortcuts */}
        <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-stone-200 px-5 py-4">
            <Bot className="h-4 w-4 text-teal-700" />
            <h2 className="text-sm font-semibold text-stone-950">
              Raccourcis IA CRM
            </h2>
          </div>
          <div className="space-y-2 p-4">
            <p className="rounded-md bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
              <span className="mb-1 block font-semibold text-teal-700">
                Exemple de saisie :
              </span>
              "J'ai parlé à Karim de Atlas Telecom pour un projet IA CRM, à
              relancer vendredi."
            </p>

            <Link
              href="/dashboard/leads"
              className={buttonVariants({ variant: "outline" }) + " w-full justify-start gap-2 text-xs"}
            >
              <Users2 className="h-4 w-4 text-teal-600" />
              Ajouter un lead (langage naturel)
            </Link>
            <Link
              href="/dashboard/leads"
              className={buttonVariants({ variant: "outline" }) + " w-full justify-start gap-2 text-xs"}
            >
              <Bot className="h-4 w-4 text-indigo-500" />
              Générer une relance (WhatsApp/Email)
            </Link>
            <Link
              href="/dashboard/documents"
              className={buttonVariants({ variant: "outline" }) + " w-full justify-start gap-2 text-xs"}
            >
              <FolderOpen className="h-4 w-4 text-amber-500" />
              Voir les dossiers Drive
            </Link>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-6 py-4">
        <div>
          <p className="text-sm font-semibold text-teal-900">
            Pipeline CRM complet
          </p>
          <p className="text-sm text-teal-700">
            {leads.length} lead{leads.length !== 1 ? "s" : ""} au total dans votre pipeline.
          </p>
        </div>
        <Link
          href="/dashboard/leads"
          className={buttonVariants() + " gap-2"}
        >
          Accéder au CRM
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
