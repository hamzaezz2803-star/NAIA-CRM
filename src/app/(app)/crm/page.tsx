import { FileText, GitBranch, Handshake } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireModule } from "@/platform/core/modules";

const crmModule = requireModule("crm");

export default function CrmPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        actions={<StatusBadge status={crmModule.status} />}
        description={crmModule.summary}
        eyebrow="Module boundary"
        title="CRM"
      />

      <EmptyState
        actions={
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/crm/handoff"
          >
            Open CRM handoff
          </Link>
        }
        description="The route, shared contracts, navigation registration, and database foundation are ready. Hamza can implement CRM business screens inside the feature boundary without changing the shell."
        icon={<Handshake aria-hidden="true" className="h-5 w-5" />}
        title="Ready for Hamza's CRM Sprint 1"
      />

      <section className="grid gap-4 md:grid-cols-3">
        <BoundaryCard
          description="CRM-owned UI and domain code live under src/features/crm and src/app/(app)/crm."
          icon={<GitBranch aria-hidden="true" className="h-5 w-5" />}
          title="Owned folders"
        />
        <BoundaryCard
          description="Shared UI, module registry, permissions, and workflow contracts are consumed from platform packages."
          icon={<FileText aria-hidden="true" className="h-5 w-5" />}
          title="Shared contracts"
        />
        <BoundaryCard
          description="CRM events should publish organization-scoped domain events for future workflow triggers."
          icon={<Handshake aria-hidden="true" className="h-5 w-5" />}
          title="Event-ready"
        />
      </section>
    </div>
  );
}

function BoundaryCard({
  description,
  icon,
  title,
}: {
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
        {icon}
      </div>
      <h2 className="mt-4 text-base font-semibold text-stone-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
    </article>
  );
}
