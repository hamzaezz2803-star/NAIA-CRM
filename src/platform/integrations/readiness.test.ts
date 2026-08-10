import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { getIntegrationReadiness } from "./readiness";

describe("integration readiness", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("requires both Slack server credentials before reporting readiness", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(null);
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    vi.stubEnv("SLACK_SIGNING_SECRET", "");

    const readiness = await getIntegrationReadiness();
    const slack = readiness.find((item) => item.provider === "slack");

    expect(slack).toMatchObject({
      missingEnvVars: ["SLACK_SIGNING_SECRET"],
      status: "not-configured",
    });
  });

  it("reports Slack as not configured when the bot token is missing", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(null);
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    vi.stubEnv("SLACK_SIGNING_SECRET", "signing-secret");

    const readiness = await getIntegrationReadiness();
    const slack = readiness.find((item) => item.provider === "slack");

    expect(slack).toMatchObject({
      missingEnvVars: ["SLACK_BOT_TOKEN"],
      status: "not-configured",
    });
  });

  it("reports server-configured Slack as connected without a user OAuth row", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(null);
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    vi.stubEnv("SLACK_SIGNING_SECRET", "signing-secret");

    const readiness = await getIntegrationReadiness();
    const slack = readiness.find((item) => item.provider === "slack");

    expect(slack).toMatchObject({
      detail: "Bot Slack et verification des webhooks configures cote serveur.",
      missingEnvVars: [],
      status: "connected",
    });
    expect(slack?.plannedScopes).toEqual(
      expect.arrayContaining(["users:read.email", "im:history", "chat:write"]),
    );
  });

  it("reports a connected legacy broad Drive credential as needs-review", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    mocks.createServerSupabaseClient.mockResolvedValue(
      createGoogleReadinessClient("connected"),
    );

    const readiness = await getIntegrationReadiness();
    const google = readiness.find((item) => item.provider === "google");

    expect(google).toMatchObject({
      detail: expect.stringMatching(/autorisation Drive trop large/iu),
      externalAccountLabel: "ali@qarizmi.com",
      requiresRevocation: true,
      status: "needs-review",
    });
  });

  it("keeps failed legacy revocations actionable but considers a revoked row ready to reconnect", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    mocks.createServerSupabaseClient.mockResolvedValue(
      createGoogleReadinessClient("needs-review"),
    );

    const failedReadiness = await getIntegrationReadiness();
    expect(
      failedReadiness.find((item) => item.provider === "google"),
    ).toMatchObject({ requiresRevocation: true, status: "needs-review" });

    mocks.createServerSupabaseClient.mockResolvedValue(
      createGoogleReadinessClient("revoked"),
    );
    const revokedReadiness = await getIntegrationReadiness();
    expect(
      revokedReadiness.find((item) => item.provider === "google"),
    ).toMatchObject({ status: "ready-to-connect" });
    expect(
      revokedReadiness.find((item) => item.provider === "google"),
    ).not.toHaveProperty("requiresRevocation", true);
  });
});

function createGoogleReadinessClient(status: string) {
  const membershipQuery: Record<string, unknown> = {
    maybeSingle: vi.fn().mockResolvedValue({
      data: { organization_id: "organization-1" },
      error: null,
    }),
  };
  for (const method of ["eq", "limit", "select"]) {
    membershipQuery[method] = vi.fn(() => membershipQuery);
  }
  const connectionResult = {
    data: [
      {
        encrypted_token_reference: "sealed-token-reference",
        external_account_label: "ali@qarizmi.com",
        provider: "google",
        scopes: [
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.freebusy",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/drive.file",
        ],
        status,
      },
    ],
    error: null,
  };
  const connectionQuery: Record<string, unknown> = {
    then: (resolve: (value: typeof connectionResult) => unknown) =>
      Promise.resolve(resolve(connectionResult)),
  };
  for (const method of ["eq", "select"]) {
    connectionQuery[method] = vi.fn(() => connectionQuery);
  }
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "profile-1" } },
        error: null,
      }),
    },
    from: vi.fn((table: string) =>
      table === "organization_memberships" ? membershipQuery : connectionQuery,
    ),
  };
}
