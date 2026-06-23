import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 p-6">
      <EmptyState
        actions={
          <Link className={buttonVariants()} href="/dashboard">
            Go to dashboard
          </Link>
        }
        description="The requested Qarizmi OS route does not exist."
        title="Page not found"
      />
    </main>
  );
}
