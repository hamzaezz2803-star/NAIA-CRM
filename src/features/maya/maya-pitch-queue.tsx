import { AlertTriangle, FileText, FolderOpen, Sparkles } from "lucide-react";

import {
  generateMayaPitchDraftFormAction,
  type MayaPitchQueueResult,
} from "./actions";

export function MayaPitchQueue({ result }: { result: MayaPitchQueueResult }) {
  if (!result.authorized) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">Accès restreint</h2>
            <p className="mt-1 text-sm leading-6">
              Maya Pitch Generator est limité à Ali et Nabil. {result.reason}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-teal-700">
              Maya · Docs Generator
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-stone-950">
              Pitch Generator
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              Maya prépare les drafts PPTX depuis le dernier deck générique, les
              credentials Qarizmi et les notes CRM.
            </p>
          </div>
          <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
            <p className="font-semibold text-stone-950">Generic actif</p>
            <p className="mt-1">{result.genericDeckFileName ?? "Non trouvé"}</p>
          </div>
        </div>

        {result.sourceWarnings.length ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            {result.sourceWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3">
        {result.items.map((item) => (
          <article
            className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
            key={item.leadId}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles
                    className="h-4 w-4 text-teal-700"
                    aria-hidden="true"
                  />
                  <h2 className="font-semibold text-stone-950">
                    {item.clientName}
                  </h2>
                </div>
                <p className="mt-1 text-sm text-stone-500">
                  {item.contactName ?? "Contact à compléter"} · {item.status}
                </p>
                {item.plan ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
                    {item.plan.diagnosticOutline[0]}
                  </p>
                ) : null}
              </div>
              <form action={generateMayaPitchDraftFormAction}>
                <input name="leadId" type="hidden" value={item.leadId} />
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-950 px-3 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  type="submit"
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  Générer draft PPTX
                </button>
              </form>
            </div>

            {item.missingQuestions.length ? (
              <div className="mt-4 rounded-md border border-dashed border-stone-200 p-3">
                <p className="text-xs font-semibold uppercase text-stone-500">
                  Questions à compléter
                </p>
                <ul className="mt-2 space-y-1 text-sm text-stone-700">
                  {item.missingQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {item.draftFilePath ? (
              <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
                <span>{item.draftFileName}</span>
              </div>
            ) : null}
          </article>
        ))}

        {result.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-200 bg-white p-5 text-sm text-stone-500">
            Aucun lead en meeting booké pour le moment.
          </p>
        ) : null}
      </section>
    </div>
  );
}
