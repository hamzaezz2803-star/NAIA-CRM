import { NextResponse, type NextRequest } from "next/server";

import { canUseMeetingNotesEmail } from "@/features/meeting-notes/access-policy";
import { getAppBaseUrl } from "@/platform/auth/config";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import { resolveGoogleCredentialActorFromSession } from "@/platform/integrations/google-credential-boundary";
import { attestGoogleAccessToken } from "@/platform/integrations/google-token-attestation";
import { attestGoogleScopes } from "@/platform/integrations/google-workspace-scopes";

const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";
const GOOGLE_OAUTH_USER_INTENT = "user";
const GOOGLE_OAUTH_MEETING_INTENT = "meeting-notes";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
};

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const errorParam = requestUrl.searchParams.get("error");

  if (errorParam || !code) {
    return new NextResponse(
      `Google OAuth Error: ${errorParam || "Missing code"}`,
      { status: 400 },
    );
  }

  const state = requestUrl.searchParams.get("state");
  const stateBinding = parseStateBinding(
    request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value,
  );
  if (!state || !stateBinding || state !== stateBinding.state) {
    return new NextResponse("Google OAuth Error: invalid state", {
      status: 400,
    });
  }
  const meetingNotesIntent =
    stateBinding.intent === GOOGLE_OAUTH_MEETING_INTENT;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new NextResponse("Google OAuth credentials missing on server", {
      status: 500,
    });
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return new NextResponse("Not authenticated", { status: 401 });
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return new NextResponse("Not authenticated", { status: 401 });
  }

  let actor;
  try {
    actor = await resolveGoogleCredentialActorFromSession({
      expectedProfileId: user.id,
      supabase,
    });
  } catch {
    return new NextResponse("No organization found for current user", {
      status: 403,
    });
  }
  const canUseMeetingNotes = canUseMeetingNotesEmail(user.email);
  if (meetingNotesIntent && !canUseMeetingNotes) {
    return new NextResponse("Meeting Intelligence access required", {
      status: 403,
    });
  }

  try {
    const appBaseUrl = getAppBaseUrl();
    const redirectUri = `${appBaseUrl}/api/integrations/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    if (!tokenResponse.ok) {
      return new NextResponse("Failed to exchange Google OAuth code", {
        status: 400,
      });
    }

    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!tokens.access_token || !tokens.expires_in) {
      return new NextResponse("Google returned an incomplete token response", {
        status: 400,
      });
    }

    const { data: existing, error: existingError } =
      await actor.credentialClient
        .from("integration_connections")
        .select("id,status,encrypted_token_reference,scopes")
        .eq("organization_id", actor.organizationId)
        .eq("provider", "google")
        .eq("connected_by_profile_id", actor.profileId)
        .maybeSingle();
    if (existingError) {
      return new NextResponse("Google connection could not be loaded", {
        status: 500,
      });
    }

    const intent = meetingNotesIntent ? "meeting-notes" : "user";
    const attestation = await attestGoogleAccessToken({
      accessToken: tokens.access_token,
      intent,
    });
    if (!attestation.ok) {
      const quarantined = await persistConnection({
        accessToken: tokens.access_token,
        actor,
        externalAccountLabel: user.email ?? "Google Workspace Connection",
        reviewReason: "scope-attestation-failed",
        refreshToken:
          tokens.refresh_token ??
          parseRefreshToken(existing?.encrypted_token_reference ?? null),
        scopes: attestation.scopes,
        status: "needs-review",
      });
      if (!quarantined) {
        return new NextResponse("Google connection quarantine failed", {
          status: 500,
        });
      }
      return new NextResponse("Google returned unauthorized OAuth scopes", {
        status: meetingNotesIntent && !canUseMeetingNotes ? 403 : 400,
      });
    }

    const existingScopes = Array.isArray(existing?.scopes)
      ? (existing.scopes as string[])
      : [];
    const existingAttestation = attestGoogleScopes(existingScopes, intent);
    let refreshToken = tokens.refresh_token;
    if (
      !refreshToken &&
      existing?.status === "connected" &&
      existingAttestation.ok
    ) {
      refreshToken =
        parseRefreshToken(existing.encrypted_token_reference) ?? undefined;
    }

    const identityResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );

    let externalAccountLabel = "Google Workspace Connection";
    if (identityResponse.ok) {
      try {
        const googleProfile = (await identityResponse.json()) as {
          emailAddress?: string;
        };
        if (googleProfile.emailAddress) {
          externalAccountLabel = googleProfile.emailAddress;
        }
      } catch {
        // An invalid identity response is handled by the exact binding check.
      }
    }

    const sessionEmail = normalizeGoogleEmail(user.email);
    const googleEmail = normalizeGoogleEmail(externalAccountLabel);
    if (
      !identityResponse.ok ||
      !sessionEmail ||
      !googleEmail ||
      googleEmail !== sessionEmail
    ) {
      const quarantined = await persistConnection({
        accessToken: tokens.access_token,
        actor,
        externalAccountLabel,
        refreshToken:
          tokens.refresh_token ??
          parseRefreshToken(existing?.encrypted_token_reference ?? null),
        reviewReason: "identity-attestation-failed",
        scopes: attestation.scopes,
        status: "needs-review",
      });
      if (!quarantined) {
        return new NextResponse("Google connection quarantine failed", {
          status: 500,
        });
      }
      return new NextResponse(
        "Google account does not match the authenticated account",
        { status: 400 },
      );
    }

    const saved = await persistConnection({
      accessToken: tokens.access_token,
      actor,
      externalAccountLabel,
      reviewReason: null,
      refreshToken,
      scopes: attestation.scopes,
      status: "connected",
    });
    if (!saved) {
      return new NextResponse("Database error saving connection", {
        status: 500,
      });
    }

    const successResponse = new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Google Authentication Success</title></head>
        <body>
          <p>Authentication successful. You can close this window now.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage(
                { type: 'GOOGLE_AUTH_SUCCESS', email: ${JSON.stringify(externalAccountLabel)} },
                ${JSON.stringify(appBaseUrl)}
              );
              window.close();
            } else {
              window.location.replace(
                ${JSON.stringify(`${appBaseUrl}${meetingNotesIntent ? "/meetings" : "/integrations"}`)}
              );
            }
          </script>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html" } },
    );
    successResponse.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/api/integrations/google",
    });

    return successResponse;
  } catch {
    return new NextResponse("OAuth Callback exception", {
      status: 500,
    });
  }
}

function parseStateBinding(value?: string) {
  if (!value) return undefined;
  const separator = value.lastIndexOf(":");
  if (separator <= 0) return undefined;
  const state = value.slice(0, separator);
  const intent = value.slice(separator + 1);
  if (
    !state ||
    ![GOOGLE_OAUTH_USER_INTENT, GOOGLE_OAUTH_MEETING_INTENT].includes(intent)
  ) {
    return undefined;
  }
  return { intent, state };
}

function parseRefreshToken(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { refresh_token?: unknown };
    return typeof parsed.refresh_token === "string"
      ? parsed.refresh_token
      : null;
  } catch {
    return null;
  }
}

function normalizeGoogleEmail(value?: string | null) {
  return value?.trim().toLocaleLowerCase("en") ?? "";
}

async function persistConnection({
  accessToken,
  actor,
  externalAccountLabel,
  reviewReason,
  refreshToken,
  scopes,
  status,
}: {
  accessToken: string;
  actor: Awaited<ReturnType<typeof resolveGoogleCredentialActorFromSession>>;
  externalAccountLabel: string;
  reviewReason:
    "identity-attestation-failed" | "scope-attestation-failed" | null;
  refreshToken?: string | null;
  scopes: string[];
  status: "connected" | "needs-review";
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
          expiry_date: Date.now() + 3_500_000,
          refresh_token: refreshToken ?? undefined,
        }),
        external_account_label: externalAccountLabel,
        organization_id: actor.organizationId,
        provider: "google",
        scopes,
        server_review_reason: status === "connected" ? null : reviewReason,
        status,
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
    data.status === status
  );
}
