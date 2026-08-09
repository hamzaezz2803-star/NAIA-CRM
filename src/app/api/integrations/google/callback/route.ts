import { NextResponse, type NextRequest } from "next/server";

import { canUseMeetingNotesEmail } from "@/features/meeting-notes/access-policy";
import { getAppBaseUrl } from "@/platform/auth/config";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import {
  GOOGLE_MEETING_NOTE_SCOPE,
  GOOGLE_USER_SCOPES,
} from "@/platform/integrations/google-workspace-scopes";

const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";
const GOOGLE_OAUTH_USER_INTENT = "user";
const GOOGLE_OAUTH_MEETING_INTENT = "meeting-notes";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
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

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id,role")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.organization_id) {
    return new NextResponse("No organization found for current user", {
      status: 403,
    });
  }
  const isMeetingNotesFounder =
    membership.role === "owner" && canUseMeetingNotesEmail(user.email);
  if (meetingNotesIntent && !isMeetingNotesFounder) {
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
      const tokenError = await tokenResponse.text();
      return new NextResponse(`Failed to exchange code: ${tokenError}`, {
        status: 400,
      });
    }

    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!tokens.access_token || !tokens.expires_in) {
      return new NextResponse("Google returned an incomplete token response", {
        status: 400,
      });
    }

    const { data: existing } = await supabase
      .from("integration_connections")
      .select("encrypted_token_reference,scopes")
      .eq("organization_id", membership.organization_id)
      .eq("provider", "google")
      .eq("connected_by_profile_id", user.id)
      .maybeSingle();

    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      try {
        refreshToken = JSON.parse(
          existing?.encrypted_token_reference ?? "{}",
        ).refresh_token;
      } catch {
        refreshToken = undefined;
      }
    }

    const returnedScopes = parseScopes(tokens.scope);
    const existingScopes = Array.isArray(existing?.scopes)
      ? (existing.scopes as string[])
      : [];
    const candidateScopes = returnedScopes.length
      ? returnedScopes
      : existingScopes.length
        ? existingScopes
        : [...GOOGLE_USER_SCOPES];
    const hasUnexpectedDriveScope = candidateScopes.some(
      (scope) =>
        scope.startsWith("https://www.googleapis.com/auth/drive") &&
        scope !== GOOGLE_MEETING_NOTE_SCOPE,
    );
    if (hasUnexpectedDriveScope) {
      return new NextResponse("Google returned an unauthorized Drive scope", {
        status: 400,
      });
    }
    const existingMeetGrant = existingScopes.includes(
      GOOGLE_MEETING_NOTE_SCOPE,
    );
    const canPersistMeetGrant =
      isMeetingNotesFounder && (meetingNotesIntent || existingMeetGrant);
    if (
      candidateScopes.includes(GOOGLE_MEETING_NOTE_SCOPE) &&
      !canPersistMeetGrant
    ) {
      return new NextResponse("Google Meet scope escalation rejected", {
        status: 403,
      });
    }
    const persistedScopes = [
      ...new Set(
        candidateScopes.filter(
          (scope) => scope !== GOOGLE_MEETING_NOTE_SCOPE || canPersistMeetGrant,
        ),
      ),
    ];

    const tokenData = {
      access_token: tokens.access_token,
      expiry_date: Date.now() + tokens.expires_in * 1000,
      refresh_token: refreshToken,
    };

    const userResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );

    let externalAccountLabel = "Google Workspace Connection";
    if (userResponse.ok) {
      const googleUser = (await userResponse.json()) as { email?: string };
      if (googleUser.email) externalAccountLabel = googleUser.email;
    }

    const { error: databaseError } = await supabase
      .from("integration_connections")
      .upsert(
        {
          connected_at: new Date().toISOString(),
          connected_by_profile_id: user.id,
          encrypted_token_reference: JSON.stringify(tokenData),
          external_account_label: externalAccountLabel,
          organization_id: membership.organization_id,
          provider: "google",
          scopes: persistedScopes,
          status: "connected",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "organization_id,provider,connected_by_profile_id",
        },
      );

    if (databaseError) {
      return new NextResponse(
        `Database error saving connection: ${databaseError.message}`,
        { status: 500 },
      );
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new NextResponse(`OAuth Callback exception: ${message}`, {
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

function parseScopes(value?: string) {
  return [
    ...new Set(
      (value ?? "")
        .split(/\s+/u)
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ];
}
