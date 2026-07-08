import { NextResponse } from "next/server";
import { getAppBaseUrl } from "@/platform/auth/config";
import { GOOGLE_USER_SCOPE } from "@/platform/integrations/google-workspace-scopes";

// Must match the cookie name checked by the sibling callback route. Route
// files may only export HTTP handlers, hence the local constant.
const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

// Secondary connect/reconnect flow, kept for users signed in via magic link.
// The primary path captures Google tokens directly at "Sign in with Google".
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new NextResponse("Google client ID not configured", { status: 500 });
  }

  const redirectUri = `${getAppBaseUrl()}/api/integrations/google/callback`;
  const state = crypto.randomUUID();

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("scope", GOOGLE_USER_SCOPE);
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent");
  googleAuthUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(googleAuthUrl.toString());
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 600,
    path: "/api/integrations/google",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
