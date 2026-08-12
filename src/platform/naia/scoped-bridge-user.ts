import "server-only";

import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";
import type { OrganizationRole } from "@/platform/core/permissions";
import type { NaiaBridgeUser } from "@/platform/naia/bridge";

const organizationRoles: readonly OrganizationRole[] = [
  "owner",
  "admin",
  "member",
  "viewer",
];

export async function resolveScopedBridgeUser({
  email,
  organizationId,
  profileId,
}: {
  email: string;
  organizationId: string;
  profileId: string;
}): Promise<NaiaBridgeUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedOrganizationId = organizationId.trim();
  const normalizedProfileId = profileId.trim();
  if (!normalizedEmail || !normalizedOrganizationId || !normalizedProfileId) {
    return null;
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) throw new Error("scoped_bridge_unavailable");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", normalizedProfileId)
    .ilike("email", escapePostgrestLike(normalizedEmail))
    .maybeSingle();
  if (profileError) {
    throw new Error("scoped_bridge_profile_lookup_failed", {
      cause: profileError,
    });
  }
  if (!profile?.id) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("profile_id", normalizedProfileId)
    .eq("organization_id", normalizedOrganizationId)
    .maybeSingle();
  const role = membership?.role as OrganizationRole | undefined;
  if (membershipError) {
    throw new Error("scoped_bridge_membership_lookup_failed", {
      cause: membershipError,
    });
  }
  if (!role || !organizationRoles.includes(role)) {
    return null;
  }

  return {
    email: profile.email ?? normalizedEmail,
    fullName: profile.full_name ?? normalizedEmail.split("@")[0],
    organizationId: normalizedOrganizationId,
    profileId: profile.id,
    role,
  };
}

export async function resolveOwnerBridgeUserByEmail(
  email: string,
): Promise<NaiaBridgeUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) throw new Error("owner_bridge_unavailable");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .ilike("email", escapePostgrestLike(normalizedEmail))
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (profileError) {
    throw new Error("owner_bridge_profile_lookup_failed", {
      cause: profileError,
    });
  }
  if (!profile?.id) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id,role")
    .eq("profile_id", profile.id)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .order("organization_id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError) {
    throw new Error("owner_bridge_membership_lookup_failed", {
      cause: membershipError,
    });
  }
  if (!membership?.organization_id || membership.role !== "owner") return null;

  return {
    email: profile.email ?? normalizedEmail,
    fullName: profile.full_name ?? normalizedEmail.split("@")[0],
    organizationId: membership.organization_id,
    profileId: profile.id,
    role: "owner",
  };
}

function escapePostgrestLike(value: string) {
  return value.replace(/([%_\\])/g, "\\$1");
}
