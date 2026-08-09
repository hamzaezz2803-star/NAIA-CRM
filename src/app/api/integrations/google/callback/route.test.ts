import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  getAppBaseUrl: vi.fn(() => "https://os.qarizmi.com"),
}));

vi.mock("@/platform/auth/config", () => ({
  getAppBaseUrl: mocks.getAppBaseUrl,
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { GET } from "./route";

type ClientOptions = {
  databaseError?: { message: string } | null;
  existingConnection?: {
    encrypted_token_reference: string | null;
    scopes: string[] | null;
  } | null;
  membership?: { organization_id: string; role: string } | null;
  membershipError?: { message: string } | null;
  user?: { email?: string; id: string } | null;
  userError?: { message: string } | null;
};

function createRequest({
  code = "google-code",
  cookieState = "expected-state:user",
  queryState = "expected-state",
}: {
  code?: string;
  cookieState?: string;
  queryState?: string;
} = {}) {
  return new NextRequest(
    `https://os.qarizmi.com/api/integrations/google/callback?code=${code}&state=${queryState}`,
    {
      headers: { cookie: `google_oauth_state=${cookieState}` },
    },
  );
}

function createClient({
  databaseError = null,
  existingConnection = null,
  membership = { organization_id: "org-1", role: "owner" },
  membershipError = null,
  user = { email: "ali@qarizmi.com", id: "user-1" },
  userError = null,
}: ClientOptions = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: databaseError });
  const membershipMaybeSingle = vi.fn().mockResolvedValue({
    data: membership,
    error: membershipError,
  });
  const membershipLimit = vi
    .fn()
    .mockReturnValue({ maybeSingle: membershipMaybeSingle });
  const membershipEq = vi.fn().mockReturnValue({ limit: membershipLimit });
  const membershipSelect = vi.fn().mockReturnValue({ eq: membershipEq });

  const connectionQuery: Record<string, unknown> = {
    maybeSingle: vi.fn().mockResolvedValue({
      data: existingConnection,
      error: null,
    }),
    upsert,
  };
  for (const method of ["eq", "select"]) {
    connectionQuery[method] = vi.fn(() => connectionQuery);
  }

  const from = vi.fn((table: string) => {
    if (table === "organization_memberships") {
      return { select: membershipSelect };
    }
    if (table === "integration_connections") {
      return connectionQuery;
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: userError,
      }),
    },
    from,
    spies: { upsert },
  };
}

function stubSuccessfulGoogleExchange({
  omitRefreshToken = false,
  omitScope = false,
  scope = "openid email https://www.googleapis.com/auth/calendar",
  tokenInfoOk = true,
  tokenInfoScope = scope,
}: {
  omitRefreshToken?: boolean;
  omitScope?: boolean;
  scope?: string;
  tokenInfoOk?: boolean;
  tokenInfoScope?: string;
} = {}) {
  const tokenPayload: Record<string, unknown> = {
    access_token: "access-token",
    expires_in: 3600,
  };
  if (!omitRefreshToken) tokenPayload.refresh_token = "refresh-token";
  if (!omitScope) tokenPayload.scope = scope;
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Promise.resolve(
        new Response(JSON.stringify(tokenPayload), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    }
    if (url.startsWith("https://www.googleapis.com/oauth2/v3/tokeninfo")) {
      return Promise.resolve(
        tokenInfoOk
          ? new Response(JSON.stringify({ scope: tokenInfoScope }), {
              headers: { "Content-Type": "application/json" },
              status: 200,
            })
          : new Response(null, { status: 503 }),
      );
    }
    if (url === "https://www.googleapis.com/oauth2/v2/userinfo") {
      return Promise.resolve(
        new Response(JSON.stringify({ email: "ali@qarizmi.com" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify(tokenPayload), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GET /api/integrations/google/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  });

  it("rejects a mismatched OAuth state before touching the session", async () => {
    const response = await GET(createRequest({ queryState: "attacker-state" }));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("invalid state");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated Supabase user", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ user: null }),
    );

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an organization membership before exchanging the code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ membership: null }),
    );

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores the token only for the authenticated user's organization", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const fetchMock = stubSuccessfulGoogleExchange();

    const response = await GET(createRequest());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.spies.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        connected_by_profile_id: "user-1",
        external_account_label: "ali@qarizmi.com",
        organization_id: "org-1",
        provider: "google",
        status: "connected",
      }),
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    );
    expect(html).toContain("GOOGLE_AUTH_SUCCESS");
    expect(html).toContain("ali@qarizmi.com");
    expect(html).toContain("/integrations");
    expect(response.cookies.get("google_oauth_state")?.value).toBe("");
  });

  it("does not report OAuth success when persistence fails", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ databaseError: { message: "database unavailable" } }),
    );
    stubSuccessfulGoogleExchange();

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("database unavailable");
  });

  it("attests current scopes with tokeninfo when the token response omits them", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const fetchMock = stubSuccessfulGoogleExchange({
      omitScope: true,
      tokenInfoScope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
      ].join(" "),
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=access-token",
    );
    expect(client.spies.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/gmail.readonly",
        ],
      }),
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    );
  });

  it("fails closed when omitted scopes cannot be attested with tokeninfo", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const fetchMock = stubSuccessfulGoogleExchange({
      omitScope: true,
      tokenInfoOk: false,
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("scopes could not be verified");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.spies.upsert).not.toHaveBeenCalled();
  });

  it("rejects a broad Drive scope discovered through tokeninfo", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    stubSuccessfulGoogleExchange({
      omitScope: true,
      tokenInfoScope: "https://www.googleapis.com/auth/drive.readonly",
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("unauthorized Drive scope");
    expect(client.spies.upsert).not.toHaveBeenCalled();
  });

  it("revalidates founder access before exchanging a meeting-notes code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({
        membership: { organization_id: "org-1", role: "member" },
        user: { email: "stagiaire@qarizmi.com", id: "user-2" },
      }),
    );

    const response = await GET(
      createRequest({ cookieState: "expected-state:meeting-notes" }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the narrow Meet scope only for a bound founder intent", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    stubSuccessfulGoogleExchange({
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.meet.readonly",
      ].join(" "),
    });

    const response = await GET(
      createRequest({ cookieState: "expected-state:meeting-notes" }),
    );

    expect(response.status).toBe(200);
    expect(client.spies.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/drive.meet.readonly",
        ],
      }),
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    );
    expect(await response.text()).toContain("/meetings");
  });

  it("rejects a Meet scope added to an ordinary OAuth URL", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    stubSuccessfulGoogleExchange({
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.meet.readonly",
      ].join(" "),
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expect(client.spies.upsert).not.toHaveBeenCalled();
  });

  it("rejects every broader Drive scope even for a founder intent", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    stubSuccessfulGoogleExchange({
      scope: "https://www.googleapis.com/auth/drive.readonly",
    });

    const response = await GET(
      createRequest({ cookieState: "expected-state:meeting-notes" }),
    );

    expect(response.status).toBe(400);
    expect(client.spies.upsert).not.toHaveBeenCalled();
  });

  it("preserves an existing founder Meet grant on an ordinary reconnect", async () => {
    const client = createClient({
      existingConnection: {
        encrypted_token_reference: JSON.stringify({
          refresh_token: "existing-refresh-token",
        }),
        scopes: ["https://www.googleapis.com/auth/drive.meet.readonly"],
      },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    stubSuccessfulGoogleExchange({
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.meet.readonly",
      ].join(" "),
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(client.spies.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: expect.arrayContaining([
          "https://www.googleapis.com/auth/drive.meet.readonly",
        ]),
      }),
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    );
  });

  it("does not reuse a stored refresh token attested with a broad Drive scope", async () => {
    const client = createClient({
      existingConnection: {
        encrypted_token_reference: JSON.stringify({
          refresh_token: "broad-existing-refresh-token",
        }),
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/drive.readonly",
        ],
      },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    stubSuccessfulGoogleExchange({
      omitRefreshToken: true,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(client.spies.upsert).toHaveBeenCalledOnce();
    const [payload] = client.spies.upsert.mock.calls[0] as [
      { encrypted_token_reference: string },
    ];
    expect(JSON.parse(payload.encrypted_token_reference)).toEqual({
      access_token: "access-token",
      expiry_date: expect.any(Number),
    });
  });
});
