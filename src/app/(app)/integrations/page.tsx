import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  PlugZap,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireModule } from "@/platform/core/modules";
import {
  type IntegrationHealth,
  type IntegrationHealthStatus,
} from "@/platform/integrations/contracts";
import { getIntegrationReadiness } from "@/platform/integrations/readiness";

const integrationsModule = requireModule("integrations");

const statusLabel: Record<IntegrationHealthStatus, string> = {
  connected: "Connecte",
  "needs-review": "A verifier",
  "ready-to-connect": "Pret a connecter",
  "not-configured": "Non configure",
  "not-implemented": "Non implemente",
};

const statusClassName: Record<IntegrationHealthStatus, string> = {
  connected:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-300",
  "needs-review":
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300",
  "ready-to-connect":
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/30 dark:bg-sky-950/20 dark:text-sky-300",
  "not-configured":
    "border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300",
  "not-implemented":
    "border-stone-200 bg-white text-stone-500 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400",
};

export default async function IntegrationsPage() {
  const integrations = await getIntegrationReadiness();

  return (
    <div className="space-y-8">
      <PageHeader
        actions={<StatusBadge status={integrationsModule.status} />}
        description={integrationsModule.summary}
        eyebrow="Platform"
        title="Integrations"
      />

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <PlugZap
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 flex-none text-amber-700 dark:text-amber-300"
          />
          <div>
            <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-100">
              Etat reel des connecteurs
            </h2>
            <p className="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-200">
              Google Drive et Calendar ont un backend. Slack, WhatsApp,
              Microsoft 365 et Gmail API restent derriere une fondation
              d&apos;approbation tant que leurs routes OAuth/API ne sont pas
              implementees dans NAIA.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {integrations.map((integration) => (
          <IntegrationCard
            integration={integration}
            key={integration.provider}
          />
        ))}
      </section>
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationHealth }) {
  const StatusIcon =
    integration.status === "connected"
      ? CheckCircle2
      : integration.status === "needs-review"
        ? AlertTriangle
        : CircleDashed;

  return (
    <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-stone-950">
            {integration.label}
          </h2>
          <span
            className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClassName[integration.status]}`}
          >
            {statusLabel[integration.status]}
          </span>
        </div>
        <StatusIcon
          aria-hidden="true"
          className={
            integration.status === "connected"
              ? "h-5 w-5 text-emerald-600"
              : integration.status === "needs-review"
                ? "h-5 w-5 text-amber-600"
                : "h-5 w-5 text-stone-400"
          }
        />
      </div>

      <p className="mt-4 text-sm leading-6 text-stone-600">
        {integration.detail}
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase text-stone-500">
            Capacites
          </p>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {integration.capabilities.join(", ")}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-stone-500">
            Variables
          </p>
          <p className="mt-1 text-xs font-medium leading-5 text-stone-500">
            {integration.envVars.join(", ")}
          </p>
        </div>
      </div>
    </article>
  );
}
