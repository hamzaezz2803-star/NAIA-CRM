import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { isAuthorizedUser } from "@/platform/auth/access";
import { isSupabaseConfigured } from "@/platform/auth/config";
import {
  createServerSupabaseClient,
  getCurrentSupabaseUser,
} from "@/platform/auth/supabase-server";
import type { OrganizationRole } from "@/platform/core/permissions";

const ORGANIZATION_ROLES: readonly OrganizationRole[] = [
  "owner",
  "admin",
  "member",
  "viewer",
];

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
          name: "NAIA-os Dev",
          slug: "naia-os",
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
          name: "NAIA-os Dev",
          slug: "naia-os",
        },
      };
    }
    redirect("/login?error=unauthorized");
  }

  const membership = await getMembershipContext(user.id);

  return {
    authMode: "supabase",
    isSupabaseConfigured: configured,
    user: {
      name: getDisplayName(user),
      email: user.email ?? "unknown@qarizmi.com",
      // Real role from organization_memberships; unknown users are viewers.
      role: membership?.role ?? "viewer",
    },
    organization: membership?.organization ?? {
      name: "NAIA-os",
      slug: "naia-os",
    },
  };
}

async function getMembershipContext(profileId: string): Promise<{
  organization: { name: string; slug: string };
  role: OrganizationRole;
} | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("organization_memberships")
    .select("role, organization:organizations(name, slug)")
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const role = ORGANIZATION_ROLES.includes(data.role as OrganizationRole)
    ? (data.role as OrganizationRole)
    : "viewer";
  const organization = Array.isArray(data.organization)
    ? data.organization[0]
    : data.organization;

  return {
    organization: {
      name: organization?.name ?? "NAIA-os",
      slug: organization?.slug ?? "naia-os",
    },
    role,
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

  return user.email?.split("@")[0] ?? "NAIA-os user";
}

function getStringMetadata(user: User, key: string) {
  const value = user.user_metadata[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}
