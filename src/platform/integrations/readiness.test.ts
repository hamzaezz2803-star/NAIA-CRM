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

  it("keeps Slack in the server-configured readiness state without a user OAuth row", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(null);
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    vi.stubEnv("SLACK_SIGNING_SECRET", "signing-secret");

    const readiness = await getIntegrationReadiness();
    const slack = readiness.find((item) => item.provider === "slack");

    expect(slack).toMatchObject({
      missingEnvVars: [],
      status: "ready-to-connect",
    });
    expect(slack?.plannedScopes).toEqual(
      expect.arrayContaining(["users:read.email", "im:history", "chat:write"]),
    );
  });
});
