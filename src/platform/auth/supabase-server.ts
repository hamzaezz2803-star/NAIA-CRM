import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import {
  getPublicEnv,
  getSupabasePublicKey,
  isSupabaseConfigured,
} from "@/platform/auth/config";

export async function createServerSupabaseClient() {
  const env = getPublicEnv();
  const supabasePublicKey = getSupabasePublicKey(env);

  if (!isSupabaseConfigured(env) || !env.NEXT_PUBLIC_SUPABASE_URL) {
    return null;
  }

  if (!supabasePublicKey) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, supabasePublicKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server components cannot always write cookies. Middleware and
          // route handlers refresh them before protected UI renders.
        }
      },
    },
  });
}

export async function getCurrentSupabaseUser() {
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return user;
}
