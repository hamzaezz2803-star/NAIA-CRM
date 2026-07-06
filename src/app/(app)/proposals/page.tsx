import Link from "next/link";
import {
  ArrowUpRight,
  FileText,
  FolderOpen,
  HelpCircle,
  Presentation,
  type LucideIcon,
} from "lucide-react";

import { fetchLeadsAction } from "@/features/crm/actions";

const clientDevelopmentUrl =
  "https://drive.google.com/drive/folders/1_2ZTPDoGMhNVn3G9H95v4tXpDHuBbXzs";

const pitchLibraryUrl =
  "https://drive.google.com/drive/folders/1PEC-tzzZLstp_97IwO4sGipoeY-CUk49";

const smartQuestions = [
  "Lien du site client pour confirmer la bonne entite et le secteur.",
  "Objectif du meeting: diagnostic, vente, cadrage technique ou sponsor buy-in.",
  "Notes commerciales deja connues: douleurs, objections, interlocuteurs et timing.",
  "Decision maker attendu et angle du pitch: CEO, COO, CFO, IT ou RH.",
];

export default async function ProposalsPage() {
  const leads = await fetchLeadsAction();
  const pitchQueue = leads.filter((lead) => lead.status === "meeting-booked");
  const proposalQueue = leads.filter((lead) =>
    ["proposal-sent", "to-follow-up", "won"].includes(lead.status),
  );

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-teal-700">
              Maya · Docs Generator
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-stone-950">
              Pitchs et propales Qarizmi
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              Maya part du CRM, de la base de pitchs Qarizmi et des notes client
              pour preparer les documents a valider.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              href={pitchLibraryUrl}
              rel="noreferrer"
              target="_blank"
            >
              <Presentation className="h-4 w-4" aria-hidden="true" />
              Bibliotheque pitch
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-950 px-3 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              href={clientDevelopmentUrl}
              rel="noreferrer"
              target="_blank"
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              Drive client
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <DocQueue
          emptyText="Aucun lead en meeting booke."
          icon={Presentation}
          leads={pitchQueue}
          title="Pitchs a preparer"
        />
        <DocQueue
          emptyText="Aucune propale en file."
          icon={FileText}
          leads={proposalQueue}
          title="Propales post-meeting"
        />
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-teal-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">
            Questions avant generation
          </h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {smartQuestions.map((question) => (
            <div
              className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm leading-6 text-stone-700"
              key={question}
            >
              {question}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DocQueue({
  emptyText,
  icon: Icon,
  leads,
  title,
}: {
  emptyText: string;
  icon: LucideIcon;
  leads: Awaited<ReturnType<typeof fetchLeadsAction>>;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-teal-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
        </div>
        <span className="rounded-full border border-stone-200 px-3 py-1 text-xs font-semibold text-stone-600">
          {leads.length}
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        {leads.map((lead) => (
          <article
            className="rounded-md border border-stone-200 p-3"
            key={lead.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-stone-950">
                  {lead.companyName || lead.topic}
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  {lead.contactName || "Contact a completer"}
                </p>
              </div>
              <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600">
                {lead.status}
              </span>
            </div>
            <p className="mt-3 line-clamp-2 text-sm leading-6 text-stone-600">
              {lead.notes || lead.nextAction || "Contexte client a enrichir."}
            </p>
            <button
              className="mt-3 inline-flex min-h-9 items-center rounded-md border border-stone-200 px-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              type="button"
            >
              Preparer brouillon
            </button>
          </article>
        ))}

        {leads.length === 0 ? (
          <p className="rounded-md border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            {emptyText}
          </p>
        ) : null}
      </div>
    </section>
  );
}
