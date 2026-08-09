"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderOpen,
  LockKeyhole,
} from "lucide-react";

import type { MayaTemplateSource } from "./contracts";
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
              Maya Docs Generator est limité à Ali et Nabil. {result.reason}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const pitchTemplate = result.templates.find(
    (template) => template.family === "pitch",
  );
  const templateReady = pitchTemplate?.availability === "ready";

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase text-teal-700">
          Maya · Docs Generator
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950">
          Pitch Generator
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
          Maya copie le dernier modèle approuvé sans modifier ses slides,
          layouts, thèmes, médias ou textes. Seul le nom du fichier est adapté
          au client.
        </p>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {result.templates.map((template) => (
            <MayaTemplateCard key={template.family} template={template} />
          ))}
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
            templateReady={templateReady}
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

function MayaTemplateCard({ template }: { template: MayaTemplateSource }) {
  const isPitch = template.family === "pitch";
  const isReady = template.availability === "ready";
  const availabilityLabel = isReady
    ? "Prêt · modèle approuvé"
    : template.availability === "manual-review"
      ? "Validation manuelle"
      : "Indisponible";

  return (
    <article className="rounded-md border border-stone-200 bg-stone-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-stone-500">
            Famille
          </p>
          <h2 className="mt-1 font-semibold text-stone-950">
            {isPitch ? "Pitch client" : "Proposition commerciale"}
          </h2>
        </div>
        <span
          className={
            isReady
              ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800"
              : "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
          }
        >
          {availabilityLabel}
        </span>
      </div>

      <p className="mt-3 break-words text-sm font-medium text-stone-800">
        {template.fileName ?? "Aucun fichier automatique sélectionné"}
      </p>
      <dl className="mt-3 grid gap-1 text-xs text-stone-600">
        <div className="flex gap-2">
          <dt className="font-semibold">Modifié</dt>
          <dd>{formatMayaTemplateDate(template.modifiedAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Source</dt>
          <dd>{template.sourceLabel}</dd>
        </div>
      </dl>
      {template.webViewLink ? (
        <a
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-teal-800 underline-offset-4 hover:underline"
          href={template.webViewLink}
          rel="noreferrer"
          target="_blank"
        >
          Ouvrir le modèle source
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </article>
  );
}

function MayaPitchQueueCard({
  formAction,
  formState,
  item,
  templateReady,
}: {
  formAction: (payload: FormData) => void;
  formState: MayaPitchDraftFormState;
  item: MayaPitchQueueItem;
  templateReady: boolean;
}) {
  const itemFormState =
    formState.leadId === item.leadId && formState.status !== "idle"
      ? formState
      : null;
  const existingDraftHref = buildMayaFileHref(item.draftFilePath);
  const blocked = Boolean(item.destinationError) || !templateReady;

  return (
    <article className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <form action={formAction} className="space-y-4">
        <input name="leadId" type="hidden" value={item.leadId} />
        <input name="family" type="hidden" value="pitch" />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck2
                className="h-4 w-4 text-teal-700"
                aria-hidden="true"
              />
              <h2 className="font-semibold text-stone-950">
                {item.clientName}
              </h2>
            </div>
            <p className="mt-1 text-sm text-stone-500">
              {item.contactName ?? "Contact non renseigné"} · {item.status}
            </p>
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-stone-600">
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              {item.destinationFolderUrl
                ? "Destination vérifiée : dossier CRM / 01_Pitch"
                : "Destination Drive non vérifiée"}
            </p>
          </div>
          <MayaPitchSubmitButton disabled={blocked} />
        </div>

        {item.destinationError ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Copie bloquée</p>
            <p className="mt-1">{item.destinationError}</p>
          </div>
        ) : (
          <label className="flex items-start gap-3 rounded-md border border-teal-100 bg-teal-50/60 p-3 text-sm text-stone-700">
            <input
              className="mt-1 h-4 w-4 rounded border-stone-300 text-teal-700"
              name="confirmTemplateCopy"
              required
              type="checkbox"
            />
            <span>
              Je confirme la copie fidèle du modèle affiché vers le dossier CRM
              vérifié <strong>01_Pitch</strong>. Aucun contenu interne ne sera
              réécrit et aucun provider IA ne sera appelé.
            </span>
          </label>
        )}

        {itemFormState ? <MayaPitchFormFeedback state={itemFormState} /> : null}

        {item.draftFilePath ? (
          <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-2">
              <FileText className="h-4 w-4" aria-hidden="true" />
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

function MayaPitchSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-stone-950 px-3 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled || pending}
      type="submit"
    >
      <LockKeyhole className="h-4 w-4" aria-hidden="true" />
      {pending ? "Vérification et copie..." : "Copier dans 01_Pitch"}
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

function formatMayaTemplateDate(value: string | undefined) {
  if (!value) return "Non disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Non disponible";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Casablanca",
  }).format(date);
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
