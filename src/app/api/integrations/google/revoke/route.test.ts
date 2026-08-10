import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_MANUAL_REVOCATION_CONFIRMATION,
  GOOGLE_REVOCATION_CONFIRMATION,
} from "@/platform/integrations/google-revocation-contract";
import { GOOGLE_USER_SCOPES } from "@/platform/integrations/google-workspace-scopes";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/integrations/google/revoke", () => {
  it("rejects cross-origin or unconfirmed requests before session access", async () => {
    expect(
      (await POST(request({ origin: "https://attacker.example" }))).status,
    ).toBe(403);
    expect(
      (await POST(request({ confirmation: "not-confirmed" }))).status,
    ).toBe(400);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("loads and clears only the authenticated user's credential through service_role", async () => {
    const testFixture = fixture();
    install(testFixture);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(testFixture.sessionFrom).not.toHaveBeenCalledWith(
      "integration_connections",
    );
    expect(testFixture.serviceFrom).toHaveBeenCalledWith(
      "integration_connections",
    );
    expect(testFixture.connectionEq).toHaveBeenCalledWith(
      "organization_id",
      "organization-1",
    );
    expect(testFixture.connectionEq).toHaveBeenCalledWith(
      "connected_by_profile_id",
      "profile-1",
    );
    expect(testFixture.update).toHaveBeenCalledWith(
      expect.objectContaining({
        encrypted_token_reference: null,
        server_review_reason: null,
        status: "revoked",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each(["network", "non-200"])(
    "gates manual confirmation after a server-authored narrow-scope %s failure",
    async (failure) => {
      const testFixture = fixture({
        connection: connectedConnection({ scopes: [...GOOGLE_USER_SCOPES] }),
      });
      install(testFixture);
      vi.stubGlobal(
        "fetch",
        failure === "network"
          ? vi.fn().mockRejectedValue(new Error("offline"))
          : vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
      );

      const failed = await POST(request());
      expect(failed.status).toBe(502);
      await expect(failed.json()).resolves.toMatchObject({
        manualReviewRequired: true,
      });
      expect(testFixture.update).toHaveBeenCalledWith(
        expect.objectContaining({
          server_review_reason: "revocation-failed",
          status: "needs-review",
        }),
      );

      const manual = await POST(
        request({ confirmation: GOOGLE_MANUAL_REVOCATION_CONFIRMATION }),
      );
      expect(manual.status).toBe(200);
      await expect(manual.json()).resolves.toEqual({
        manualConfirmed: true,
        ok: true,
      });
      expect(testFixture.updateEq).toHaveBeenCalledWith(
        "server_review_reason",
        "revocation-failed",
      );
    },
  );

  it("rejects direct manual confirmation without a prior failure on that row", async () => {
    const testFixture = fixture({
      connection: connectedConnection({
        server_review_reason: "legacy-unattested",
        status: "needs-review",
      }),
    });
    install(testFixture);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ confirmation: GOOGLE_MANUAL_REVOCATION_CONFIRMATION }),
    );

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(testFixture.update).not.toHaveBeenCalled();
  });

  it("does not treat invalid_token as proof of remote revocation", async () => {
    const testFixture = fixture();
    install(testFixture);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":"invalid_token"}', { status: 400 }),
        ),
    );

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(testFixture.current.status).toBe("needs-review");
    expect(testFixture.current.encrypted_token_reference).not.toBeNull();
  });

  it("fails closed when service_role is unavailable", async () => {
    const testFixture = fixture();
    mocks.createServerSupabaseClient.mockResolvedValue(
      testFixture.sessionClient,
    );
    mocks.createServiceRoleSupabaseClient.mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not load or revoke a connection outside the user's membership", async () => {
    const testFixture = fixture({ membership: null });
    install(testFixture);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(testFixture.serviceFrom).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function request({
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

type Connection = ReturnType<typeof connectedConnection>;

function connectedConnection(
  overrides: Partial<{
    scopes: string[];
    server_review_reason: string | null;
    status: string;
  }> = {},
) {
  return {
    connected_by_profile_id: "profile-1",
    encrypted_token_reference: JSON.stringify({
      access_token: "synthetic-access-token",
      refresh_token: "synthetic-refresh-token",
    }) as string | null,
    id: "connection-1",
    organization_id: "organization-1",
    provider: "google",
    scopes: overrides.scopes ?? [...GOOGLE_USER_SCOPES],
    server_review_reason: overrides.server_review_reason ?? null,
    status: overrides.status ?? "connected",
  };
}

function fixture({
  connection = connectedConnection(),
  membership = {
    organization_id: "organization-1",
    profile_id: "profile-1",
    role: "owner",
  },
}: {
  connection?: Connection;
  membership?: Record<string, unknown> | null;
} = {}) {
  const membershipQuery = chain({
    maybeSingle: vi.fn().mockResolvedValue({ data: membership, error: null }),
  });
  const sessionFrom = vi.fn((table: string) => {
    if (table === "organization_memberships") return membershipQuery;
    throw new Error(`Unexpected session table: ${table}`);
  });
  const sessionClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "profile-1" } },
        error: null,
      }),
    },
    from: sessionFrom,
  };

  const current = connection;
  const updateResult = chain({ maybeSingle: vi.fn() });
  const update = vi.fn((payload: Record<string, unknown>) => {
    Object.assign(current, payload);
    updateResult.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        connected_by_profile_id: current.connected_by_profile_id,
        id: current.id,
        organization_id: current.organization_id,
        provider: current.provider,
        status: current.status,
      },
      error: null,
    });
    return updateResult;
  });
  const connectionQuery = chain({
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: { ...current }, error: null }),
    ),
    update,
  });
  const serviceFrom = vi.fn((table: string) => {
    if (table === "integration_connections") return connectionQuery;
    throw new Error(`Unexpected service table: ${table}`);
  });
  const serviceClient = { from: serviceFrom };

  return {
    connectionEq: connectionQuery.eq as ReturnType<typeof vi.fn>,
    current,
    serviceClient,
    serviceFrom,
    sessionClient,
    sessionFrom,
    update,
    updateEq: updateResult.eq as ReturnType<typeof vi.fn>,
  };
}

function install(testFixture: ReturnType<typeof fixture>) {
  mocks.createServerSupabaseClient.mockResolvedValue(testFixture.sessionClient);
  mocks.createServiceRoleSupabaseClient.mockReturnValue(
    testFixture.serviceClient,
  );
}

function chain(initial: Record<string, ReturnType<typeof vi.fn>>) {
  const query: Record<string, ReturnType<typeof vi.fn>> = { ...initial };
  for (const method of ["eq", "limit", "order", "select"]) {
    query[method] = vi.fn(() => query);
  }
  return query;
}
