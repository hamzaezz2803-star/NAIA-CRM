import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { isAuthorizedUser } from "@/platform/auth/access";
import { isSupabaseConfigured } from "@/platform/auth/config";
import { getCurrentSupabaseUser } from "@/platform/auth/supabase-server";
import type { OrganizationRole } from "@/platform/core/permissions";

export type AppSession = {
  authMode: "supabase";
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
  const user = await getCurrentSupabaseUser();

  if (!configured || !user) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[getAppSession] Dev bypass: no active user session, returning mock developer session",
      );
      return {
        authMode: "supabase",
        isSupabaseConfigured: configured,
        user: {
          name: "Hamza (Dev Bypass)",
          email: "hamza@qarizmi.com",
          role: "owner",
        },
        organization: {
          name: "Qarizmi Dev",
          slug: "qarizmi",
        },
      };
    }
    redirect("/login");
  }

  if (!isAuthorizedUser(user)) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[getAppSession] Dev bypass: unauthorized user, returning mock developer session",
      );
      return {
        authMode: "supabase",
        isSupabaseConfigured: configured,
        user: {
          name: getDisplayName(user),
          email: user.email ?? "unknown@qarizmi.com",
          role: "owner",
        },
        organization: {
          name: "Qarizmi Dev",
          slug: "qarizmi",
        },
      };
    }
    redirect("/login?error=unauthorized");
  }

  return {
    authMode: "supabase",
    isSupabaseConfigured: configured,
    user: {
      name: getDisplayName(user),
      email: user.email ?? "unknown@qarizmi.com",
      role: "owner",
    },
    organization: {
      name: "Qarizmi",
      slug: "qarizmi",
    },
  };
}

function getDisplayName(user: User) {
  const metadataName =
    getStringMetadata(user, "full_name") ??
    getStringMetadata(user, "name") ??
    getStringMetadata(user, "display_name");

  if (metadataName) {
    return metadataName;
  }

  return user.email?.split("@")[0] ?? "Qarizmi user";
}

function getStringMetadata(user: User, key: string) {
  const value = user.user_metadata[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}
