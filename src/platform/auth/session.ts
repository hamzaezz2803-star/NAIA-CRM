import { isSupabaseConfigured } from "@/platform/auth/config";
import type { OrganizationRole } from "@/platform/core/permissions";

export type AppSession = {
  authMode: "local-scaffold" | "supabase-project-configured";
  isSupabaseConfigured: boolean;
  user: {
    name: string;
    email: string;
    role: OrganizationRole;
  };
  organization: {
    name: string;
    slug: string;
  };
};

export async function getAppSession(): Promise<AppSession> {
  const configured = isSupabaseConfigured();

  return {
    authMode: configured ? "supabase-project-configured" : "local-scaffold",
    isSupabaseConfigured: configured,
    user: {
      name: "Ali El Abbassy",
      email: "ali@qarizmi.com",
      role: "owner",
    },
    organization: {
      name: "Qarizmi",
      slug: "qarizmi",
    },
  };
}
