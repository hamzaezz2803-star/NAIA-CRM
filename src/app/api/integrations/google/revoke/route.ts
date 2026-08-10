import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import {
  GOOGLE_MANUAL_REVOCATION_CONFIRMATION,
  GOOGLE_REVOCATION_CONFIRMATION,
} from "@/platform/integrations/google-revocation-contract";
import { hasForbiddenGoogleDriveScope } from "@/platform/integrations/google-workspace-scopes";

type GoogleConnection = {
  encrypted_token_reference: string | null;
  id: string;
  scopes: string[] | null;
  status: string;
};

type GoogleTokenReference = {
  access_token?: string;
  refresh_token?: string;
};

export async function POST(request: NextRequest) {
  if (!isSameOriginJsonRequest(request)) {
    return NextResponse.json(
      { error: "Requête de révocation invalide." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    confirmation?: unknown;
  } | null;
  const confirmation = body?.confirmation;
  if (
    confirmation !== GOOGLE_REVOCATION_CONFIRMATION &&
    confirmation !== GOOGLE_MANUAL_REVOCATION_CONFIRMATION
  ) {
    return NextResponse.json(
      { error: "Confirmation explicite requise." },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();
  if (membershipError) {
    return NextResponse.json(
      { error: "Impossible de vérifier l’organisation." },
      { status: 500 },
    );
  }
  if (!membership?.organization_id) {
    return NextResponse.json(
      { error: "Aucune organisation associée à ce compte." },
      { status: 403 },
    );
  }

  const { data, error: connectionError } = await supabase
    .from("integration_connections")
    .select("id,status,scopes,encrypted_token_reference")
    .eq("organization_id", membership.organization_id)
    .eq("provider", "google")
    .eq("connected_by_profile_id", user.id)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (connectionError) {
    return NextResponse.json(
      { error: "Impossible de charger la connexion Google." },
      { status: 500 },
    );
  }
  if (!data || data.status === "revoked") {
    return NextResponse.json({ alreadyRevoked: true, ok: true });
  }

  const connection = data as GoogleConnection;
  if (confirmation === GOOGLE_MANUAL_REVOCATION_CONFIRMATION) {
    if (
      connection.status !== "needs-review" ||
      !hasForbiddenGoogleDriveScope(connection.scopes)
    ) {
      return NextResponse.json(
        {
          error:
            "La confirmation manuelle est disponible uniquement après un échec de révocation vérifié.",
        },
        { status: 409 },
      );
    }

    const manualResult = await markConnection(
      supabase,
      connection.id,
      membership.organization_id,
      user.id,
      "revoked",
      true,
    );
    if (manualResult.error) {
      return NextResponse.json(
        { error: "NAIA n’a pas pu finaliser la révocation manuelle." },
        { status: 500 },
      );
    }
    return NextResponse.json({ manualConfirmed: true, ok: true });
  }

  const tokenReference = parseTokenReference(
    connection.encrypted_token_reference,
  );
  const token = tokenReference.refresh_token ?? tokenReference.access_token;
  if (!token) {
    await markConnection(
      supabase,
      connection.id,
      membership.organization_id,
      user.id,
      "needs-review",
    );
    return NextResponse.json(
      {
        error:
          "Aucun jeton révocable n’est disponible. Ouvrez les connexions de votre compte Google, retirez NAIA, puis confirmez cette révocation manuelle.",
        manualReviewRequired: true,
      },
      { status: 409 },
    );
  }

  let revokeResponse: Response;
  try {
    revokeResponse = await fetch("https://oauth2.googleapis.com/revoke", {
      body: new URLSearchParams({ token }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
  } catch {
    await markConnection(
      supabase,
      connection.id,
      membership.organization_id,
      user.id,
      "needs-review",
    );
    return NextResponse.json(
      {
        error:
          "Google n’a pas confirmé la révocation. Ouvrez les connexions de votre compte Google, retirez NAIA, puis confirmez cette révocation manuelle.",
        manualReviewRequired: true,
      },
      { status: 502 },
    );
  }

  // A 400 invalid_token can be an expired access token while the grant still
  // exists. Only Google's documented 200 response proves remote revocation.
  if (revokeResponse.status !== 200) {
    await markConnection(
      supabase,
      connection.id,
      membership.organization_id,
      user.id,
      "needs-review",
    );
    return NextResponse.json(
      {
        error:
          "Google n’a pas confirmé la révocation. Ouvrez les connexions de votre compte Google, retirez NAIA, puis confirmez cette révocation manuelle.",
        manualReviewRequired: true,
      },
      { status: 502 },
    );
  }

  const revokeResult = await markConnection(
    supabase,
    connection.id,
    membership.organization_id,
    user.id,
    "revoked",
    true,
  );
  if (revokeResult.error) {
    return NextResponse.json(
      {
        error:
          "L’accès Google est révoqué, mais NAIA n’a pas pu finaliser son état local. Réessayez.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ alreadyRevoked: false, ok: true });
}

function isSameOriginJsonRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase("en").startsWith("application/json")) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== request.nextUrl.origin) return false;
  } catch {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

function parseTokenReference(value: string | null): GoogleTokenReference {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as GoogleTokenReference;
    return {
      access_token:
        typeof parsed.access_token === "string"
          ? parsed.access_token
          : undefined,
      refresh_token:
        typeof parsed.refresh_token === "string"
          ? parsed.refresh_token
          : undefined,
    };
  } catch {
    return {};
  }
}

async function markConnection(
  supabase: SupabaseClient,
  connectionId: string,
  organizationId: string,
  profileId: string,
  status: "needs-review" | "revoked",
  clearToken = false,
) {
  return supabase
    .from("integration_connections")
    .update({
      ...(clearToken ? { encrypted_token_reference: null } : {}),
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId)
    .eq("organization_id", organizationId)
    .eq("provider", "google")
    .eq("connected_by_profile_id", profileId);
}
