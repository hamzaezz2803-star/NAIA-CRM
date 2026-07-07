import { CalendarCheck, CheckCircle2 } from "lucide-react";

import { GoogleConnectButton } from "@/components/integrations/google-connect-button";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchLeadsAction } from "@/features/crm/actions";
import { MeetingsDashboard } from "@/features/meetings/meetings-dashboard";
import { getAppSession } from "@/platform/auth/session";
import { getIntegrationReadiness } from "@/platform/integrations/readiness";

export default async function MeetingsPage() {
  const [leads, integrations, session] = await Promise.all([
    fetchLeadsAction(),
    getIntegrationReadiness(),
    getAppSession(),
  ]);

  const google = integrations.find(
    (integration) => integration.provider === "google",
  );
  const isGoogleConnected = google?.status === "connected";
  const userName = session.user.name.split(" ")[0] ?? "Ali";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Calendrier & Orchestration"
        title="Meetings"
        description="Planifiez vos réunions clients, préparez vos pitchs de vente avec l'IA et synchronisez vos événements."
        actions={<StatusBadge status="live" />}
      />

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
                  : google?.status === "not-configured"
                    ? "L'intégration Google Workspace n'est pas configurée dans les variables d'environnement (.env.local)."
                    : "Connecte ton compte Google pour verifier les disponibilites Calendar et creer les meetings depuis les leads CRM."}
              </p>
            </div>
          </div>

          {isGoogleConnected ? (
            <span className="inline-flex min-h-9 items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              Calendar synchronise
            </span>
          ) : google?.status === "not-configured" ? (
            <span className="inline-flex min-h-9 items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              Non configuré (.env.local)
            </span>
          ) : (
            <GoogleConnectButton />
          )}
        </div>
      </section>

      <MeetingsDashboard
        initialLeads={leads}
        userName={userName}
        googleConnected={isGoogleConnected}
      />
    </div>
  );
}
