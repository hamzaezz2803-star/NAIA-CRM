import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { GOOGLE_USER_SCOPES } from "./google-workspace-scopes";

// Persists the Google provider tokens returned by Supabase Auth at sign-in as
// the user's own integration connection. Supabase does not store Google
// refresh tokens, so the auth callback is the only chance to capture them.
export async function saveGoogleConnectionFromLogin({
  accessToken,
  refreshToken,
  supabase,
  user,
}: {
  accessToken: string;
  refreshToken?: string | null;
  supabase: SupabaseClient;
  user: User;
}): Promise<{ error?: string; saved: boolean }> {
  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership?.organization_id) {
    return { error: "No organization membership for user.", saved: false };
  }

  // Google only returns a refresh token on explicit consent. Keep the one we
  // already have when this sign-in did not mint a new one.
  let effectiveRefreshToken = refreshToken ?? null;
  if (!effectiveRefreshToken) {
    const { data: existing } = await supabase
      .from("integration_connections")
      .select("encrypted_token_reference")
      .eq("organization_id", membership.organization_id)
      .eq("provider", "google")
      .eq("connected_by_profile_id", user.id)
      .maybeSingle();

    effectiveRefreshToken = parseRefreshToken(
      existing?.encrypted_token_reference ?? null,
    );
  }

  const grantedScopes = await resolveGrantedScopes(accessToken);

  const { error } = await supabase.from("integration_connections").upsert(
    {
      connected_at: new Date().toISOString(),
      connected_by_profile_id: user.id,
      encrypted_token_reference: JSON.stringify({
        access_token: accessToken,
        expiry_date: Date.now() + 3500 * 1000,
        refresh_token: effectiveRefreshToken ?? undefined,
      }),
      external_account_label: user.email ?? "Google Workspace Connection",
      organization_id: membership.organization_id,
      provider: "google",
      scopes: grantedScopes,
      status: "connected",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,provider,connected_by_profile_id" },
  );

  if (error) {
    return { error: error.message, saved: false };
  }

  return { saved: true };
}

// The user can deny individual scopes on the consent screen; readiness must
// see what was actually granted, not what was requested.
async function resolveGrantedScopes(accessToken: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (response.ok) {
      const payload = (await response.json()) as { scope?: string };
      if (payload.scope) {
        return payload.scope.split(" ");
      }
    }
  } catch {
    // fall through to the requested list
  }

  return [...GOOGLE_USER_SCOPES];
}

function parseRefreshToken(tokenReference: string | null) {
  if (!tokenReference) return null;

  try {
    const parsed = JSON.parse(tokenReference) as { refresh_token?: string };
    return parsed.refresh_token ?? null;
  } catch {
    return null;
  }
}
