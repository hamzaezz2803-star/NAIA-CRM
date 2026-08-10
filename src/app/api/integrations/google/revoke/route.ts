import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import { resolveGoogleCredentialActorFromSession } from "@/platform/integrations/google-credential-boundary";
import {
  GOOGLE_MANUAL_REVOCATION_CONFIRMATION,
  GOOGLE_REVOCATION_CONFIRMATION,
} from "@/platform/integrations/google-revocation-contract";

type GoogleConnection = {
  encrypted_token_reference: string | null;
  id: string;
  server_review_reason: string | null;
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

  let actor;
  try {
    actor = await resolveGoogleCredentialActorFromSession({
      expectedProfileId: user.id,
      supabase,
    });
  } catch {
    return NextResponse.json(
      { error: "Aucune organisation associée à ce compte." },
      { status: 403 },
    );
  }

  const { data, error: connectionError } = await actor.credentialClient
    .from("integration_connections")
    .select(
      "id,status,encrypted_token_reference,server_review_reason,organization_id,provider,connected_by_profile_id",
    )
    .eq("organization_id", actor.organizationId)
    .eq("provider", "google")
    .eq("connected_by_profile_id", actor.profileId)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (connectionError) {
    return NextResponse.json(
      { error: "Impossible de charger la connexion Google." },
      { status: 500 },
    );
  }
  if (
    !data ||
    data.organization_id !== actor.organizationId ||
    data.provider !== "google" ||
    data.connected_by_profile_id !== actor.profileId ||
    data.status === "revoked"
  ) {
    return NextResponse.json({ alreadyRevoked: true, ok: true });
  }

  const connection = data as GoogleConnection;
  if (confirmation === GOOGLE_MANUAL_REVOCATION_CONFIRMATION) {
    if (
      connection.status !== "needs-review" ||
      connection.server_review_reason !== "revocation-failed"
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
      actor.credentialClient,
      connection.id,
      actor.organizationId,
      actor.profileId,
      "revoked",
      true,
      null,
      "revocation-failed",
    );
    if (!manualResult) {
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
    const marked = await markConnection(
      actor.credentialClient,
      connection.id,
      actor.organizationId,
      actor.profileId,
      "needs-review",
      false,
      "revocation-failed",
    );
    if (!marked) {
      return NextResponse.json(
        { error: "NAIA n’a pas pu sécuriser l’état de révocation." },
        { status: 500 },
      );
    }
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
    const marked = await markConnection(
      actor.credentialClient,
      connection.id,
      actor.organizationId,
      actor.profileId,
      "needs-review",
      false,
      "revocation-failed",
    );
    if (!marked) {
      return NextResponse.json(
        { error: "NAIA n’a pas pu sécuriser l’état de révocation." },
        { status: 500 },
      );
    }
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
    const marked = await markConnection(
      actor.credentialClient,
      connection.id,
      actor.organizationId,
      actor.profileId,
      "needs-review",
      false,
      "revocation-failed",
    );
    if (!marked) {
      return NextResponse.json(
        { error: "NAIA n’a pas pu sécuriser l’état de révocation." },
        { status: 500 },
      );
    }
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
    actor.credentialClient,
    connection.id,
    actor.organizationId,
    actor.profileId,
    "revoked",
    true,
    null,
  );
  if (!revokeResult) {
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
  reviewReason: "revocation-failed" | null = null,
  expectedReviewReason?: "revocation-failed",
) {
  let query = supabase
    .from("integration_connections")
    .update({
      ...(clearToken ? { encrypted_token_reference: null } : {}),
      server_review_reason: reviewReason,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId)
    .eq("organization_id", organizationId)
    .eq("provider", "google")
    .eq("connected_by_profile_id", profileId);
  if (expectedReviewReason) {
    query = query
      .eq("status", "needs-review")
      .eq("server_review_reason", expectedReviewReason);
  }
  const { data, error } = await query
    .select("id,organization_id,provider,connected_by_profile_id,status")
    .maybeSingle();
  return (
    !error &&
    data?.id === connectionId &&
    data.organization_id === organizationId &&
    data.provider === "google" &&
    data.connected_by_profile_id === profileId &&
    data.status === status
  );
}
