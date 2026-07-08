import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isAuthorizedUser } from "@/platform/auth/access";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { getPublicEnv, getSupabasePublicKey } from "@/platform/auth/config";
import { saveGoogleConnectionFromLogin } from "@/platform/integrations/google-connection";

export async function GET(request: NextRequest) {
  console.log("[auth-callback] Received request:", request.url);
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = requestUrl.searchParams.get("type");
  const next = sanitizeRedirectPath(requestUrl.searchParams.get("next"));

  const oauthError = requestUrl.searchParams.get("error");
  if (oauthError) {
    console.error(
      "[auth-callback] OAuth provider error:",
      oauthError,
      requestUrl.searchParams.get("error_description"),
    );
    return redirectToLogin(request, "google-signin", next);
  }

  const env = getPublicEnv();
  const supabasePublicKey = getSupabasePublicKey(env);

  if (
    (!code && !tokenHash) ||
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !supabasePublicKey
  ) {
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

  // token_hash links (Supabase email template) avoid the PKCE verifier
  // cookie, so a pending Google sign-in cannot invalidate a magic link.
  console.log("[auth-callback] Establishing session...");
  const { data: exchange, error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash ?? "",
        type: otpType === "magiclink" ? "magiclink" : "email",
      });

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

  // Provision profile + membership for any authorized user. Covers emails
  // allowlisted outside the @qarizmi.com domain and auth users that predate
  // the provisioning trigger.
  try {
    const { error: provisionError } = await supabase.rpc("ensure_membership");
    if (provisionError) {
      console.error(
        "[auth-callback] ensure_membership failed:",
        provisionError,
      );
    }
  } catch (rpcError) {
    console.error("[auth-callback] ensure_membership threw:", rpcError);
  }

  // Google sign-ins carry provider tokens exactly once, here. Persist them as
  // this user's own Workspace connection so Calendar/Gmail agents work
  // without a separate connect step. Never block the login on failure.
  const authSession = exchange?.session;
  const providerToken = authSession?.provider_token;
  if (providerToken) {
    try {
      const result = await saveGoogleConnectionFromLogin({
        accessToken: providerToken,
        refreshToken: authSession?.provider_refresh_token,
        supabase,
        user,
      });

      if (!result.saved) {
        console.error(
          "[auth-callback] Google connection not saved:",
          result.error,
        );
      }
    } catch (connectionError) {
      console.error(
        "[auth-callback] Google connection persistence failed:",
        connectionError,
      );
    }
  }

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
