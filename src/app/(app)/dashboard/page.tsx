import React from "react";
import Link from "next/link";
import { fetchLeadsAction } from "@/features/crm/actions";
import {
  ArrowRight,
  Users2,
  CalendarCheck,
  FileCheck2,
  FolderOpen,
  Bot,
  Clock,
  TrendingUp,
} from "lucide-react";

export default async function DashboardPage() {
  const leads = await fetchLeadsAction();

  const stats = [
    {
      name: "Leads à contacter",
      value: leads.filter((l) => l.status === "lead-to-contact").length,
      icon: Users2,
      accent: "#6b8cff",
    },
    {
      name: "Meetings fixés",
      value: leads.filter((l) => l.status === "meeting-booked").length,
      icon: CalendarCheck,
      accent: "#a78bfa",
    },
    {
      name: "Propales envoyées",
      value: leads.filter((l) => l.status === "proposal-sent").length,
      icon: FileCheck2,
      accent: "#34d399",
    },
    {
      name: "Gagnés ce cycle",
      value: leads.filter((l) => l.status === "won").length,
      icon: TrendingUp,
      accent: "var(--maison-brass)",
    },
  ];

  const recentLeads = leads.slice(0, 5);

  const STATUS_LABEL: Record<string, string> = {
    "lead-to-contact": "À contacter",
    contacted: "Contacté",
    "to-follow-up": "À relancer",
    "meeting-booked": "Meeting fixé",
    "proposal-sent": "Propale envoyée",
    won: "Gagné",
    "dead-end": "Clos",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: "var(--maison-border)" }}
      >
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--maison-brass)" }}
          >
            Vue d&apos;ensemble
          </p>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl"
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              color: "var(--maison-text-primary)",
            }}
          >
            NAIA-os
          </h1>
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            Hub intelligent pour importer vos leads, automatiser vos relances et
            orchestrer vos espaces de stockage client.
          </p>
        </div>
        <span
          className="self-start rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
          style={{
            background: "rgba(52,211,153,0.1)",
            borderColor: "rgba(52,211,153,0.3)",
            color: "#34d399",
          }}
        >
          ● Live
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.name}
              className="rounded-xl p-5 shadow-sm"
              style={{
                background: "var(--maison-card)",
                border: "1px solid var(--maison-border)",
              }}
            >
              <div
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ background: `${stat.accent}18` }}
              >
                <Icon className="h-4.5 w-4.5" style={{ color: stat.accent }} />
              </div>
              <p
                className="mt-3 text-2xl font-black"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {stat.value}
              </p>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                {stat.name}
              </p>
            </div>
          );
        })}
      </div>

      {/* Two columns */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent leads */}
        <div
          className="lg:col-span-2 rounded-xl shadow-sm overflow-hidden"
          style={{
            background: "var(--maison-card)",
            border: "1px solid var(--maison-border)",
          }}
        >
          <div
            className="flex items-center justify-between border-b px-5 py-4"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <div className="flex items-center gap-2">
              <Clock
                className="h-4 w-4"
                style={{ color: "var(--maison-brass)" }}
              />
              <h2
                className="text-sm font-semibold"
                style={{ color: "var(--maison-text-primary)" }}
              >
                Leads récents
              </h2>
            </div>
            <Link
              href="/dashboard/leads"
              className="text-xs font-semibold transition hover:opacity-70"
              style={{ color: "var(--maison-brass)" }}
            >
              Voir tout →
            </Link>
          </div>

          {recentLeads.length === 0 ? (
            <div
              className="p-8 text-center text-sm"
              style={{ color: "var(--maison-text-muted)" }}
            >
              Aucun lead encore. Commencez par en ajouter un dans le pipeline
              CRM.
            </div>
          ) : (
            <div>
              {recentLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between px-5 py-3 border-b last:border-b-0"
                  style={{ borderColor: "var(--maison-border)" }}
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {lead.topic}
                    </p>
                    {lead.nextAction && (
                      <p
                        className="truncate text-xs"
                        style={{ color: "var(--maison-text-muted)" }}
                      >
                        → {lead.nextAction}
                      </p>
                    )}
                  </div>
                  <span
                    className="ml-3 flex-none rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize"
                    style={{
                      background: "var(--maison-page)",
                      borderColor: "var(--maison-border)",
                      color: "var(--maison-text-secondary)",
                    }}
                  >
                    {STATUS_LABEL[lead.status] ??
                      lead.status.replace(/-/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI shortcuts */}
        <div
          className="rounded-xl shadow-sm overflow-hidden"
          style={{
            background: "var(--maison-card)",
            border: "1px solid var(--maison-border)",
          }}
        >
          <div
            className="flex items-center gap-2 border-b px-5 py-4"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <Bot className="h-4 w-4" style={{ color: "var(--maison-brass)" }} />
            <h2
              className="text-sm font-semibold"
              style={{ color: "var(--maison-text-primary)" }}
            >
              Raccourcis IA CRM
            </h2>
          </div>
          <div className="space-y-2 p-4">
            <p
              className="rounded-lg p-3 text-xs leading-relaxed"
              style={{
                background: "var(--maison-page)",
                color: "var(--maison-text-secondary)",
                border: "1px solid var(--maison-border)",
              }}
            >
              <span
                className="mb-1 block font-bold"
                style={{ color: "var(--maison-brass)" }}
              >
                Exemple de saisie :
              </span>
              &ldquo;J&apos;ai parlé à Karim de Atlas Telecom pour un projet IA
              CRM, à relancer vendredi.&rdquo;
            </p>

            {[
              {
                href: "/dashboard/leads",
                icon: Users2,
                label: "Ajouter un lead (langage naturel)",
                color: "var(--maison-brass)",
              },
              {
                href: "/dashboard/leads",
                icon: Bot,
                label: "Générer une relance (WhatsApp/Email)",
                color: "#a78bfa",
              },
              {
                href: "/dashboard/drives",
                icon: FolderOpen,
                label: "Voir les dossiers Drive",
                color: "#f59e0b",
              },
            ].map((item) => (
              <Link
                key={item.href + item.label}
                href={item.href}
                className="flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs font-semibold transition hover:opacity-80"
                style={{
                  borderColor: "var(--maison-border)",
                  background: "var(--maison-page)",
                  color: "var(--maison-text-primary)",
                }}
              >
                <item.icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: item.color }}
                />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* CTA Banner */}
      <div
        className="flex items-center justify-between rounded-xl px-6 py-4"
        style={{
          background:
            "linear-gradient(135deg, rgba(201,168,76,0.12) 0%, rgba(201,168,76,0.04) 100%)",
          border: "1px solid rgba(201,168,76,0.25)",
        }}
      >
        <div>
          <p
            className="text-sm font-bold"
            style={{ color: "var(--maison-text-primary)" }}
          >
            Pipeline CRM complet
          </p>
          <p
            className="text-xs mt-0.5"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            {leads.length} lead{leads.length !== 1 ? "s" : ""} au total dans
            votre pipeline.
          </p>
        </div>
        <Link
          href="/dashboard/leads"
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold shadow-sm transition"
          style={{
            background: "var(--maison-brass)",
            color: "var(--maison-brass-text)",
          }}
        >
          Accéder au CRM
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
