import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
  signInWithOAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === "x-forwarded-host"
        ? "os.qarizmi.com"
        : name === "x-forwarded-proto"
          ? "https"
          : null,
  }),
}));
vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { signInWithGoogleAction } from "./actions";

describe("Google login scopes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { signInWithOAuth: mocks.signInWithOAuth },
    });
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=test" },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 302 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks Google to retain previously granted incremental scopes", async () => {
    const formData = new FormData();
    formData.set("redirectedFrom", "/meetings");

    await expect(signInWithGoogleAction(formData)).rejects.toThrow(
      "REDIRECT:https://accounts.google.com/o/oauth2/v2/auth?state=test",
    );

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      options: expect.objectContaining({
        queryParams: expect.objectContaining({
          include_granted_scopes: "true",
        }),
      }),
      provider: "google",
    });
  });
});
