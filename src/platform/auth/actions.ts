"use server";

import { redirect } from "next/navigation";

import { isAuthorizedUser } from "@/platform/auth/access";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

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

function redirectToLogin(error: string, redirectedFrom: string): never {
  const params = new URLSearchParams({ error });

  if (redirectedFrom !== "/dashboard") {
    params.set("redirectedFrom", redirectedFrom);
  }

  redirect(`/login?${params.toString()}`);
}
