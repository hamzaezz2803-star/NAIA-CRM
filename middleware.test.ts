import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  signOut: vi.fn(),
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
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

import { middleware } from "./middleware";

describe("authentication middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH_ALLOWED_EMAILS", "");
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createServerClient.mockReturnValue({
      auth: {
        getClaims: mocks.getClaims,
        signOut: mocks.signOut,
      },
    });
  });

  it("redirects anonymous page navigation to login with its destination", async () => {
    const response = await middleware(
      new NextRequest("https://os.qarizmi.com/dashboard?view=tasks"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://os.qarizmi.com/login?redirectedFrom=%2Fdashboard%3Fview%3Dtasks",
    );
  });

  it("returns JSON 401 instead of a login page for anonymous API calls", async () => {
    const response = await middleware(
      new NextRequest("https://os.qarizmi.com/api/naia/user"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated.",
    });
  });

  it("returns JSON 403 for an authenticated but unauthorized API user", async () => {
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: googleClaims({ email: "outside@example.com" }),
      },
      error: null,
    });

    const response = await middleware(
      new NextRequest("https://os.qarizmi.com/api/naia/orchestrate", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Not authorized.",
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("accepts a Google OAuth session whose primary provider remains email", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: googleClaims() },
      error: null,
    });

    const response = await middleware(
      new NextRequest("https://os.qarizmi.com/dashboard"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each(["magiclink", "password", "otp"])(
    "rejects a %s session even when the account is linked to Google",
    async (method) => {
      mocks.getClaims.mockResolvedValue({
        data: {
          claims: googleClaims({ method }),
        },
        error: null,
      });

      const response = await middleware(
        new NextRequest("https://os.qarizmi.com/api/naia/user"),
      );

      expect(response.status).toBe(403);
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    },
  );

  it("rejects an OAuth session without a linked Google identity", async () => {
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: googleClaims({ providers: ["email"] }),
      },
      error: null,
    });

    const response = await middleware(
      new NextRequest("https://os.qarizmi.com/api/naia/user"),
    );

    expect(response.status).toBe(403);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("returns JSON 503 for protected APIs when authentication is unavailable", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);

    const response = await middleware(
      new NextRequest("https://os.qarizmi.com/api/naia/user"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication is not configured.",
    });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("leaves signed webhook routes to their own request verification", async () => {
    const response = await middleware(
      new NextRequest("https://os.qarizmi.com/api/slack/events", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each(["naia-daily-brief", "naia-whatsapp-inbox"])(
    "lets the cookie-less %s Vercel cron reach its bearer-protected route",
    async (route) => {
      const response = await middleware(
        new NextRequest(`https://os.qarizmi.com/api/cron/${route}`),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(mocks.createServerClient).not.toHaveBeenCalled();
    },
  );
});

function googleClaims({
  email = "ali@qarizmi.com",
  method = "oauth",
  providers = ["email", "google"],
}: {
  email?: string;
  method?: string;
  providers?: string[];
} = {}) {
  return {
    amr: [{ method, timestamp: 1_722_000_000 }],
    app_metadata: { provider: "email", providers },
    email,
    sub: "user-ali",
  };
}
