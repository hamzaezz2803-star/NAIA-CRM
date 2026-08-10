import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_MANUAL_REVOCATION_CONFIRMATION,
  GOOGLE_REVOCATION_CONFIRMATION,
} from "@/platform/integrations/google-revocation-contract";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { POST } from "./route";

function createRequest({
  confirmation = GOOGLE_REVOCATION_CONFIRMATION,
  origin = "https://os.qarizmi.com",
}: {
  confirmation?: string;
  origin?: string | null;
} = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Sec-Fetch-Site": "same-origin",
  };
  if (origin) headers.Origin = origin;
  return new NextRequest(
    "https://os.qarizmi.com/api/integrations/google/revoke",
    {
      body: JSON.stringify({ confirmation }),
      headers,
      method: "POST",
    },
  );
}

function createClient({
  connection = {
    encrypted_token_reference: JSON.stringify({
      access_token: "synthetic-access-token",
      refresh_token: "synthetic-refresh-token",
    }),
    id: "connection-1",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    status: "connected",
  },
  connectionError = null,
  membership = { organization_id: "organization-1" },
  updateError = null,
  user = { id: "profile-1" },
}: {
  connection?: {
    encrypted_token_reference: string | null;
    id: string;
    scopes?: string[] | null;
    status: string;
  } | null;
  connectionError?: { message: string } | null;
  membership?: { organization_id: string } | null;
  updateError?: { message: string } | null;
  user?: { id: string } | null;
} = {}) {
  const membershipQuery: Record<string, unknown> = {
    maybeSingle: vi.fn().mockResolvedValue({ data: membership, error: null }),
  };
  for (const method of ["eq", "limit", "select"]) {
    membershipQuery[method] = vi.fn(() => membershipQuery);
  }

  const updateResult = { error: updateError };
  const updateQuery: Record<string, unknown> = {
    then: (resolve: (value: typeof updateResult) => unknown) =>
      Promise.resolve(resolve(updateResult)),
  };
  for (const method of ["eq"]) {
    updateQuery[method] = vi.fn(() => updateQuery);
  }
  const update = vi.fn(() => updateQuery);

  const connectionQuery: Record<string, unknown> = {
    maybeSingle: vi.fn().mockResolvedValue({
      data: connection,
      error: connectionError,
    }),
    update,
  };
  for (const method of ["eq", "limit", "order", "select"]) {
    connectionQuery[method] = vi.fn(() => connectionQuery);
  }

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "organization_memberships") return membershipQuery;
      if (table === "integration_connections") return connectionQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    client,
    connectionEq: connectionQuery.eq as ReturnType<typeof vi.fn>,
    update,
    updateEq: updateQuery.eq as ReturnType<typeof vi.fn>,
  };
}

describe("POST /api/integrations/google/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects cross-origin or unconfirmed requests before session access", async () => {
    const crossOrigin = await POST(
      createRequest({ origin: "https://attacker.example" }),
    );
    const unconfirmed = await POST(
      createRequest({ confirmation: "not-confirmed" }),
    );

    expect(crossOrigin.status).toBe(403);
    expect(unconfirmed.status).toBe(400);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("revokes only the authenticated user's connection and clears the local token", async () => {
    const fixture = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(fixture.client);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      alreadyRevoked: false,
      ok: true,
    });
    expect(fixture.connectionEq).toHaveBeenCalledWith(
      "organization_id",
      "organization-1",
    );
    expect(fixture.connectionEq).toHaveBeenCalledWith(
      "connected_by_profile_id",
      "profile-1",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init).toMatchObject({
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect((init.body as URLSearchParams).get("token")).toBe(
      "synthetic-refresh-token",
    );
    expect(fixture.update).toHaveBeenCalledWith(
      expect.objectContaining({
        encrypted_token_reference: null,
        status: "revoked",
      }),
    );
    expect(fixture.updateEq).toHaveBeenCalledWith(
      "organization_id",
      "organization-1",
    );
    expect(fixture.updateEq).toHaveBeenCalledWith(
      "connected_by_profile_id",
      "profile-1",
    );
  });

  it("marks the local row needs-review when Google cannot revoke it", async () => {
    const fixture = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(fixture.client);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("upstream detail that must stay private", {
          status: 503,
        }),
      ),
    );

    const response = await POST(createRequest());
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).not.toContain("upstream detail");
    expect(payload.error).not.toContain("synthetic-refresh-token");
    expect(fixture.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "needs-review" }),
    );
    expect(fixture.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ encrypted_token_reference: null }),
    );
  });

  it("is idempotent after the local connection is already revoked", async () => {
    const fixture = createClient({
      connection: {
        encrypted_token_reference: null,
        id: "connection-1",
        status: "revoked",
      },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(fixture.client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      alreadyRevoked: true,
      ok: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it("never treats invalid_token from an expired access token as proof of revocation", async () => {
    const fixture = createClient({
      connection: {
        encrypted_token_reference: JSON.stringify({
          access_token: "synthetic-expired-access-token",
        }),
        id: "connection-1",
        scopes: ["https://www.googleapis.com/auth/drive.file"],
        status: "connected",
      },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(fixture.client);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":"invalid_token"}', { status: 400 }),
        ),
    );

    const response = await POST(createRequest());
    const payload = (await response.json()) as {
      manualReviewRequired?: boolean;
      ok?: boolean;
    };

    expect(response.status).toBe(502);
    expect(payload).toMatchObject({ manualReviewRequired: true });
    expect(payload.ok).not.toBe(true);
    expect(fixture.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "needs-review",
      }),
    );
    expect(fixture.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ encrypted_token_reference: null }),
    );
  });

  it("neutralizes only the local credential after a second explicit manual confirmation", async () => {
    const fixture = createClient({
      connection: {
        encrypted_token_reference: JSON.stringify({
          access_token: "synthetic-expired-access-token",
        }),
        id: "connection-1",
        scopes: ["https://www.googleapis.com/auth/drive.file"],
        status: "needs-review",
      },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(fixture.client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      createRequest({ confirmation: GOOGLE_MANUAL_REVOCATION_CONFIRMATION }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      manualConfirmed: true,
      ok: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.update).toHaveBeenCalledWith(
      expect.objectContaining({
        encrypted_token_reference: null,
        status: "revoked",
      }),
    );
  });

  it("rejects manual neutralization before the remote failure state", async () => {
    const fixture = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(fixture.client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      createRequest({ confirmation: GOOGLE_MANUAL_REVOCATION_CONFIRMATION }),
    );

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it("keeps an unrevocable local credential in needs-review", async () => {
    const fixture = createClient({
      connection: {
        encrypted_token_reference: "{}",
        id: "connection-1",
        scopes: ["https://www.googleapis.com/auth/drive.file"],
        status: "connected",
      },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(fixture.client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createRequest());

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "needs-review" }),
    );
  });

  it("does not load or revoke a connection outside the user's organization", async () => {
    const fixture = createClient({ membership: null });
    mocks.createServerSupabaseClient.mockResolvedValue(fixture.client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
  });
});
