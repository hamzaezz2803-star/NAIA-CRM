import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_MEETING_NOTE_SCOPE,
  GOOGLE_USER_SCOPES,
} from "./google-workspace-scopes";
import {
  GoogleReattestSafeError,
  runGoogleOAuthReattestation,
  type GoogleReattestDependencies,
} from "./google-reattest-runner";

describe("Google quarantined credential re-attestation", () => {
  it("requires an explicit apply confirmation", async () => {
    const expectedError: Partial<GoogleReattestSafeError> = {
      code: "CONFIRMATION_REQUIRED",
    };
    await expect(
      runGoogleOAuthReattestation(
        { clientId: "client-id", confirmApply: false, mode: "apply" },
        dependencies(),
      ),
    ).rejects.toMatchObject(expectedError);
  });

  it("dry-runs a provider-attested ordinary credential without persistence", async () => {
    const deps = dependencies();

    const result = await runGoogleOAuthReattestation(
      { clientId: "client-id", confirmApply: false, mode: "dry-run" },
      deps,
    );

    expect(result).toEqual({
      accountMismatch: 0,
      eligible: 1,
      missingCredential: 0,
      mode: "dry-run",
      providerRejected: 0,
      reconnected: 0,
      scanned: 1,
      scopeRejected: 0,
    });
    expect(deps.persist).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("access-token");
    expect(JSON.stringify(result)).not.toContain("refresh-token");
  });

  it("rejects broad scope before resolving Gmail identity or persisting", async () => {
    const deps = dependencies({
      scopes: [
        ...GOOGLE_USER_SCOPES,
        "https://www.googleapis.com/auth/gmail.send",
      ],
    });

    const result = await runGoogleOAuthReattestation(
      { clientId: "client-id", confirmApply: false, mode: "dry-run" },
      deps,
    );

    expect(result.scopeRejected).toBe(1);
    expect(deps.resolveGoogleAccountEmail).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("permits Meet scope only for the verified founder actor", async () => {
    const founder = dependencies({
      founderMeetingAccess: true,
      scopes: [...GOOGLE_USER_SCOPES, GOOGLE_MEETING_NOTE_SCOPE],
    });
    const member = dependencies({
      founderMeetingAccess: false,
      scopes: [...GOOGLE_USER_SCOPES, GOOGLE_MEETING_NOTE_SCOPE],
    });

    await expect(
      runGoogleOAuthReattestation(
        { clientId: "client-id", confirmApply: false, mode: "dry-run" },
        founder,
      ),
    ).resolves.toMatchObject({ eligible: 1, scopeRejected: 0 });
    await expect(
      runGoogleOAuthReattestation(
        { clientId: "client-id", confirmApply: false, mode: "dry-run" },
        member,
      ),
    ).resolves.toMatchObject({ eligible: 0, scopeRejected: 1 });
  });

  it("requires the Gmail account identity to match the server profile", async () => {
    const deps = dependencies({ googleAccountEmail: "attacker@example.com" });

    const result = await runGoogleOAuthReattestation(
      { clientId: "client-id", confirmApply: false, mode: "dry-run" },
      deps,
    );

    expect(result.accountMismatch).toBe(1);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("apply persists only the newly attested envelope and safe scopes", async () => {
    const deps = dependencies();

    const result = await runGoogleOAuthReattestation(
      { clientId: "client-id", confirmApply: true, mode: "apply" },
      deps,
    );

    expect(result.reconnected).toBe(1);
    expect(deps.persist).toHaveBeenCalledWith({
      candidate: expect.objectContaining({
        id: "connection-1",
        organizationId: "organization-1",
        profileId: "profile-1",
      }),
      scopes: [...GOOGLE_USER_SCOPES].sort(),
      tokenReference: expect.any(String),
    });
    const tokenReference = (deps.persist as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0].tokenReference as string;
    expect(JSON.parse(tokenReference)).toMatchObject({
      access_token: "refreshed-access-token",
      refresh_token: "stored-refresh-token",
    });
  });
});

function dependencies({
  founderMeetingAccess = false,
  googleAccountEmail = "ali@qarizmi.com",
  scopes = [...GOOGLE_USER_SCOPES],
}: {
  founderMeetingAccess?: boolean;
  googleAccountEmail?: string;
  scopes?: string[];
} = {}): GoogleReattestDependencies {
  return {
    attestAccessToken: vi.fn().mockResolvedValue({
      audiences: ["client-id"],
      scopes,
    }),
    getActor: vi.fn().mockResolvedValue({
      email: "ali@qarizmi.com",
      founderMeetingAccess,
    }),
    listCandidates: vi.fn().mockResolvedValue([
      {
        encryptedTokenReference: JSON.stringify({
          refresh_token: "stored-refresh-token",
        }),
        id: "connection-1",
        organizationId: "organization-1",
        profileId: "profile-1",
        updatedAt: "2026-08-10T01:00:00.000Z",
      },
    ]),
    persist: vi.fn().mockResolvedValue(true),
    refreshAccessToken: vi.fn().mockResolvedValue({
      accessToken: "refreshed-access-token",
      expiresIn: 3600,
    }),
    resolveGoogleAccountEmail: vi.fn().mockResolvedValue(googleAccountEmail),
  };
}
