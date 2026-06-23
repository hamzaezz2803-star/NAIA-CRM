import { Construction } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireModule, type PlatformModuleId } from "@/platform/core/modules";

export function ModulePlaceholderPage({
  moduleId,
  detail,
}: {
  moduleId: PlatformModuleId;
  detail?: string;
}) {
  const platformModule = requireModule(moduleId);

  return (
    <div className="space-y-8">
      <PageHeader
        actions={<StatusBadge status={platformModule.status} />}
        description={platformModule.summary}
        eyebrow="Module"
        title={platformModule.name}
      />
      <EmptyState
        description={
          detail ??
          "This module is intentionally empty while the platform shell and shared foundations are being established."
        }
        icon={<Construction aria-hidden="true" className="h-5 w-5" />}
        title={`${platformModule.name} is not implemented yet`}
      />
    </div>
  );
}
