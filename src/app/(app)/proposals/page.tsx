import { redirect } from "next/navigation";

import { fetchMayaPitchQueueAction } from "@/features/maya/actions";
import { MayaPitchQueue } from "@/features/maya/maya-pitch-queue";
import { getAppSession } from "@/platform/auth/session";
import { hasPermission } from "@/platform/core/permissions";

export default async function ProposalsPage() {
  // Maya's outputs live in the cofounders-only shared drive: owner-only.
  const session = await getAppSession();
  if (
    !hasPermission(session.user.role, { module: "proposals", action: "read" })
  ) {
    redirect("/dashboard");
  }

  const result = await fetchMayaPitchQueueAction();

  return <MayaPitchQueue result={result} />;
}
