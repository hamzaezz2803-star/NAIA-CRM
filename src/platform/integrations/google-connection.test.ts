import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GOOGLE_USER_SCOPES } from "./google-workspace-scopes";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import { saveGoogleConnectionFromLogin } from "./google-connection";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google connection credential boundary", () => {
  it("authenticates the exact profile before creating a service-role client", async () => {
    const fixture = createFixture({ sessionUserId: "other-profile" });
    stubTokenInfo(GOOGLE_USER_SCOPES);

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        supabase: fixture.sessionClient as never,
        user: user(),
      }),
    ).resolves.toMatchObject({ saved: false });

    expect(mocks.createServiceRoleSupabaseClient).not.toHaveBeenCalled();
    expect(fixture.serviceFrom).not.toHaveBeenCalled();
  });

  it("persists an exactly attested ordinary credential only through service_role", async () => {
    const fixture = createFixture();
    stubTokenInfo([...GOOGLE_USER_SCOPES, "openid"]);

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        supabase: fixture.sessionClient as never,
        user: user(),
      }),
    ).resolves.toEqual({ saved: true });

    expect(fixture.sessionFrom).not.toHaveBeenCalledWith(
      "integration_connections",
    );
    expect(fixture.serviceFrom).toHaveBeenCalledWith("integration_connections");
    expect(fixture.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        connected_by_profile_id: "profile-1",
        organization_id: "organization-1",
        scopes: [...GOOGLE_USER_SCOPES, "openid"].sort(),
        server_review_reason: null,
        status: "connected",
      }),
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    );
    const payload = fixture.upsert.mock.calls[0]?.[0] as {
      encrypted_token_reference: string;
      scopes: string[];
    };
    expect(payload.scopes).not.toContain(
      "https://www.googleapis.com/auth/gmail.send",
    );
    expect(JSON.parse(payload.encrypted_token_reference)).toMatchObject({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
  });

  it.each([
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.readonly",
  ])("quarantines provider-attested unexpected scope %s", async (scope) => {
    const fixture = createFixture();
    stubTokenInfo([...GOOGLE_USER_SCOPES, scope]);

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "broad-access-token",
        refreshToken: "broad-refresh-token",
        supabase: fixture.sessionClient as never,
        user: user(),
      }),
    ).resolves.toEqual({
      error: "Google token scopes could not be safely attested.",
      saved: false,
    });

    expect(fixture.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: expect.arrayContaining([scope]),
        server_review_reason: "scope-attestation-failed",
        status: "needs-review",
      }),
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    );
    expect(fixture.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "connected" }),
      expect.anything(),
    );
  });

  it("quarantines without trusting token-response metadata when tokeninfo is unavailable", async () => {
    const fixture = createFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        supabase: fixture.sessionClient as never,
        user: user(),
      }),
    ).resolves.toMatchObject({ saved: false });

    expect(fixture.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [],
        server_review_reason: "scope-attestation-failed",
        status: "needs-review",
      }),
      expect.anything(),
    );
  });

  it("quarantines a provider identity that differs from the authenticated profile", async () => {
    const fixture = createFixture();
    stubTokenInfo(GOOGLE_USER_SCOPES, "other-account@example.com");

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        supabase: fixture.sessionClient as never,
        user: user(),
      }),
    ).resolves.toEqual({
      error: "Google account does not match the authenticated account.",
      saved: false,
    });

    expect(fixture.upsert).toHaveBeenCalledTimes(1);
    expect(fixture.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        external_account_label: "other-account@example.com",
        server_review_reason: "identity-attestation-failed",
        status: "needs-review",
      }),
      expect.anything(),
    );
    expect(fixture.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "connected" }),
      expect.anything(),
    );
  });

  it("reuses a refresh token only from an already connected exact server attestation", async () => {
    const fixture = createFixture({
      existing: {
        encrypted_token_reference: JSON.stringify({
          refresh_token: "existing-refresh-token",
        }),
        id: "connection-1",
        scopes: [...GOOGLE_USER_SCOPES],
        status: "connected",
      },
    });
    stubTokenInfo(GOOGLE_USER_SCOPES);

    await saveGoogleConnectionFromLogin({
      accessToken: "access-token",
      supabase: fixture.sessionClient as never,
      user: user(),
    });

    const payload = fixture.upsert.mock.calls[0]?.[0] as {
      encrypted_token_reference: string;
    };
    expect(JSON.parse(payload.encrypted_token_reference)).toMatchObject({
      refresh_token: "existing-refresh-token",
    });
  });
});

type Existing = {
  encrypted_token_reference: string | null;
  id: string;
  scopes: string[];
  status: string;
};

function createFixture({
  existing = null,
  sessionUserId = "profile-1",
}: {
  existing?: Existing | null;
  sessionUserId?: string;
} = {}) {
  const membershipQuery = chain({
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        organization_id: "organization-1",
        profile_id: sessionUserId,
        role: "owner",
      },
      error: null,
    }),
  });
  const sessionFrom = vi.fn((table: string) => {
    if (table === "organization_memberships") return membershipQuery;
    throw new Error(`Unexpected session table: ${table}`);
  });
  const sessionClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { email: "ali@qarizmi.com", id: sessionUserId } },
        error: null,
      }),
    },
    from: sessionFrom,
  };

  const upsertResult = chain({
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        connected_by_profile_id: "profile-1",
        id: "connection-1",
        organization_id: "organization-1",
        provider: "google",
        status: undefined,
      },
      error: null,
    }),
  });
  const upsert = vi.fn((payload: Record<string, unknown>) => {
    const status = String(payload.status);
    upsertResult.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        connected_by_profile_id: "profile-1",
        id: "connection-1",
        organization_id: "organization-1",
        provider: "google",
        status,
      },
      error: null,
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
  mocks.createServiceRoleSupabaseClient.mockReturnValue({ from: serviceFrom });

  return { serviceFrom, sessionClient, sessionFrom, upsert };
}

function chain(initial: Record<string, ReturnType<typeof vi.fn>>) {
  const query: Record<string, ReturnType<typeof vi.fn>> = { ...initial };
  for (const method of ["eq", "limit", "order", "select"]) {
    query[method] = vi.fn(() => query);
  }
  return query;
}

function stubTokenInfo(
  scopes: readonly string[],
  googleAccountEmail = "ali@qarizmi.com",
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/tokeninfo") {
        return Promise.resolve(
          Response.json({
            aud: "client-id",
            scope: scopes.join(" "),
          }),
        );
      }
      if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
        return Promise.resolve(
          Response.json({ emailAddress: googleAccountEmail }),
        );
      }
      throw new Error(`Unexpected Google request: ${url}`);
    }),
  );
}

function user() {
  return { email: "ali@qarizmi.com", id: "profile-1" } as User;
}
