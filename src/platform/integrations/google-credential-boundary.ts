import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  createServerSupabaseClient,
  createServiceRoleSupabaseClient,
} from "@/platform/auth/supabase-server";

export type GoogleWorkspaceContext = {
  organizationId: string;
  profileId: string;
  supabase: SupabaseClient;
};

export type GoogleCredentialActor = {
  credentialClient: SupabaseClient;
  organizationId: string;
  profileId: string;
  role: string;
  user?: User;
};

export async function resolveGoogleCredentialActor(
  context?: GoogleWorkspaceContext,
): Promise<GoogleCredentialActor> {
  if (!context) return resolveGoogleCredentialActorFromSession();
  if (
    !context.organizationId ||
    !context.profileId ||
    typeof context.supabase?.from !== "function"
  ) {
    throw new Error("Google Workspace actor context is invalid.");
  }

  const { data: membership, error } = await context.supabase
    .from("organization_memberships")
    .select("organization_id,profile_id,role")
    .eq("organization_id", context.organizationId)
    .eq("profile_id", context.profileId)
    .maybeSingle();
  if (
    error ||
    !membership ||
    membership.organization_id !== context.organizationId ||
    membership.profile_id !== context.profileId
  ) {
    throw new Error(
      "Google Workspace requires an exact organization membership.",
    );
  }

  return {
    credentialClient: requireServiceRoleClient(),
    organizationId: context.organizationId,
    profileId: context.profileId,
    role: String(membership.role ?? "member"),
  };
}

export async function resolveGoogleCredentialActorFromSession({
  expectedProfileId,
  supabase: suppliedSupabase,
}: {
  expectedProfileId?: string;
  supabase?: SupabaseClient | null;
} = {}): Promise<GoogleCredentialActor> {
  const supabase = suppliedSupabase ?? (await createServerSupabaseClient());
  if (!supabase) {
    throw new Error("Google Workspace requires an authenticated session.");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (
    userError ||
    !user ||
    (expectedProfileId && user.id !== expectedProfileId)
  ) {
    throw new Error("Google Workspace requires an authenticated session.");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id,profile_id,role")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();
  if (
    membershipError ||
    !membership?.organization_id ||
    membership.profile_id !== user.id
  ) {
    throw new Error("Google Workspace requires an organization membership.");
  }

  return {
    credentialClient: requireServiceRoleClient(),
    organizationId: membership.organization_id as string,
    profileId: user.id,
    role: String(membership.role ?? "member"),
    user,
  };
}

function requireServiceRoleClient() {
  const client = createServiceRoleSupabaseClient();
  if (!client) {
    throw new Error("Google Workspace credential service is unavailable.");
  }
  return client;
}
