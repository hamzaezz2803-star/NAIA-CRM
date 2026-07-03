import Link from "next/link";
import {
  ArrowRight,
  Bot,
  FileText,
  FolderOpen,
  MessageSquareText,
  Sparkles,
  Users2,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchLeadsAction } from "@/features/crm/actions";

const shortcuts = [
  {
    title: "Lead intake",
    description: "Capture commerciale en langage naturel.",
    href: "/dashboard/leads",
    icon: Users2,
  },
  {
    title: "Relances",
    description: "Brouillons email et WhatsApp depuis le CRM.",
    href: "/dashboard/follow-ups",
    icon: MessageSquareText,
  },
  {
    title: "Dossiers client",
    description: "Espaces Drive liés aux leads et entreprises.",
    href: "/dashboard/documents",
    icon: FolderOpen,
  },
  {
    title: "Pipeline",
    description: "Vue Kanban et prochaines actions.",
    href: "/dashboard/todo",
    icon: FileText,
  },
];

export default async function NaiaDashboardPage() {
  const leads = await fetchLeadsAction();
  const openLeads = leads.filter(
    (lead) => lead.status !== "won" && lead.status !== "dead-end",
  );
  const scheduledActions = leads.filter((lead) => lead.nextAction).length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="N.A.I.A."
        title="Intelligence Core"
        description="Point d'entrée rapide vers les actions IA déjà connectées au CRM."
        actions={<StatusBadge status="ready-for-build" />}
      />

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-semibold text-stone-950">
                {openLeads.length}
              </p>
              <p className="text-sm text-stone-500">Leads actifs</p>
            </div>
          </div>
        </article>

        <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-semibold text-stone-950">
                {scheduledActions}
              </p>
              <p className="text-sm text-stone-500">Actions planifiées</p>
            </div>
          </div>
        </article>

        <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-50 text-amber-700">
              <FolderOpen className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-semibold text-stone-950">
                {leads.filter((lead) => lead.driveFolderUrl).length}
              </p>
              <p className="text-sm text-stone-500">Dossiers Drive</p>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {shortcuts.map((shortcut) => {
          const Icon = shortcut.icon;

          return (
            <Link
              className="group rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-teal-200 hover:shadow-md"
              href={shortcut.href}
              key={shortcut.href}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-stone-100 text-stone-600 transition group-hover:bg-teal-50 group-hover:text-teal-700">
                  <Icon className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-stone-400 transition group-hover:translate-x-1 group-hover:text-teal-700" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-stone-950">
                {shortcut.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {shortcut.description}
              </p>
            </Link>
          );
        })}
      </section>

      <div className="flex flex-col gap-3 rounded-lg border border-teal-200 bg-teal-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-teal-950">
            CRM AI workspace
          </p>
          <p className="text-sm text-teal-700">
            Les raccourcis N.A.I.A. s&apos;appuient sur les données CRM
            existantes.
          </p>
        </div>
        <Link
          className={buttonVariants({ variant: "outline" }) + " gap-2 bg-white"}
          href="/dashboard/leads"
        >
          Ouvrir le pipeline
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
