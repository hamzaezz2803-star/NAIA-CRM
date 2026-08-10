import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { resolveGoogleCredentialActorFromSession } from "./google-credential-boundary";
import { attestGoogleAccessToken } from "./google-token-attestation";
import { attestGoogleScopes } from "./google-workspace-scopes";

type ExistingGoogleConnection = {
  encrypted_token_reference: string | null;
  id: string;
  scopes: string[] | null;
  status: string;
};

// Persists provider tokens returned by Supabase Auth. Authentication and
// membership are re-resolved through the cookie client; credential reads and
// writes then cross the explicit service-role boundary.
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
  let actor;
  try {
    actor = await resolveGoogleCredentialActorFromSession({
      expectedProfileId: user.id,
      supabase,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Google Workspace identity could not be verified.",
      saved: false,
    };
  }

  const existingResult = await actor.credentialClient
    .from("integration_connections")
    .select("id,status,scopes,encrypted_token_reference")
    .eq("organization_id", actor.organizationId)
    .eq("provider", "google")
    .eq("connected_by_profile_id", actor.profileId)
    .maybeSingle();
  if (existingResult.error) {
    return { error: "Google connection could not be loaded.", saved: false };
  }
  const existing = existingResult.data as ExistingGoogleConnection | null;

  const attestation = await attestGoogleAccessToken({
    accessToken,
    intent: "user",
  });
  if (!attestation.ok) {
    const quarantined = await quarantineProviderCredential({
      accessToken,
      actor,
      reviewReason: "scope-attestation-failed",
      refreshToken:
        refreshToken ??
        parseRefreshToken(existing?.encrypted_token_reference ?? null),
      scopes: attestation.scopes,
    });
    if (!quarantined) {
      return {
        error: "Google connection quarantine could not be saved.",
        saved: false,
      };
    }
    return {
      error: "Google token scopes could not be safely attested.",
      saved: false,
    };
  }

  const googleAccountEmail = await readGoogleAccountEmail(accessToken);
  const sessionEmail = normalizeGoogleEmail(actor.user?.email ?? user.email);
  if (
    !googleAccountEmail ||
    !sessionEmail ||
    normalizeGoogleEmail(googleAccountEmail) !== sessionEmail
  ) {
    const quarantined = await quarantineProviderCredential({
      accessToken,
      actor,
      externalAccountLabel:
        googleAccountEmail ??
        actor.user?.email ??
        "Google Workspace Connection",
      reviewReason: "identity-attestation-failed",
      refreshToken:
        refreshToken ??
        parseRefreshToken(existing?.encrypted_token_reference ?? null),
      scopes: attestation.scopes,
    });
    return quarantined
      ? {
          error: "Google account does not match the authenticated account.",
          saved: false,
        }
      : {
          error: "Google connection quarantine could not be saved.",
          saved: false,
        };
  }

  const existingAttestation = attestGoogleScopes(existing?.scopes, "user");
  const effectiveRefreshToken =
    refreshToken ??
    (existing?.status === "connected" && existingAttestation.ok
      ? parseRefreshToken(existing.encrypted_token_reference)
      : null);
  const now = new Date().toISOString();
  const tokenReference = JSON.stringify({
    access_token: accessToken,
    expiry_date: Date.now() + 3500 * 1000,
    refresh_token: effectiveRefreshToken ?? undefined,
  });
  const externalAccountLabel =
    googleAccountEmail ??
    actor.user?.email ??
    user.email ??
    "Google Workspace Connection";

  const { data: saved, error } = await actor.credentialClient
    .from("integration_connections")
    .upsert(
      {
        connected_at: now,
        connected_by_profile_id: actor.profileId,
        encrypted_token_reference: tokenReference,
        external_account_label: externalAccountLabel,
        organization_id: actor.organizationId,
        provider: "google",
        scopes: attestation.scopes,
        server_review_reason: null,
        status: "connected",
        updated_at: now,
      },
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    )
    .select("id,organization_id,provider,connected_by_profile_id,status")
    .maybeSingle();

  if (
    error ||
    !saved ||
    saved.organization_id !== actor.organizationId ||
    saved.provider !== "google" ||
    saved.connected_by_profile_id !== actor.profileId ||
    saved.status !== "connected"
  ) {
    return { error: "Google connection could not be saved.", saved: false };
  }

  return { saved: true };
}

async function quarantineProviderCredential({
  accessToken,
  actor,
  externalAccountLabel,
  reviewReason,
  refreshToken,
  scopes,
}: {
  accessToken: string;
  actor: Awaited<ReturnType<typeof resolveGoogleCredentialActorFromSession>>;
  externalAccountLabel?: string;
  reviewReason: "identity-attestation-failed" | "scope-attestation-failed";
  refreshToken?: string | null;
  scopes: string[];
}) {
  const now = new Date().toISOString();
  const { data, error } = await actor.credentialClient
    .from("integration_connections")
    .upsert(
      {
        connected_at: now,
        connected_by_profile_id: actor.profileId,
        encrypted_token_reference: JSON.stringify({
          access_token: accessToken,
          expiry_date: Date.now() + 3500 * 1000,
          refresh_token: refreshToken ?? undefined,
        }),
        external_account_label:
          externalAccountLabel ??
          actor.user?.email ??
          "Google Workspace Connection",
        organization_id: actor.organizationId,
        provider: "google",
        scopes,
        server_review_reason: reviewReason,
        status: "needs-review",
        updated_at: now,
      },
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    )
    .select("id,organization_id,provider,connected_by_profile_id,status")
    .maybeSingle();

  return (
    !error &&
    data?.organization_id === actor.organizationId &&
    data.provider === "google" &&
    data.connected_by_profile_id === actor.profileId &&
    data.status === "needs-review"
  );
}

async function readGoogleAccountEmail(accessToken: string) {
  try {
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { emailAddress?: unknown };
    return typeof payload.emailAddress === "string"
      ? payload.emailAddress
      : null;
  } catch {
    return null;
  }
}

function normalizeGoogleEmail(value?: string | null) {
  return value?.trim().toLocaleLowerCase("en") ?? "";
}

function parseRefreshToken(tokenReference: string | null) {
  if (!tokenReference) return null;

  try {
    const parsed = JSON.parse(tokenReference) as { refresh_token?: unknown };
    return typeof parsed.refresh_token === "string"
      ? parsed.refresh_token
      : null;
  } catch {
    return null;
  }
}
