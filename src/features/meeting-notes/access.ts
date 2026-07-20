import "server-only";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

import { canUseMeetingNotesEmail } from "./access-policy";

export async function requireMeetingNotesAccess() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !canUseMeetingNotesEmail(user.email)) {
    throw new Error("Meeting Intelligence est réservé à Ali et Nabil.");
  }

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership?.organization_id || membership.role !== "owner") {
    throw new Error(
      "Meeting Intelligence nécessite un compte cofondateur owner.",
    );
  }

  return {
    organizationId: membership.organization_id as string,
    supabase,
    user,
  };
}
