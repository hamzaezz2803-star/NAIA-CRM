import type { ReactNode } from "react";

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header
      className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between"
      style={{ borderColor: "var(--maison-border)" }}
    >
      <div className="max-w-3xl">
        {eyebrow ? (
          <p
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--maison-brass)" }}
          >
            {eyebrow}
          </p>
        ) : null}
        <h1
          className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl"
          style={{ color: "var(--maison-text-primary)" }}
        >
          {title}
        </h1>
        {description ? (
          <p
            className="mt-2 text-xs md:text-sm leading-relaxed"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
