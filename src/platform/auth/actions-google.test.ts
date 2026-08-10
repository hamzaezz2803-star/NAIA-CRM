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

import {
  changePasswordAction,
  requestMagicLinkAction,
  signInWithGoogleAction,
  signInWithPasswordAction,
} from "./actions";

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

  it("requests only the ordinary least-privilege scopes without merging grants", async () => {
    const formData = new FormData();
    formData.set("redirectedFrom", "/meetings");

    await expect(signInWithGoogleAction(formData)).rejects.toThrow(
      "REDIRECT:https://accounts.google.com/o/oauth2/v2/auth?state=test",
    );

    const options = mocks.signInWithOAuth.mock.calls[0]?.[0]?.options;
    expect(options.queryParams).not.toHaveProperty("include_granted_scopes");
    expect(options.scopes).toBe(
      [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/gmail.readonly",
      ].join(" "),
    );
    expect(options.scopes).not.toContain("gmail.send");
  });

  it.each([
    ["magic-link", requestMagicLinkAction],
    ["password", signInWithPasswordAction],
  ])(
    "fails the legacy %s action closed without touching Supabase",
    async (_, action) => {
      const formData = new FormData();
      formData.set("email", "ali@qarizmi.com");
      formData.set("password", "unused-password");
      formData.set("redirectedFrom", "/meetings");

      await expect(action(formData)).rejects.toThrow(
        "REDIRECT:/login?error=google-only&redirectedFrom=%2Fmeetings",
      );
      expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
      expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
    },
  );

  it("fails password changes closed without modifying the Auth user", async () => {
    const formData = new FormData();
    formData.set("newPassword", "must-not-be-used");

    await expect(changePasswordAction(formData)).resolves.toEqual({
      error:
        "NAIA-os utilise exclusivement la connexion Google. Aucun mot de passe ne peut être créé ou modifié ici.",
    });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });
});
