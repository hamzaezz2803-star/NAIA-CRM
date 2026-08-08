import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

type DisconnectRequest = {
  provider?: unknown;
};

export async function POST(request: NextRequest) {
  const body = (await request
    .json()
    .catch(() => null)) as DisconnectRequest | null;

  if (body?.provider !== "google") {
    return NextResponse.json(
      {
        error:
          "Seule la connexion Google personnelle peut être déconnectée ici.",
      },
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

  const { error: deleteError } = await supabase
    .from("integration_connections")
    .delete()
    .eq("organization_id", membership.organization_id)
    .eq("provider", "google")
    .eq("connected_by_profile_id", user.id);

  if (deleteError) {
    return NextResponse.json(
      { error: "La connexion Google n’a pas pu être supprimée." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Connexion Google déconnectée avec succès.",
    ok: true,
    provider: "google",
  });
}
