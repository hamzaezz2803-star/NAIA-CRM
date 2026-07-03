"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isAuthorizedUser } from "@/platform/auth/access";
import { isAuthorizedEmail } from "@/platform/auth/access";
import { getAppBaseUrl } from "@/platform/auth/config";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

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
