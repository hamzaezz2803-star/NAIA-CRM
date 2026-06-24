import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isAuthorizedUser } from "@/platform/auth/access";
import {
  getPublicEnv,
  getSupabasePublicKey,
  isSupabaseConfigured,
} from "@/platform/auth/config";

const PUBLIC_PATH_PREFIXES = ["/login", "/auth"];

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
    return redirectToLogin(request, "config");
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

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return redirectToLogin(request);
  }

  if (!isAuthorizedUser(user)) {
    await supabase.auth.signOut();
    return redirectToLogin(request, "unauthorized");
  }

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
