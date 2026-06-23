import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-stone-950 text-white shadow-sm hover:bg-stone-800",
  secondary:
    "border-transparent bg-white text-stone-900 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50",
  ghost:
    "border-transparent bg-transparent text-stone-700 hover:bg-stone-100 hover:text-stone-950",
  outline:
    "border-stone-300 bg-transparent text-stone-800 hover:bg-stone-100 hover:text-stone-950",
};

export function buttonVariants({
  variant = "primary",
  className,
}: {
  variant?: ButtonVariant;
  className?: string;
} = {}) {
  return cn(
    "inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
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
