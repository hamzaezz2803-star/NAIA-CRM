import { NextResponse, type NextRequest } from "next/server";

import { isAuthorizedUser } from "@/platform/auth/access";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeRedirectPath(requestUrl.searchParams.get("next"));
  const supabase = await createServerSupabaseClient();

  if (!code || !supabase) {
    return redirectToLogin(request, "invalid-link", next);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectToLogin(request, "invalid-link", next);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAuthorizedUser(user)) {
    await supabase.auth.signOut();
    return redirectToLogin(request, "unauthorized", next);
  }

  return NextResponse.redirect(new URL(next, request.url), {
    status: 303,
  });
}

function redirectToLogin(request: NextRequest, error: string, next: string) {
  const loginUrl = new URL("/login", request.url);

  loginUrl.searchParams.set("error", error);

  if (next !== "/dashboard") {
    loginUrl.searchParams.set("redirectedFrom", next);
  }

  return NextResponse.redirect(loginUrl, {
    status: 303,
  });
}
