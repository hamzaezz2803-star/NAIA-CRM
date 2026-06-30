import { Badge } from "@/components/ui/badge";
import type { ModuleStatus } from "@/platform/core/modules";

const statusLabel: Record<ModuleStatus, string> = {
  live: "Live",
  "ready-for-build": "Ready for build",
  planned: "Planned",
};

const statusClassName: Record<ModuleStatus, string> = {
  live: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400",
  "ready-for-build":
    "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900/30 dark:bg-teal-950/20 dark:text-teal-400",
  planned:
    "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400",
};

export function StatusBadge({ status }: { status: ModuleStatus }) {
  return (
    <Badge className={statusClassName[status]}>{statusLabel[status]}</Badge>
  );
}
