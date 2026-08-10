"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isAuthorizedUser } from "@/platform/auth/access";
import {
  getAllowedAuthDomain,
  isAuthorizedEmail,
} from "@/platform/auth/access";
import { getAppBaseUrl } from "@/platform/auth/config";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import { GOOGLE_USER_SCOPE } from "@/platform/integrations/google-workspace-scopes";

export async function requestMagicLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const redirectedFrom = sanitizeRedirectPath(formData.get("redirectedFrom"));

  if (!email) {
    redirectToLogin("missing-email", redirectedFrom);
  }

  if (!isAuthorizedEmail(email).allowed) {
    redirectToLogin("unauthorized", redirectedFrom);
  }

  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    redirectToLogin("config", redirectedFrom);
  }

  const callbackUrl = new URL("/auth/callback", await getRequestBaseUrl());
  callbackUrl.searchParams.set("next", redirectedFrom);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      shouldCreateUser: false,
    },
  });

  if (error) {
    redirectToLogin("magic-link", redirectedFrom);
  }

  redirectToLogin("sent", redirectedFrom);
}

export async function signInWithGoogleAction(formData: FormData) {
  const redirectedFrom = sanitizeRedirectPath(formData.get("redirectedFrom"));

  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    redirectToLogin("config", redirectedFrom);
  }

  const callbackUrl = new URL("/auth/callback", await getRequestBaseUrl());
  callbackUrl.searchParams.set("next", redirectedFrom);

  // access_type=offline + prompt=consent make Google return a refresh token,
  // which the auth callback persists as the user's Workspace connection. The
  // hd hint preselects the Qarizmi domain; real enforcement stays server-side
  // via the allowlist in the callback and middleware.
  const { data, error } = await supabase.auth.signInWithOAuth({
    options: {
      queryParams: {
        access_type: "offline",
        hd: getAllowedAuthDomain(),
        prompt: "consent",
      },
      redirectTo: callbackUrl.toString(),
      scopes: GOOGLE_USER_SCOPE,
    },
    provider: "google",
  });

  if (error || !data?.url) {
    redirectToLogin("google", redirectedFrom);
  }

  // GoTrue answers with a redirect to Google when the provider is enabled; a
  // 4xx here means the Supabase Google provider is not configured yet.
  let providerReady = true;
  try {
    const probe = await fetch(data.url, { redirect: "manual" });
    providerReady = probe.status < 400;
  } catch {
    providerReady = false;
  }

  if (!providerReady) {
    redirectToLogin("google", redirectedFrom);
  }

  redirect(data.url);
}

export async function signInWithPasswordAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const redirectedFrom = sanitizeRedirectPath(formData.get("redirectedFrom"));

  if (!email || !password) {
    redirectToLogin("missing", redirectedFrom);
  }

  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    redirectToLogin("config", redirectedFrom);
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirectToLogin("invalid", redirectedFrom);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAuthorizedUser(user)) {
    await supabase.auth.signOut();
    redirectToLogin("unauthorized", redirectedFrom);
  }

  redirect(redirectedFrom);
}

function redirectToLogin(status: string, redirectedFrom: string): never {
  const paramName = status === "sent" ? "notice" : "error";
  const params = new URLSearchParams({ [paramName]: status });

  if (redirectedFrom !== "/dashboard") {
    params.set("redirectedFrom", redirectedFrom);
  }

  redirect(`/login?${params.toString()}`);
}

async function getRequestBaseUrl() {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  const hostBaseUrl = host
    ? toWebOrigin(`${proto}://${host.split(",")[0]?.trim()}`)
    : null;

  if (hostBaseUrl) {
    return hostBaseUrl;
  }

  const originBaseUrl = toWebOrigin(requestHeaders.get("origin"));
  return originBaseUrl ?? getAppBaseUrl();
}

function toWebOrigin(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function changePasswordAction(formData: FormData) {
  const newPassword = String(formData.get("newPassword") ?? "");

  if (!newPassword || newPassword.length < 6) {
    return { error: "Le mot de passe doit contenir au moins 6 caractères." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { error: "Erreur de configuration Supabase." };
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
