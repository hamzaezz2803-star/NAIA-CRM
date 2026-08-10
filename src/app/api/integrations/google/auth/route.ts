import { NextResponse, type NextRequest } from "next/server";

import { requireMeetingNotesAccess } from "@/features/meeting-notes/access";
import { getAppBaseUrl } from "@/platform/auth/config";
import {
  GOOGLE_MEETING_NOTE_SCOPES,
  GOOGLE_USER_SCOPES,
} from "@/platform/integrations/google-workspace-scopes";

// Must match the cookie name checked by the sibling callback route. Route
// files may only export HTTP handlers, hence the local constant.
const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";
const GOOGLE_OAUTH_USER_INTENT = "user";
const GOOGLE_OAUTH_MEETING_INTENT = "meeting-notes";

// Secondary connect/reconnect flow, kept for users signed in via magic link.
// The primary path captures Google tokens directly at "Sign in with Google".
export async function GET(request?: NextRequest) {
  const intent = request
    ? new URL(request.url).searchParams.get("intent")
    : null;
  if (intent && intent !== "meeting-notes") {
    return new NextResponse("Google OAuth intent is invalid", { status: 400 });
  }
  if (intent === "meeting-notes") {
    try {
      await requireMeetingNotesAccess();
    } catch {
      return new NextResponse("Meeting Intelligence access required", {
        status: 403,
      });
    }
  }
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
  googleAuthUrl.searchParams.set(
    "scope",
    (intent === "meeting-notes"
      ? GOOGLE_MEETING_NOTE_SCOPES
      : GOOGLE_USER_SCOPES
    ).join(" "),
  );
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("include_granted_scopes", "true");
  googleAuthUrl.searchParams.set("prompt", "consent");
  googleAuthUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(googleAuthUrl.toString());
  response.cookies.set(
    GOOGLE_OAUTH_STATE_COOKIE,
    `${state}:${intent === "meeting-notes" ? GOOGLE_OAUTH_MEETING_INTENT : GOOGLE_OAUTH_USER_INTENT}`,
    {
      httpOnly: true,
      maxAge: 600,
      path: "/api/integrations/google",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );

  return response;
}
