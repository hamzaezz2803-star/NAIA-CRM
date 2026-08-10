import "server-only";

import { NextResponse, type NextRequest } from "next/server";

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

  // Kept as a fail-closed tombstone for stale clients. Local deletion alone
  // is not a Google disconnect: it can leave the remote OAuth grant active.
  return NextResponse.json(
    {
      error: "Ce flux est obsolète. Utilisez la révocation Google sécurisée.",
      revocationEndpoint: "/api/integrations/google/revoke",
    },
    { status: 410 },
  );
}
