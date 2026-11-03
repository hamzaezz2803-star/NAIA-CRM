import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_MEETING_NOTE_SCOPE,
  GOOGLE_USER_SCOPES,
} from "@/platform/integrations/google-workspace-scopes";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
  getAppBaseUrl: vi.fn(() => "https://os.qarizmi.com"),
}));

vi.mock("@/platform/auth/config", () => ({
  getAppBaseUrl: mocks.getAppBaseUrl,
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
});

describe("GET /api/integrations/google/callback", () => {
  it("rejects a mismatched OAuth state before touching the session", async () => {
    const response = await GET(request({ queryState: "attacker-state" }));

    expect(response.status).toBe(400);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user and exact organization membership before exchange", async () => {
    const unauthenticated = fixture({ user: null });
    mocks.createServerSupabaseClient.mockResolvedValueOnce(
      unauthenticated.sessionClient,
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request())).status).toBe(401);

    const noMembership = fixture({ membership: null });
    mocks.createServerSupabaseClient.mockResolvedValueOnce(
      noMembership.sessionClient,
    );
    expect((await GET(request())).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores credential material only through service_role after tokeninfo attestation", async () => {
    const testFixture = fixture();
    installFixture(testFixture);
    const fetchMock = stubGoogle({
      tokenInfoScopes: [...GOOGLE_USER_SCOPES, "openid"],
    });

    const response = await GET(request());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(testFixture.sessionFrom).not.toHaveBeenCalledWith(
      "integration_connections",
    );
    expect(testFixture.serviceFrom).toHaveBeenCalledWith(
      "integration_connections",
    );
    expect(testFixture.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        connected_by_profile_id: "user-1",
        organization_id: "org-1",
        scopes: [...GOOGLE_USER_SCOPES, "openid"].sort(),
        server_review_reason: null,
        status: "connected",
      }),
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    );
    expect(html).toContain("GOOGLE_AUTH_SUCCESS");
    expect(html).not.toContain("access-token");
    expect(html).not.toContain("refresh-token");

    const tokenInfoCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "https://oauth2.googleapis.com/tokeninfo",
    ) as [string, RequestInit] | undefined;
    expect(tokenInfoCall?.[1].method).toBe("POST");
    expect(tokenInfoCall?.[0]).not.toContain("access-token");
    expect(
      (tokenInfoCall?.[1].body as URLSearchParams).get("access_token"),
    ).toBe("access-token");
  });

  it.each([
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.readonly",
  ])(
    "quarantines unexpected provider-attested scope %s before any Google data call",
    async (scope) => {
      const testFixture = fixture();
      installFixture(testFixture);
      const fetchMock = stubGoogle({
        tokenInfoScopes: [...GOOGLE_USER_SCOPES, scope],
      });

      const response = await GET(request());

      expect(response.status).toBe(400);
      expect(testFixture.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: expect.arrayContaining([scope]),
          server_review_reason: "scope-attestation-failed",
          status: "needs-review",
        }),
        expect.anything(),
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        expect.anything(),
      );
    },
  );

  it("quarantines a Google identity that does not match the authenticated profile", async () => {
    const testFixture = fixture();
    installFixture(testFixture);
    stubGoogle({
      tokenInfoScopes: GOOGLE_USER_SCOPES,
      googleProfileEmail: "other-account@example.com",
    });

    const response = await GET(request());

    expect(response.status).toBe(400);
    expect(testFixture.upsert).toHaveBeenCalledTimes(1);
    expect(testFixture.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        external_account_label: "other-account@example.com",
        server_review_reason: "identity-attestation-failed",
        status: "needs-review",
      }),
      expect.anything(),
    );
    expect(
      testFixture.upsert.mock.calls.some(
        ([payload]) => (payload as { status?: string }).status === "connected",
      ),
    ).toBe(false);
  });

  it("quarantines tokeninfo failure instead of trusting token-response scope metadata", async () => {
    const testFixture = fixture();
    installFixture(testFixture);
    stubGoogle({ tokenInfoOk: false, tokenResponseScope: GOOGLE_USER_SCOPES });

    const response = await GET(request());

    expect(response.status).toBe(400);
    expect(testFixture.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: [], status: "needs-review" }),
      expect.anything(),
    );
  });

  it("accepts Meet document access only for a state-bound founder intent", async () => {
    const founder = fixture();
    installFixture(founder);
    stubGoogle({
      tokenInfoScopes: [...GOOGLE_USER_SCOPES, GOOGLE_MEETING_NOTE_SCOPE],
    });

    const founderResponse = await GET(
      request({ cookieState: "expected-state:meeting-notes" }),
    );
    expect(founderResponse.status).toBe(200);
    expect(founder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: expect.arrayContaining([GOOGLE_MEETING_NOTE_SCOPE]),
        status: "connected",
      }),
      expect.anything(),
    );

    const ordinary = fixture();
    installFixture(ordinary);
    stubGoogle({
      tokenInfoScopes: [...GOOGLE_USER_SCOPES, GOOGLE_MEETING_NOTE_SCOPE],
    });
    const ordinaryResponse = await GET(request());
    expect(ordinaryResponse.status).toBe(400);
    expect(ordinary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "needs-review" }),
      expect.anything(),
    );
  });

  it("revalidates the session email before exchanging a meeting intent", async () => {
    const member = fixture({
      membership: {
        organization_id: "org-1",
        profile_id: "user-1",
        role: "member",
      },
      user: { email: "", id: "user-1" },
    });
    installFixture(member);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      request({ cookieState: "expected-state:meeting-notes" }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose database or provider bodies when persistence fails", async () => {
    const testFixture = fixture({
      databaseError: { message: "secret detail" },
    });
    installFixture(testFixture);
    stubGoogle({ tokenInfoScopes: GOOGLE_USER_SCOPES });

    const response = await GET(request());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("secret detail");
    expect(body).not.toContain("access-token");
  });
});

function request({
  cookieState = "expected-state:user",
  queryState = "expected-state",
}: {
  cookieState?: string;
  queryState?: string;
} = {}) {
  return new NextRequest(
    `https://os.qarizmi.com/api/integrations/google/callback?code=google-code&state=${queryState}`,
    { headers: { cookie: `google_oauth_state=${cookieState}` } },
  );
}

type FixtureOptions = {
  databaseError?: { message: string } | null;
  existing?: Record<string, unknown> | null;
  membership?: {
    organization_id: string;
    profile_id: string;
    role: string;
  } | null;
  user?: { email?: string; id: string } | null;
};

function fixture({
  databaseError = null,
  existing = null,
  membership = {
    organization_id: "org-1",
    profile_id: "user-1",
    role: "owner",
  },
  user = { email: "ali@qarizmi.com", id: "user-1" },
}: FixtureOptions = {}) {
  const membershipQuery = chain({
    maybeSingle: vi.fn().mockResolvedValue({ data: membership, error: null }),
  });
  const sessionFrom = vi.fn((table: string) => {
    if (table === "organization_memberships") return membershipQuery;
    throw new Error(`Unexpected session table: ${table}`);
  });
  const sessionClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: sessionFrom,
  };

  const upsertResult = chain({ maybeSingle: vi.fn() });
  const upsert = vi.fn((payload: { status: string }) => {
    upsertResult.maybeSingle = vi.fn().mockResolvedValue({
      data: databaseError
        ? null
        : {
            connected_by_profile_id: "user-1",
            id: "connection-1",
            organization_id: "org-1",
            provider: "google",
            status: payload.status,
          },
      error: databaseError,
    });
    return upsertResult;
  });
  const connectionQuery = chain({
    maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
    upsert,
  });
  const serviceFrom = vi.fn((table: string) => {
    if (table === "integration_connections") return connectionQuery;
    throw new Error(`Unexpected service table: ${table}`);
  });
  const serviceClient = { from: serviceFrom };

  return { serviceClient, serviceFrom, sessionClient, sessionFrom, upsert };
}

function installFixture(testFixture: ReturnType<typeof fixture>) {
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

function stubGoogle({
  googleProfileEmail = "ali@qarizmi.com",
  tokenInfoOk = true,
  tokenInfoScopes = GOOGLE_USER_SCOPES,
  tokenResponseScope,
}: {
  googleProfileEmail?: string;
  tokenInfoOk?: boolean;
  tokenInfoScopes?: readonly string[];
  tokenResponseScope?: readonly string[];
}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Promise.resolve(
        Response.json({
          access_token: "access-token",
          expires_in: 3600,
          refresh_token: "refresh-token",
          scope: tokenResponseScope?.join(" "),
        }),
      );
    }
    if (url === "https://oauth2.googleapis.com/tokeninfo") {
      return Promise.resolve(
        tokenInfoOk
          ? Response.json({
              aud: "client-id",
              scope: tokenInfoScopes.join(" "),
            })
          : new Response(null, { status: 503 }),
      );
    }
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
      return Promise.resolve(
        Response.json({ emailAddress: googleProfileEmail }),
      );
    }
    throw new Error(`Unexpected Google request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
