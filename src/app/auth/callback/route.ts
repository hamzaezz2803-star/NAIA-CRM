import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isGoogleOnlyAuthorizedUser } from "@/platform/auth/access";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { getPublicEnv, getSupabasePublicKey } from "@/platform/auth/config";
import { saveGoogleConnectionFromLogin } from "@/platform/integrations/google-connection";

export async function GET(request: NextRequest) {
  console.log("[auth-callback] Received authentication callback");
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
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

  if (tokenHash) {
    console.warn("[auth-callback] Rejected non-Google token_hash callback");
    return redirectToLogin(request, "google-only", next);
  }

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
  const rejectGoogleOnlySession = async () => {
    await supabase.auth.signOut({ scope: "local" });
    const signOutResponse = redirectToLogin(request, "google-only", next);
    response.cookies.getAll().forEach((cookie) => {
      if (cookie.name.startsWith("sb-")) {
        signOutResponse.cookies.set(cookie.name, "", { maxAge: -1 });
      }
    });
    return signOutResponse;
  };

  console.log("[auth-callback] Establishing session...");
  const { data: exchange, error } =
    await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth-callback] Code exchange error:", error);
    return redirectToLogin(request, "invalid-link", next);
  }

  console.log("[auth-callback] Code exchange successful. Verifying claims...");
  const authSession = exchange?.session;
  const providerToken = authSession?.provider_token;
  const claimsResult = authSession?.access_token
    ? await supabase.auth.getClaims(authSession.access_token)
    : null;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (
    !claimsResult ||
    claimsResult.error ||
    userError ||
    !user ||
    !providerToken ||
    !isGoogleOnlyAuthorizedUser(user, claimsResult.data?.claims)
  ) {
    console.warn(
      "[auth-callback] Google-only verification failed for:",
      user?.email,
    );
    return rejectGoogleOnlySession();
  }

  // AMR proves OAuth but not which external provider issued the provider
  // token. The existing connection boundary attests the token against Google,
  // its audience, exact scopes, and Gmail identity. Make that proof blocking
  // before provisioning so another enabled OAuth provider cannot pass merely
  // because the account also has a historical Google identity.
  try {
    const result = await saveGoogleConnectionFromLogin({
      accessToken: providerToken,
      refreshToken: authSession?.provider_refresh_token,
      supabase,
      user,
    });

    if (!result.saved) {
      console.error(
        "[auth-callback] Google provider attestation failed:",
        result.error,
      );
      return rejectGoogleOnlySession();
    }
  } catch (connectionError) {
    console.error(
      "[auth-callback] Google provider attestation threw:",
      connectionError,
    );
    return rejectGoogleOnlySession();
  }

  console.log("[auth-callback] Google-only access granted for:", user.email);

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
