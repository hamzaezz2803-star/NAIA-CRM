import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-[var(--maison-sidebar)] text-white shadow-2xs hover:opacity-90 active:scale-98 dark:bg-stone-50 dark:text-stone-950",
  secondary:
    "border-[var(--maison-border)] bg-[var(--maison-card)] text-[var(--maison-text-primary)] shadow-2xs hover:bg-[var(--maison-page)] dark:bg-stone-900 dark:text-stone-100",
  ghost:
    "border-transparent bg-transparent text-[var(--maison-text-secondary)] hover:bg-[rgba(176,141,79,0.06)] hover:text-[var(--maison-text-primary)]",
  outline:
    "border-[var(--maison-border)] bg-transparent text-[var(--maison-text-primary)] hover:bg-[rgba(176,141,79,0.05)]",
};

export function buttonVariants({
  variant = "primary",
  className,
}: {
  variant?: ButtonVariant;
  className?: string;
} = {}) {
  return cn(
    "inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold uppercase tracking-wider transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b08d4f] disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    className,
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      className={buttonVariants({ variant, className })}
      type={props.type ?? "button"}
      {...props}
    />
  );
}
