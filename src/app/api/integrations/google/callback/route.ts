import { NextResponse, type NextRequest } from "next/server";

import { getAppBaseUrl } from "@/platform/auth/config";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import { GOOGLE_USER_SCOPES } from "@/platform/integrations/google-workspace-scopes";

const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

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
  const expectedState = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  if (!state || !expectedState || state !== expectedState) {
    return new NextResponse("Google OAuth Error: invalid state", {
      status: 400,
    });
  }

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
    .select("organization_id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.organization_id) {
    return new NextResponse("No organization found for current user", {
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

    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const { data: existing } = await supabase
        .from("integration_connections")
        .select("encrypted_token_reference")
        .eq("organization_id", membership.organization_id)
        .eq("provider", "google")
        .eq("connected_by_profile_id", user.id)
        .maybeSingle();

      try {
        refreshToken = JSON.parse(
          existing?.encrypted_token_reference ?? "{}",
        ).refresh_token;
      } catch {
        refreshToken = undefined;
      }
    }

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
          scopes:
            typeof tokens.scope === "string"
              ? tokens.scope.split(" ")
              : [...GOOGLE_USER_SCOPES],
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
            }
            window.close();
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
