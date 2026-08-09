import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { canUseMeetingNotesEmail } from "@/features/meeting-notes/access-policy";

import { GOOGLE_MEETING_NOTE_SCOPE } from "./google-workspace-scopes";

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
    .select("organization_id,role")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership?.organization_id) {
    return { error: "No organization membership for user.", saved: false };
  }

  const { data: existing } = await supabase
    .from("integration_connections")
    .select("encrypted_token_reference,scopes")
    .eq("organization_id", membership.organization_id)
    .eq("provider", "google")
    .eq("connected_by_profile_id", user.id)
    .maybeSingle();

  const grantedScopes = await resolveGrantedScopes(accessToken);
  if (!grantedScopes) {
    return {
      error: "Google token scopes could not be verified.",
      saved: false,
    };
  }
  const existingScopes = Array.isArray(existing?.scopes)
    ? (existing.scopes as string[])
    : [];
  const mayKeepExistingMeetGrant =
    membership.role === "owner" &&
    canUseMeetingNotesEmail(user.email) &&
    existingScopes.includes(GOOGLE_MEETING_NOTE_SCOPE);
  const hasForbiddenCurrentGrant = grantedScopes.some(
    (scope) =>
      scope.startsWith("https://www.googleapis.com/auth/drive") &&
      (scope !== GOOGLE_MEETING_NOTE_SCOPE || !mayKeepExistingMeetGrant),
  );
  if (hasForbiddenCurrentGrant) {
    return {
      error: "Google returned an unauthorized Drive scope.",
      saved: false,
    };
  }

  const existingCredentialMayBeBroad = existingScopes.some(
    (scope) =>
      scope.startsWith("https://www.googleapis.com/auth/drive") &&
      scope !== GOOGLE_MEETING_NOTE_SCOPE,
  );
  // Google only returns a refresh token on explicit consent. Keep an older
  // one only when its stored scope attestation is already narrow; otherwise
  // persisting it could re-mint a broader access token after expiry.
  const effectiveRefreshToken =
    refreshToken ??
    (existingCredentialMayBeBroad
      ? null
      : parseRefreshToken(existing?.encrypted_token_reference ?? null));

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
      scopes: [...new Set(grantedScopes)],
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
async function resolveGrantedScopes(
  accessToken: string,
): Promise<string[] | undefined> {
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
    return undefined;
  }
  return undefined;
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
