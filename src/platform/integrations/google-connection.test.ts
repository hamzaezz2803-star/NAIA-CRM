import type { User } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { saveGoogleConnectionFromLogin } from "./google-connection";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google connection scope persistence", () => {
  it("rejects an overbroad current token instead of sanitizing its metadata", async () => {
    const client = createClient({ role: "member" });
    stubTokenInfo([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.meet.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        supabase: client.supabase as never,
        user: {
          email: "stagiaire@qarizmi.com",
          id: "profile-1",
        } as User,
      }),
    ).resolves.toEqual({
      error: "Google returned an unauthorized Drive scope.",
      saved: false,
    });

    expect(client.upsert).not.toHaveBeenCalled();
  });

  it("retains a narrow Meet grant already approved through the founder flow", async () => {
    const client = createClient({
      existingScopes: ["https://www.googleapis.com/auth/drive.meet.readonly"],
      role: "owner",
    });
    stubTokenInfo([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.meet.readonly",
    ]);

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "access-token",
        supabase: client.supabase as never,
        user: { email: "ali@qarizmi.com", id: "profile-1" } as User,
      }),
    ).resolves.toEqual({ saved: true });

    expect(client.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        encrypted_token_reference: expect.stringContaining(
          "existing-refresh-token",
        ),
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/drive.meet.readonly",
        ],
      }),
      { onConflict: "organization_id,provider,connected_by_profile_id" },
    );
  });

  it("does not create a first Meet grant through ordinary founder login", async () => {
    const client = createClient({ role: "owner" });
    stubTokenInfo([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.meet.readonly",
    ]);

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        supabase: client.supabase as never,
        user: { email: "ali@qarizmi.com", id: "profile-1" } as User,
      }),
    ).resolves.toEqual({
      error: "Google returned an unauthorized Drive scope.",
      saved: false,
    });

    expect(client.upsert).not.toHaveBeenCalled();
  });

  it("fails closed when Google tokeninfo cannot attest the current scopes", async () => {
    const client = createClient({ role: "owner" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        supabase: client.supabase as never,
        user: { email: "ali@qarizmi.com", id: "profile-1" } as User,
      }),
    ).resolves.toEqual({
      error: "Google token scopes could not be verified.",
      saved: false,
    });

    expect(client.upsert).not.toHaveBeenCalled();
  });

  it("never reuses a refresh token whose stored attestation includes broad Drive", async () => {
    const client = createClient({
      existingScopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
      role: "owner",
    });
    stubTokenInfo(["https://www.googleapis.com/auth/gmail.readonly"]);

    await expect(
      saveGoogleConnectionFromLogin({
        accessToken: "safe-access-token",
        supabase: client.supabase as never,
        user: { email: "ali@qarizmi.com", id: "profile-1" } as User,
      }),
    ).resolves.toEqual({ saved: true });

    expect(client.upsert).toHaveBeenCalledOnce();
    const [payload] = client.upsert.mock.calls[0] as [
      { encrypted_token_reference: string },
    ];
    expect(JSON.parse(payload.encrypted_token_reference)).toEqual({
      access_token: "safe-access-token",
      expiry_date: expect.any(Number),
    });
  });
});

function createClient({
  existingScopes = [],
  role,
}: {
  existingScopes?: string[];
  role: string;
}) {
  const membershipQuery: Record<string, unknown> = {
    maybeSingle: vi.fn().mockResolvedValue({
      data: { organization_id: "organization-1", role },
      error: null,
    }),
  };
  const connectionQuery: Record<string, unknown> = {
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        encrypted_token_reference: JSON.stringify({
          refresh_token: "existing-refresh-token",
        }),
        scopes: existingScopes,
      },
      error: null,
    }),
  };
  for (const query of [membershipQuery, connectionQuery]) {
    for (const method of ["eq", "limit", "select"]) {
      query[method] = vi.fn(() => query);
    }
  }
  const upsert = vi.fn().mockResolvedValue({ error: null });
  connectionQuery.upsert = upsert;
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "organization_memberships") return membershipQuery;
      if (table === "integration_connections") return connectionQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  return { supabase, upsert };
}

function stubTokenInfo(scopes: string[]) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ scope: scopes.join(" ") }, { status: 200 }),
      ),
  );
}
