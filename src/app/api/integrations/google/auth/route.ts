import { NextResponse } from "next/server";
import { getAppBaseUrl } from "@/platform/auth/config";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new NextResponse("Google client ID not configured", { status: 500 });
  }

  const redirectUri = `${getAppBaseUrl()}/api/integrations/google/callback`;
  const scope =
    "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy";

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("scope", scope);
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent");

  return NextResponse.redirect(googleAuthUrl.toString());
}
