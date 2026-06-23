import { ArrowRight, CheckCircle2, CircleDotDashed } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { platformFoundations } from "@/platform/core/foundations";
import { platformModules } from "@/platform/core/modules";

export default function DashboardPage() {
  const activeModules = platformModules.filter(
    (module) => module.status !== "planned",
  );

  return (
    <div className="space-y-8">
      <PageHeader
        description="The platform shell is ready for module work. Live operational metrics will appear only after real data sources and CRM records exist."
        eyebrow="Workspace"
        title="Dashboard"
      />

      <EmptyState
        description="There are no live CRM, finance, delivery, or activity metrics yet. The shell is intentionally waiting for real module data."
        icon={<CircleDotDashed aria-hidden="true" className="h-5 w-5" />}
        title="No operational metrics connected"
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-stone-950">
              Platform foundations
            </h2>
            <StatusBadge status="live" />
          </div>
          <div className="mt-5 space-y-4">
            {platformFoundations.map((foundation) => (
              <div className="flex gap-3" key={foundation.name}>
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 flex-none text-emerald-700"
                />
                <div>
                  <p className="text-sm font-medium text-stone-950">
                    {foundation.name}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    {foundation.summary}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-stone-950">
              Ready modules
            </h2>
            <span className="text-sm text-stone-500">
              {activeModules.length} active
            </span>
          </div>
          <div className="mt-5 divide-y divide-stone-200">
            {activeModules.map((module) => (
              <Link
                className="flex items-center justify-between gap-4 py-4 transition hover:text-teal-800"
                href={module.href}
                key={module.id}
              >
                <span>
                  <span className="block text-sm font-medium text-stone-950">
                    {module.name}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-stone-600">
                    {module.summary}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 flex-none text-stone-500"
                />
              </Link>
            ))}
          </div>
          <div className="mt-5">
            <Link
              className={buttonVariants({ variant: "outline" })}
              href="/crm"
            >
              Open CRM boundary
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
