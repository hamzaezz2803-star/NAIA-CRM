import "server-only";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import {
  canTriggerMayaPitchGenerationRole,
  canUseMayaPitchGeneratorEmail,
} from "./access-policy";

export async function requireMayaPitchGeneratorAccess() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !canUseMayaPitchGeneratorEmail(user.email)) {
    throw new Error("Maya pitch generator requires a signed-in user.");
  }

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership?.organization_id) {
    throw new Error(
      "Maya pitch generator requires an organization membership.",
    );
  }

  return {
    organizationId: membership.organization_id as string,
    role: membership.role as string,
    supabase,
    user,
  };
}

/**
 * Gate for the Drive-writing action itself: cloning is never automatic and
 * requires a recognized organization role.
 */
export async function requireMayaPitchGenerationAccess() {
  const access = await requireMayaPitchGeneratorAccess();

  if (!canTriggerMayaPitchGenerationRole(access.role)) {
    throw new Error(
      "La génération de pitch Maya nécessite un rôle reconnu dans l'organisation.",
    );
  }

  return access;
}
