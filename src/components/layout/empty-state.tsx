import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className="rounded-xl border border-dashed p-8 text-center shadow-xs transition-all"
      style={{
        background: "var(--maison-card)",
        borderColor: "var(--maison-border)",
      }}
    >
      {icon ? (
        <div
          className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg shadow-2xs"
          style={{
            background: "rgba(176,141,79,0.12)",
            color: "var(--maison-brass)",
          }}
        >
          {icon}
        </div>
      ) : null}
      <h2
        className="text-lg font-semibold tracking-tight"
        style={{
          fontFamily: "var(--font-playfair), Georgia, serif",
          color: "var(--maison-text-primary)",
        }}
      >
        {title}
      </h2>
      <p
        className="mx-auto mt-2 max-w-2xl text-xs sm:text-sm leading-relaxed"
        style={{ color: "var(--maison-text-secondary)" }}
      >
        {description}
      </p>
      {actions ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      ) : null}
    </section>
  );
}
