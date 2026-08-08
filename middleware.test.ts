import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  isAuthorizedUser: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/platform/auth/access", () => ({
  isAuthorizedUser: mocks.isAuthorizedUser,
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
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.isAuthorizedUser.mockReturnValue(true);
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: mocks.getUser,
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
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "outside@example.com" } },
      error: null,
    });
    mocks.isAuthorizedUser.mockReturnValue(false);

    const response = await middleware(
      new NextRequest("https://os.qarizmi.com/api/naia/orchestrate", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Not authorized.",
    });
    expect(mocks.signOut).toHaveBeenCalledOnce();
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
});
