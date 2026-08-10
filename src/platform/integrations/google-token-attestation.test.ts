import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GOOGLE_USER_SCOPES } from "./google-workspace-scopes";
import { attestGoogleAccessToken } from "./google-token-attestation";

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google access-token provider attestation", () => {
  it("uses POST, validates audience, and never puts the credential in a URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        aud: "client-id",
        scope: GOOGLE_USER_SCOPES.join(" "),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      attestGoogleAccessToken({
        accessToken: "sensitive-access-token",
        intent: "user",
      }),
    ).resolves.toEqual({
      ok: true,
      scopes: [...GOOGLE_USER_SCOPES].sort(),
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/tokeninfo");
    expect(url).not.toContain("sensitive-access-token");
    expect(init.method).toBe("POST");
    expect((init.body as URLSearchParams).get("access_token")).toBe(
      "sensitive-access-token",
    );
  });

  it.each([
    { audience: "client-id" },
    { issued_to: "client-id" },
    { audience: "client-id", issued_to: "client-id" },
  ])(
    "accepts production-shaped access-token audience fields",
    async (audience) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            ...audience,
            scope: GOOGLE_USER_SCOPES.join(" "),
          }),
        ),
      );

      await expect(
        attestGoogleAccessToken({
          accessToken: "access-token",
          intent: "user",
        }),
      ).resolves.toMatchObject({ ok: true });
    },
  );

  it("fails closed when the configured audience is missing or different", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ scope: GOOGLE_USER_SCOPES.join(" ") }),
      )
      .mockResolvedValueOnce(
        Response.json({
          aud: "other-client",
          scope: GOOGLE_USER_SCOPES.join(" "),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      attestGoogleAccessToken({ accessToken: "one", intent: "user" }),
    ).resolves.toMatchObject({ ok: false, reason: "audience" });
    await expect(
      attestGoogleAccessToken({ accessToken: "two", intent: "user" }),
    ).resolves.toMatchObject({ ok: false, reason: "audience" });
  });

  it.each([
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.file",
  ])("rejects a refreshed broad scope before use: %s", async (broadScope) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          audience: "client-id",
          scope: [...GOOGLE_USER_SCOPES, broadScope].join(" "),
        }),
      ),
    );

    await expect(
      attestGoogleAccessToken({
        accessToken: "refreshed-token",
        intent: "user",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "scopes" });
  });

  it("requires the refreshed scope set to match the stored server attestation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          audience: "client-id",
          scope: [...GOOGLE_USER_SCOPES, "openid"].join(" "),
        }),
      ),
    );

    await expect(
      attestGoogleAccessToken({
        accessToken: "refreshed-token",
        expectedScopes: GOOGLE_USER_SCOPES,
        intent: "user",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "scope-mismatch" });
  });
});
