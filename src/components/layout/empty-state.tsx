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
    <section className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center shadow-sm">
      {icon ? (
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-teal-50 text-teal-700">
          {icon}
        </div>
      ) : null}
      <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-stone-600">
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
