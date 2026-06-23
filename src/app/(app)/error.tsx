"use client";

import { AlertTriangle } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <EmptyState
      actions={<Button onClick={reset}>Retry</Button>}
      description={
        error.digest
          ? `The page failed to load. Error reference: ${error.digest}.`
          : "The page failed to load. Please retry the request."
      }
      icon={<AlertTriangle aria-hidden="true" className="h-5 w-5" />}
      title="Something went wrong"
    />
  );
}
