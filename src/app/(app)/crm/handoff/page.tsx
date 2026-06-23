import { ArrowRight, BookOpenText } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";

const sprintItems = [
  "Company, contact, lead, activity, task, and document records",
  "Kanban pipeline with the agreed lead statuses",
  "Lead detail page and next-action fields",
  "Add Lead Assistant, Follow-up Generator, and Drive Folder Creator behind approval-aware boundaries",
];

export default function CrmHandoffPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        description="Developer-facing CRM integration boundary for Hamza's Sprint 1."
        eyebrow="CRM"
        title="Handoff"
      />

      <EmptyState
        actions={
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/dashboard"
          >
            Back to dashboard
          </Link>
        }
        description="The canonical handoff lives in docs/crm-handoff.md. Keep that document updated when CRM contracts, routes, migrations, or shared platform APIs change."
        icon={<BookOpenText aria-hidden="true" className="h-5 w-5" />}
        title="Documentation path: docs/crm-handoff.md"
      />

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-stone-950">
          Sprint 1 implementation scope
        </h2>
        <div className="mt-5 space-y-4">
          {sprintItems.map((item) => (
            <div className="flex gap-3" key={item}>
              <ArrowRight
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 flex-none text-teal-700"
              />
              <p className="text-sm leading-6 text-stone-700">{item}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
