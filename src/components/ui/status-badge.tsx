import type { ModuleStatus } from "@/platform/core/modules";

const statusLabel: Record<ModuleStatus, string> = {
  guarded: "Guarded",
  live: "Live",
  "ready-for-build": "Ready for build",
};

export function StatusBadge({ status }: { status: ModuleStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-bold tracking-wide shadow-2xs"
      style={
        status === "live"
          ? {
              background: "rgba(16, 185, 129, 0.10)",
              borderColor: "rgba(16, 185, 129, 0.25)",
              color: "#047857",
            }
          : status === "guarded"
            ? {
                background: "rgba(176, 141, 79, 0.10)",
                borderColor: "var(--maison-border)",
                color: "var(--maison-brass)",
              }
            : {
                background: "rgba(14, 165, 233, 0.10)",
                borderColor: "rgba(14, 165, 233, 0.25)",
                color: "#0369a1",
              }
      }
    >
      ● {statusLabel[status]}
    </span>
  );
}
