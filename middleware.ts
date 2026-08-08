import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isAuthorizedUser } from "@/platform/auth/access";
import {
  getPublicEnv,
  getSupabasePublicKey,
  isSupabaseConfigured,
} from "@/platform/auth/config";

// Slack, WhatsApp, and the local meeting companion are called without a
// Supabase browser session. Every route authenticates its own request: Slack
// and WhatsApp verify signed webhook payloads, while the local companion uses
// a server-only bearer token and only claims jobs queued by a cofounder.
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/auth",
  "/api/slack/events",
  "/api/slack/interactions",
  "/api/whatsapp/webhook",
  "/api/meeting-notes/worker",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const env = getPublicEnv();
  const supabasePublicKey = getSupabasePublicKey(env);

  if (
    !isSupabaseConfigured(env) ||
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !supabasePublicKey
  ) {
    return rejectProtectedRequest(request, {
      error: "config",
      message: "Authentication is not configured.",
      status: 503,
    });
  }

  let response = NextResponse.next({
    request,
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
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  console.log(`[middleware] Path: ${pathname}`);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    console.log(
      "[middleware] No active session or getUser error:",
      error?.message || "No user",
    );
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[middleware] Dev environment bypass: allowing request to continue without active session",
      );
      return response;
    }
    return rejectProtectedRequest(request, {
      message: "Not authenticated.",
      status: 401,
    });
  }

  console.log("[middleware] Active user session found:", user.email);

  if (!isAuthorizedUser(user)) {
    console.warn("[middleware] User not authorized:", user.email);
    await supabase.auth.signOut();
    return rejectProtectedRequest(request, {
      error: "unauthorized",
      message: "Not authorized.",
      status: 403,
    });
  }

  console.log("[middleware] Access granted for:", user.email);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

function isPublicPath(pathname: string) {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function rejectProtectedRequest(
  request: NextRequest,
  {
    error,
    message,
    status,
  }: {
    error?: string;
    message: string;
    status: 401 | 403 | 503;
  },
) {
  if (isApiPath(request.nextUrl.pathname)) {
    return NextResponse.json({ error: message }, { status });
  }

  return redirectToLogin(request, error);
}

function redirectToLogin(request: NextRequest, error?: string) {
  const loginUrl = request.nextUrl.clone();

  loginUrl.pathname = "/login";
  loginUrl.search = "";

  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  if (requestedPath !== "/") {
    loginUrl.searchParams.set("redirectedFrom", requestedPath);
  }

  if (error) {
    loginUrl.searchParams.set("error", error);
  }

  return NextResponse.redirect(loginUrl);
}
