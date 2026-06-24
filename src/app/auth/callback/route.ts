import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isAuthorizedUser } from "@/platform/auth/access";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { getPublicEnv, getSupabasePublicKey } from "@/platform/auth/config";

export async function GET(request: NextRequest) {
  console.log("[auth-callback] Received request:", request.url);
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeRedirectPath(requestUrl.searchParams.get("next"));

  const env = getPublicEnv();
  const supabasePublicKey = getSupabasePublicKey(env);

  if (!code || !env.NEXT_PUBLIC_SUPABASE_URL || !supabasePublicKey) {
    console.error("[auth-callback] Missing code or Supabase config");
    return redirectToLogin(request, "invalid-link", next);
  }

  // Create redirect response first so we can attach cookies directly to it
  const response = NextResponse.redirect(new URL(next, request.url), {
    status: 303,
  });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublicKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            console.log(`[auth-callback] Setting cookie: ${name}`);
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  console.log("[auth-callback] Exchanging code for session...");
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth-callback] Code exchange error:", error);
    return redirectToLogin(request, "invalid-link", next);
  }

  console.log("[auth-callback] Code exchange successful. Fetching user...");
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAuthorizedUser(user)) {
    console.warn(
      "[auth-callback] User not authorized or not found:",
      user?.email,
    );
    await supabase.auth.signOut();
    const signOutResponse = redirectToLogin(request, "unauthorized", next);
    // Propagate cookie clearance to the sign out response
    response.cookies.getAll().forEach((cookie) => {
      if (cookie.name.startsWith("sb-")) {
        signOutResponse.cookies.set(cookie.name, "", { maxAge: -1 });
      }
    });
    return signOutResponse;
  }

  console.log("[auth-callback] Access granted for:", user.email);
  return response;
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
