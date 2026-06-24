import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import { getAppBaseUrl } from "@/platform/auth/config";

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

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new NextResponse("Google OAuth credentials missing on server", {
      status: 500,
    });
  }

  // Get current session and user details
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

  // Get current user's organization
  const { data: membership, error: memError } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", user.id)
    .limit(1)
    .single();

  if (memError || !membership) {
    return new NextResponse("No organization found for current user", {
      status: 403,
    });
  }

  const orgId = membership.organization_id;

  try {
    const redirectUri = `${getAppBaseUrl()}/api/integrations/google/callback`;

    // Exchange auth code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const tokenErrText = await tokenRes.text();
      return new NextResponse(`Failed to exchange code: ${tokenErrText}`, {
        status: 400,
      });
    }

    const tokens = await tokenRes.json();
    // Expiry time in epoch timestamp
    const expiryDate = Date.now() + tokens.expires_in * 1000;
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: expiryDate,
    };

    // Get user info from Google to display account label (email)
    const userRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      },
    );

    let externalAccountLabel = "Google Workspace Connection";
    if (userRes.ok) {
      const googleUser = await userRes.json();
      if (googleUser.email) {
        externalAccountLabel = googleUser.email;
      }
    }

    // Insert or update integration connection in database
    const { error: dbError } = await supabase
      .from("integration_connections")
      .upsert(
        {
          organization_id: orgId,
          provider: "google",
          status: "connected",
          external_account_label: externalAccountLabel,
          scopes: [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/calendar.events",
          ],
          encrypted_token_reference: JSON.stringify(tokenData),
          connected_by_profile_id: user.id,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "organization_id,provider,external_account_label",
        },
      );

    if (dbError) {
      return new NextResponse(
        `Database error saving connection: ${dbError.message}`,
        { status: 500 },
      );
    }

    // Success response - popup will close and message parent page
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>Google Authentication Success</title>
        </head>
        <body>
          <p>Authentication successful. You can close this window now.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
            }
            window.close();
          </script>
        </body>
      </html>`,
      {
        headers: {
          "Content-Type": "text/html",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new NextResponse(`OAuth Callback exception: ${msg}`, {
      status: 500,
    });
  }
}
