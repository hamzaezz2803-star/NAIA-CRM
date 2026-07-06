import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileAudio,
  Users,
} from "lucide-react";

import { GoogleConnectButton } from "@/components/integrations/google-connect-button";
import { fetchLeadsAction } from "@/features/crm/actions";
import { getIntegrationReadiness } from "@/platform/integrations/readiness";

export default async function MeetingsPage() {
  const [leads, integrations] = await Promise.all([
    fetchLeadsAction(),
    getIntegrationReadiness(),
  ]);
  const google = integrations.find(
    (integration) => integration.provider === "google",
  );
  const isGoogleConnected = google?.status === "connected";
  const meetingNotesApiUrl = process.env.MEETING_NOTES_API_URL;
  const bookedLeads = leads.filter((lead) => lead.status === "meeting-booked");

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-200">
              {isGoogleConnected ? (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              ) : (
                <CalendarCheck className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">
                Adam · Google Workspace
              </p>
              <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-300">
                {isGoogleConnected
                  ? `Connecte${google?.externalAccountLabel ? `: ${google.externalAccountLabel}` : ""}. Adam peut verifier Calendar et creer les meetings rattaches au CRM.`
                  : "Connecte ton compte Google pour verifier les disponibilites Calendar et creer les meetings depuis les leads CRM."}
              </p>
            </div>
          </div>

          {isGoogleConnected ? (
            <span className="inline-flex min-h-9 items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              Calendar synchronise
            </span>
          ) : (
            <GoogleConnectButton />
          )}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
              <Clock className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">
                Disponibilites
              </p>
              <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-300">
                Adam verifie FreeBusy avant creation et garde le meeting
                rattache au lead CRM.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">
                Invites par defaut
              </p>
              <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-300">
                Ali et Nabil sont proposes en CC pour les meetings commerciaux
                sauf instruction contraire.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-200">
              <FileAudio className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">
                Notes & transcripts
              </p>
              <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-300">
                {meetingNotesApiUrl
                  ? "Service meeting-notes configure pour recevoir audios et generer notes."
                  : "Ajoute MEETING_NOTES_API_URL pour brancher le service audio interne."}
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
              Meetings CRM a preparer
            </h2>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
              Source: leads en statut meeting booke.
            </p>
          </div>
          <span className="w-fit rounded-md border border-stone-200 px-3 py-1 text-xs font-semibold text-stone-700 dark:border-stone-800 dark:text-stone-200">
            {bookedLeads.length} meeting{bookedLeads.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {bookedLeads.slice(0, 6).map((lead) => (
            <article
              className="rounded-md border border-stone-200 p-3 dark:border-stone-800"
              key={lead.id}
            >
              <p className="font-semibold text-stone-950 dark:text-stone-50">
                {lead.companyName || lead.topic}
              </p>
              <p className="mt-1 text-sm text-stone-500">
                {lead.contactName || "Contact a completer"}
              </p>
              <p className="mt-3 line-clamp-2 text-sm leading-6 text-stone-600 dark:text-stone-300">
                {lead.nextAction ||
                  lead.notes ||
                  "Brief commercial a preparer."}
              </p>
            </article>
          ))}
          {bookedLeads.length === 0 ? (
            <p className="rounded-md border border-dashed border-stone-200 p-4 text-sm text-stone-500 dark:border-stone-800">
              Aucun meeting CRM a preparer pour l&apos;instant.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
