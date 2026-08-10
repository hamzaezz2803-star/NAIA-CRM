import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  saveGoogleConnectionFromLogin: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/platform/auth/config", () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  }),
  getSupabasePublicKey: () => "test-key",
}));

vi.mock("@/platform/integrations/google-connection", () => ({
  saveGoogleConnectionFromLogin: mocks.saveGoogleConnectionFromLogin,
}));

import { GET } from "./route";

describe("GET /auth/callback Google-only boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH_ALLOWED_EMAILS", "");
    mocks.saveGoogleConnectionFromLogin.mockResolvedValue({ saved: true });
  });

  it("rejects token_hash callbacks before creating a Supabase client", async () => {
    const testFixture = fixture();

    const response = await GET(
      request("?token_hash=legacy-token&type=magiclink"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://os.qarizmi.com/login?error=google-only",
    );
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(testFixture.verifyOtp).not.toHaveBeenCalled();
    expect(testFixture.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("accepts provider=email when Google is linked and the signed AMR is OAuth", async () => {
    const testFixture = fixture();

    const response = await GET(request("?code=google-code"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://os.qarizmi.com/dashboard",
    );
    expect(testFixture.getClaims).toHaveBeenCalledWith("supabase-access-token");
    expect(testFixture.rpc).toHaveBeenCalledWith("ensure_membership");
    expect(testFixture.getClaims.mock.invocationCallOrder[0]).toBeLessThan(
      testFixture.rpc.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(mocks.saveGoogleConnectionFromLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "provider-token",
        refreshToken: "provider-refresh-token",
        user: expect.objectContaining({ id: "user-ali" }),
      }),
    );
    expect(
      mocks.saveGoogleConnectionFromLogin.mock.invocationCallOrder[0],
    ).toBeLessThan(
      testFixture.rpc.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it.each([
    ["magiclink", "provider-token"],
    ["password", "provider-token"],
    ["oauth", null],
  ])(
    "rejects method %s with provider token %s before provisioning",
    async (method, providerToken) => {
      const testFixture = fixture({ method, providerToken });

      const response = await GET(request("?code=google-code"));

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://os.qarizmi.com/login?error=google-only",
      );
      expect(testFixture.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(testFixture.rpc).not.toHaveBeenCalled();
      expect(mocks.saveGoogleConnectionFromLogin).not.toHaveBeenCalled();
    },
  );

  it("rejects an email-only identity before provisioning", async () => {
    const testFixture = fixture({ providers: ["email"] });

    const response = await GET(request("?code=google-code"));

    expect(response.status).toBe(303);
    expect(testFixture.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(testFixture.rpc).not.toHaveBeenCalled();
    expect(mocks.saveGoogleConnectionFromLogin).not.toHaveBeenCalled();
  });

  it("rejects an exchange without a Supabase access token to verify", async () => {
    const testFixture = fixture({ sessionAccessToken: null });

    const response = await GET(request("?code=google-code"));

    expect(response.status).toBe(303);
    expect(testFixture.getClaims).not.toHaveBeenCalled();
    expect(testFixture.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(testFixture.rpc).not.toHaveBeenCalled();
  });

  it("rejects a mismatch between the signed subject and Auth user", async () => {
    const testFixture = fixture({ claimsSubject: "different-user" });

    const response = await GET(request("?code=google-code"));

    expect(response.status).toBe(303);
    expect(testFixture.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(testFixture.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when signed claims cannot be verified", async () => {
    const testFixture = fixture({ claimsError: new Error("invalid JWT") });

    const response = await GET(request("?code=google-code"));

    expect(response.status).toBe(303);
    expect(testFixture.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(testFixture.rpc).not.toHaveBeenCalled();
    expect(mocks.saveGoogleConnectionFromLogin).not.toHaveBeenCalled();
  });

  it("blocks provisioning when the provider token fails Google attestation", async () => {
    mocks.saveGoogleConnectionFromLogin.mockResolvedValue({
      error: "scope-attestation-failed",
      saved: false,
    });
    const testFixture = fixture();

    const response = await GET(request("?code=provider-code"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://os.qarizmi.com/login?error=google-only",
    );
    expect(mocks.saveGoogleConnectionFromLogin).toHaveBeenCalledOnce();
    expect(testFixture.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(testFixture.rpc).not.toHaveBeenCalled();
  });

  it("blocks provisioning when Google attestation throws", async () => {
    mocks.saveGoogleConnectionFromLogin.mockRejectedValue(
      new Error("provider unavailable"),
    );
    const testFixture = fixture();

    const response = await GET(request("?code=provider-code"));

    expect(response.status).toBe(303);
    expect(testFixture.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(testFixture.rpc).not.toHaveBeenCalled();
  });
});

function request(query: string) {
  return new NextRequest(`https://os.qarizmi.com/auth/callback${query}`);
}

function fixture({
  claimsError = null,
  claimsSubject = "user-ali",
  method = "oauth",
  providerToken = "provider-token",
  providers = ["email", "google"],
  sessionAccessToken = "supabase-access-token",
}: {
  claimsError?: Error | null;
  claimsSubject?: string;
  method?: string;
  providerToken?: string | null;
  providers?: string[];
  sessionAccessToken?: string | null;
} = {}) {
  const user = {
    app_metadata: { provider: "email", providers },
    email: "ali@qarizmi.com",
    id: "user-ali",
    identities: providers.map((provider) => ({ provider })),
  };
  const exchangeCodeForSession = vi.fn().mockResolvedValue({
    data: {
      session: {
        access_token: sessionAccessToken,
        provider_refresh_token: "provider-refresh-token",
        provider_token: providerToken,
      },
    },
    error: null,
  });
  const getClaims = vi.fn().mockResolvedValue({
    data: claimsError
      ? null
      : {
          claims: {
            amr: [{ method, timestamp: 1_722_000_000 }],
            app_metadata: { provider: "email", providers },
            email: "ali@qarizmi.com",
            sub: claimsSubject,
          },
        },
    error: claimsError,
  });
  const getUser = vi.fn().mockResolvedValue({
    data: { user },
    error: null,
  });
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const verifyOtp = vi.fn();

  mocks.createServerClient.mockReturnValue({
    auth: {
      exchangeCodeForSession,
      getClaims,
      getUser,
      signOut,
      verifyOtp,
    },
    rpc,
  });

  return {
    exchangeCodeForSession,
    getClaims,
    getUser,
    rpc,
    signOut,
    verifyOtp,
  };
}
