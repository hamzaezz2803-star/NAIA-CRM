import { Badge } from "@/components/ui/badge";
import type { ModuleStatus } from "@/platform/core/modules";

const statusLabel: Record<ModuleStatus, string> = {
  guarded: "Guarded",
  live: "Live",
  "ready-for-build": "Ready for build",
};

const statusClassName: Record<ModuleStatus, string> = {
  guarded:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400",
  live: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400",
  "ready-for-build":
    "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900/30 dark:bg-teal-950/20 dark:text-teal-400",
};

export function StatusBadge({ status }: { status: ModuleStatus }) {
  return (
    <Badge className={statusClassName[status]}>{statusLabel[status]}</Badge>
  );
}
