import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  PlugZap,
} from "lucide-react";

import { GoogleConnectButton } from "@/components/integrations/google-connect-button";
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

export default async function IntegrationsPage() {
  const integrations = await getIntegrationReadiness();

  return (
    <div className="space-y-6">
      <PageHeader
        actions={<StatusBadge status={integrationsModule.status} />}
        description={integrationsModule.summary}
        eyebrow="Plateforme · Connecteurs"
        title="Intégrations"
      />

      <section
        className="rounded-xl border p-4 sm:p-5 shadow-xs transition-all"
        style={{
          background: "rgba(176,141,79,0.05)",
          borderColor: "var(--maison-border)",
        }}
      >
        <div className="flex items-start gap-3.5">
          <div
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg shadow-2xs"
            style={{
              background: "rgba(176,141,79,0.12)",
              color: "var(--maison-brass)",
            }}
          >
            <PlugZap aria-hidden="true" className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2
              className="text-sm font-semibold"
              style={{ color: "var(--maison-text-primary)" }}
            >
              État réel des connecteurs
            </h2>
            <p
              className="mt-1 text-xs md:text-sm leading-relaxed"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              Google Drive, Calendar et Gmail ont un backend OAuth/API. Slack
              peut préparer des notifications approuvées via token bot. WhatsApp
              et Microsoft 365 restent derrière une fondation d&apos;approbation
              tant que leurs routes OAuth/API ne sont pas implémentées dans
              NAIA.
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
    <article
      className="rounded-xl border p-5 shadow-xs dark:border-stone-800 dark:bg-stone-950 transition-all flex flex-col justify-between"
      style={{
        background: "var(--maison-card)",
        borderColor: "var(--maison-border)",
      }}
    >
      <div>
        <div
          className="flex items-start justify-between gap-3 pb-3 border-b"
          style={{ borderColor: "var(--maison-border-subtle)" }}
        >
          <div>
            <h2
              className="text-base font-semibold tracking-tight"
              style={{
                fontFamily: "var(--font-playfair), Georgia, serif",
                color: "var(--maison-text-primary)",
              }}
            >
              {integration.label}
            </h2>
            <span
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide shadow-2xs"
              style={{
                background: "rgba(176,141,79,0.08)",
                borderColor: "var(--maison-border)",
                color: "var(--maison-text-primary)",
              }}
            >
              ● {statusLabel[integration.status]}
            </span>
          </div>
          <StatusIcon
            aria-hidden="true"
            className={
              integration.status === "connected"
                ? "h-5 w-5 text-emerald-600"
                : integration.status === "needs-review"
                  ? "h-5 w-5 text-amber-600"
                  : "h-5 w-5"
            }
            style={
              integration.status !== "connected" &&
              integration.status !== "needs-review"
                ? { color: "var(--maison-text-muted)" }
                : undefined
            }
          />
        </div>

        <p
          className="mt-3 text-xs md:text-sm leading-relaxed"
          style={{ color: "var(--maison-text-secondary)" }}
        >
          {integration.detail}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--maison-brass)" }}
            >
              Capacités
            </p>
            <p
              className="mt-1 text-xs leading-relaxed"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              {integration.capabilities.join(", ")}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--maison-brass)" }}
            >
              Variables
            </p>
            <p
              className="mt-1 rounded-md px-2.5 py-1 text-[11px] font-mono border inline-block"
              style={{
                background: "var(--maison-border-subtle)",
                borderColor: "var(--maison-border)",
                color: "var(--maison-text-primary)",
              }}
            >
              {integration.envVars.join(", ")}
            </p>
          </div>
        </div>
      </div>

      {integration.provider === "google" &&
      integration.status !== "connected" &&
      integration.status !== "not-configured" ? (
        <GoogleConnectButton className="mt-5" />
      ) : null}
    </article>
  );
}
