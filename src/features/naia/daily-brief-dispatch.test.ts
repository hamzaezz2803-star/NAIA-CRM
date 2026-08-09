import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleSupabaseClient: vi.fn(),
  findSlackUserByEmail: vi.fn(),
  listGmailMessages: vi.fn(),
  listGoogleCalendarEvents: vi.fn(),
  postSlackMessage: vi.fn(),
  resolveBridgeUser: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

vi.mock("@/platform/integrations/google-workspace", () => ({
  listGmailMessages: mocks.listGmailMessages,
  listGoogleCalendarEvents: mocks.listGoogleCalendarEvents,
}));

vi.mock("@/platform/integrations/slack", () => ({
  findSlackUserByEmail: mocks.findSlackUserByEmail,
  postSlackMessage: mocks.postSlackMessage,
}));

vi.mock("@/platform/naia/bridge", () => ({
  resolveBridgeUser: mocks.resolveBridgeUser,
}));

import { dispatchDailyBrief, runConfiguredDailyBriefs } from "./daily-brief";

const NOW = new Date("2026-08-10T08:30:00.000Z");
const TIME_ZONE = "Africa/Casablanca";
const OWNER = {
  email: "ali@qarizmi.com",
  fullName: "Ali EL ABBASSY",
  organizationId: "org-1",
  profileId: "profile-ali",
  role: "owner",
};

describe("NAIA daily brief dispatch", () => {
  beforeEach(() => {
    vi.stubEnv("NAIA_DAILY_BRIEF_RECIPIENTS", "ali@qarizmi.com");
    vi.stubEnv("NAIA_DAILY_BRIEF_TIME_ZONE", TIME_ZONE);
    mocks.resolveBridgeUser.mockResolvedValue(OWNER);
    mocks.listGmailMessages.mockResolvedValue([]);
    mocks.listGoogleCalendarEvents.mockResolvedValue([]);
    mocks.findSlackUserByEmail.mockResolvedValue({
      displayName: "Ali",
      email: "ali@qarizmi.com",
      id: "U123",
    });
    mocks.postSlackMessage.mockResolvedValue({
      channel: "D123",
      ts: "1234.5678",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("refuses a non-founder before opening the service-role client", async () => {
    mocks.resolveBridgeUser.mockResolvedValue({
      ...OWNER,
      email: "intern@qarizmi.com",
      profileId: "profile-intern",
    });

    await expect(
      dispatchDailyBrief({
        email: "intern@qarizmi.com",
        now: NOW,
        timeZone: TIME_ZONE,
      }),
    ).resolves.toEqual({
      email: "intern@qarizmi.com",
      reason: "recipient_not_authorized",
      status: "skipped",
    });
    expect(mocks.createServiceRoleSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.postSlackMessage).not.toHaveBeenCalled();
  });

  it("isolates a recipient failure instead of aborting the cron", async () => {
    mocks.resolveBridgeUser.mockRejectedValue(
      new Error("identity_unavailable"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(runConfiguredDailyBriefs({ now: NOW })).resolves.toEqual([
      {
        email: "ali@qarizmi.com",
        reason: "identity_unavailable",
        status: "failed",
      },
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      "NAIA daily brief dispatch could not start:",
      "identity_unavailable",
    );
  });

  it("claims once and sends a founder-only Slack DM", async () => {
    const updateEq = vi.fn();
    const secondUpdateEq = vi.fn().mockResolvedValue({ error: null });
    updateEq.mockReturnValue({ eq: secondUpdateEq });
    const from = vi.fn((table: string) => {
      if (table === "naia_daily_brief_runs") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: "run-1" },
                error: null,
              }),
            })),
          })),
          update: vi.fn(() => ({ eq: updateEq })),
        };
      }

      const result =
        table === "crm_tasks"
          ? {
              data: [
                {
                  due_date: "2026-08-10T10:00:00.000Z",
                  id: "task-1",
                  status: "todo",
                  title: "Préparer le rendez-vous",
                },
              ],
              error: null,
            }
          : { data: [], error: null };
      const query = {
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        limit: vi.fn().mockResolvedValue(result),
        order: vi.fn(() => query),
        select: vi.fn(() => query),
      };
      return query;
    });
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from });

    await expect(
      dispatchDailyBrief({
        email: "ali@qarizmi.com",
        now: NOW,
        timeZone: TIME_ZONE,
      }),
    ).resolves.toEqual({ email: "ali@qarizmi.com", status: "sent" });

    expect(mocks.findSlackUserByEmail).toHaveBeenCalledWith("ali@qarizmi.com");
    expect(mocks.postSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "U123",
        text: expect.stringContaining("Briefing NAIA"),
      }),
    );
    expect(secondUpdateEq).toHaveBeenCalledWith("organization_id", "org-1");
  });
});
