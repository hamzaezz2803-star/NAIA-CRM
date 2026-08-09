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
  membership?: { organization_id: string } | null;
  membershipError?: { message: string } | null;
  user?: { id: string } | null;
  userError?: { message: string } | null;
};

function createRequest({
  code = "google-code",
  cookieState = "expected-state",
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
  membership = { organization_id: "org-1" },
  membershipError = null,
  user = { id: "user-1" },
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

  const from = vi.fn((table: string) => {
    if (table === "organization_memberships") {
      return { select: membershipSelect };
    }
    if (table === "integration_connections") {
      return { upsert };
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
  omitScope = false,
  scope = "openid email https://www.googleapis.com/auth/calendar",
}: { omitScope?: boolean; scope?: string } = {}) {
  const tokenPayload: Record<string, unknown> = {
    access_token: "access-token",
    expires_in: 3600,
    refresh_token: "refresh-token",
  };
  if (!omitScope) tokenPayload.scope = scope;
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(tokenPayload), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ email: "ali@qarizmi.com" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
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

  it("never invents a Drive grant when Google omits the returned scope", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    stubSuccessfulGoogleExchange({ omitScope: true });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(client.spies.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.freebusy",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
        ],
      }),
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    );
  });
});
