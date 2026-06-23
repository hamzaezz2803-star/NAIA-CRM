import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export function Badge({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-stone-200 bg-white px-2 py-1 text-xs font-medium text-stone-700 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
