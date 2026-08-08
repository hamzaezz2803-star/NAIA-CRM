import type { User } from "@supabase/supabase-js";

import { isAuthorizedUser } from "@/platform/auth/access";
import { getCurrentSupabaseUser } from "@/platform/auth/supabase-server";

export async function GET() {
  const user = await getCurrentSupabaseUser();

  if (!user) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!isAuthorizedUser(user)) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  return Response.json({ name: getFirstName(user) });
}

function getFirstName(user: User) {
  const displayName = ["full_name", "name", "display_name"]
    .map((key) => user.user_metadata[key])
    .find((value): value is string =>
      Boolean(typeof value === "string" && value.trim()),
    );

  return (
    displayName?.trim().split(/\s+/)[0] ??
    user.email?.split("@")[0] ??
    "NAIA-os user"
  );
}
