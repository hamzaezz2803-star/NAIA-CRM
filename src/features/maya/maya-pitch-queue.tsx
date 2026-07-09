"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  FolderOpen,
  Sparkles,
} from "lucide-react";

import {
  generateMayaPitchDraftFormAction,
  type MayaPitchDraftFormState,
  type MayaPitchQueueItem,
  type MayaPitchQueueResult,
} from "./actions";

const initialDraftFormState: MayaPitchDraftFormState = { status: "idle" };

export function MayaPitchQueue({ result }: { result: MayaPitchQueueResult }) {
  const [formState, formAction] = useActionState(
    generateMayaPitchDraftFormAction,
    initialDraftFormState,
  );

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
          <MayaPitchQueueCard
            formAction={formAction}
            formState={formState}
            item={item}
            key={item.leadId}
          />
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

function MayaPitchQueueCard({
  formAction,
  formState,
  item,
}: {
  formAction: (payload: FormData) => void;
  formState: MayaPitchDraftFormState;
  item: MayaPitchQueueItem;
}) {
  const [generateAnyway, setGenerateAnyway] = useState(false);
  const itemFormState =
    formState.leadId === item.leadId && formState.status !== "idle"
      ? formState
      : null;
  const existingDraftHref = buildMayaFileHref(item.draftFilePath);
  const shouldRequireWebsite =
    hasMissingQuestion(item, "site web") && !generateAnyway;
  const shouldRequireMeetingObjective =
    hasMissingQuestion(item, "objectif principal") && !generateAnyway;
  const shouldRequireContact =
    hasMissingQuestion(item, "interlocuteur principal") && !generateAnyway;

  return (
    <article className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <form action={formAction} className="space-y-4">
        <input name="leadId" type="hidden" value={item.leadId} />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-700" aria-hidden="true" />
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
          <MayaPitchSubmitButton
            hasExistingDraft={Boolean(item.draftFilePath)}
            needsContext={item.status === "needs-context"}
          />
        </div>

        <div className="rounded-md border border-teal-100 bg-teal-50/60 p-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold uppercase text-teal-800">
              Contexte pitch à confirmer
            </p>
            {item.missingQuestions.length ? (
              <p className="text-xs text-teal-900">
                {item.missingQuestions.length} question
                {item.missingQuestions.length > 1 ? "s" : ""} avant génération
              </p>
            ) : null}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <MayaPitchInput
              defaultValue={item.contextDefaults.websiteUrl}
              label="Site web exact du client"
              name="websiteUrl"
              placeholder="https://client.com"
              required={shouldRequireWebsite}
              type="url"
            />
            <MayaPitchInput
              defaultValue={item.contextDefaults.meetingObjective}
              label="Objectif du meeting"
              name="meetingObjective"
              placeholder="Qualifier le potentiel IA et cadrer les use cases"
              required={shouldRequireMeetingObjective}
            />
            <MayaPitchInput
              defaultValue={item.contextDefaults.contactName}
              label="Interlocuteur principal"
              name="contactName"
              placeholder="Nom du décideur"
              required={shouldRequireContact}
            />
            <MayaPitchInput
              defaultValue={item.contextDefaults.contactRole}
              label="Rôle / fonction du contact"
              name="contactRole"
              placeholder="CEO, COO, Directeur métier..."
            />
            <MayaPitchInput
              defaultValue={item.contextDefaults.industry}
              label="Secteur / activité"
              name="industry"
              placeholder="Logistique, retail, finance..."
            />
            <label className="grid gap-1 text-sm font-medium text-stone-700 lg:col-span-3">
              Contexte additionnel pour Maya
              <textarea
                className="min-h-20 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                name="extraContext"
                placeholder="Notes du dernier échange, enjeux métier, contraintes, angle souhaité par Nabil/Ali..."
              />
            </label>
          </div>

          {item.missingQuestions.length ? (
            <label className="mt-3 flex items-start gap-2 text-sm text-stone-700">
              <input
                checked={generateAnyway}
                className="mt-1 h-4 w-4 rounded border-stone-300 text-teal-700"
                name="generateAnyway"
                onChange={(event) => setGenerateAnyway(event.target.checked)}
                type="checkbox"
              />
              Générer quand même un draft provisoire si certaines réponses ne
              sont pas encore disponibles.
            </label>
          ) : null}
        </div>

        {itemFormState ? <MayaPitchFormFeedback state={itemFormState} /> : null}

        {item.draftFilePath ? (
          <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-2">
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              {item.draftFileName}
            </span>
            {existingDraftHref ? (
              <a
                className="inline-flex items-center gap-1 font-semibold text-emerald-950 underline-offset-4 hover:underline"
                href={existingDraftHref}
                rel="noreferrer"
                target="_blank"
              >
                Ouvrir le draft dans Drive
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        ) : null}
      </form>
    </article>
  );
}

function MayaPitchInput({
  defaultValue,
  label,
  name,
  placeholder,
  required = false,
  type = "text",
}: {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder: string;
  required?: boolean;
  type?: "text" | "url";
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-stone-700">
      {label}
      <input
        className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

function MayaPitchSubmitButton({
  hasExistingDraft,
  needsContext,
}: {
  hasExistingDraft: boolean;
  needsContext: boolean;
}) {
  const { pending } = useFormStatus();
  const label = pending
    ? "Génération en cours..."
    : needsContext
      ? "Compléter et générer le draft PPTX"
      : hasExistingDraft
        ? "Régénérer draft PPTX"
        : "Générer draft PPTX";

  return (
    <button
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-stone-950 px-3 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-wait disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      <FileText className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function MayaPitchFormFeedback({
  state,
}: {
  state: Exclude<MayaPitchDraftFormState, { status: "idle" }>;
}) {
  const isSuccess = state.status === "success";
  const draftHref = buildMayaFileHref(state.draftFilePath);

  return (
    <div
      className={
        isSuccess
          ? "rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
          : "rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      }
      role="status"
    >
      <div className="flex items-start gap-2">
        {isSuccess ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden="true" />
        )}
        <div>
          <p className="font-medium">{state.message}</p>
          {draftHref ? (
            <a
              className="mt-2 inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
              href={draftHref}
              rel="noreferrer"
              target="_blank"
            >
              Ouvrir le draft dans Drive
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function hasMissingQuestion(item: MayaPitchQueueItem, keyword: string) {
  return item.missingQuestions.some((question) =>
    question.toLocaleLowerCase("fr-FR").includes(keyword),
  );
}

function buildMayaFileHref(filePath: string | undefined) {
  if (!filePath) return undefined;
  if (filePath.startsWith("gdrive:")) {
    const fileId = filePath.slice("gdrive:".length);
    return fileId
      ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
      : undefined;
  }
  if (filePath.startsWith("https://") || filePath.startsWith("http://")) {
    return filePath;
  }

  return undefined;
}
