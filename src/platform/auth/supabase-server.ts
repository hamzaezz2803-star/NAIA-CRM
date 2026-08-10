import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

// Service-role Supabase client for trusted server-side bridges (for example
// the Slack bridge) that run without a browser session. It bypasses RLS, so
// callers MUST scope every query by organization_id and enforce role
// permissions explicitly. Never import this from client components and never
// expose the key through NEXT_PUBLIC_* variables.
export function createServiceRoleSupabaseClient(): SupabaseClient | null {
  const env = getPublicEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !serviceRoleKey) {
    return null;
  }

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
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

export async function getCurrentSupabaseClaims() {
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    return null;
  }

  return data.claims;
}
