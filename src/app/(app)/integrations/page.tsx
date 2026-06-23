import { PlugZap } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { plannedIntegrationProviders } from "@/platform/integrations/contracts";
import { requireModule } from "@/platform/core/modules";

const integrationsModule = requireModule("integrations");

export default function IntegrationsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        actions={<StatusBadge status={integrationsModule.status} />}
        description={integrationsModule.summary}
        eyebrow="Platform"
        title="Integrations"
      />
      <EmptyState
        description="No provider is connected yet. OAuth setup should be added after Supabase authentication and hosted environments are ready."
        icon={<PlugZap aria-hidden="true" className="h-5 w-5" />}
        title="No integrations connected"
      />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plannedIntegrationProviders.map((provider) => (
          <article
            className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
            key={provider.provider}
          >
            <h2 className="text-base font-semibold text-stone-950">
              {provider.label}
            </h2>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              {provider.plannedScopes.join(", ")}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
