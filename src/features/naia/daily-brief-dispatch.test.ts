import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleSupabaseClient: vi.fn(),
  findSlackUserByEmail: vi.fn(),
  isSlackMessageRejectedError: vi.fn(),
  listGmailThreadMetadata: vi.fn(),
  listGoogleCalendarEvents: vi.fn(),
  postSlackMessage: vi.fn(),
  resolveBridgeUser: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

vi.mock("@/platform/integrations/google-workspace", () => ({
  listGmailThreadMetadata: mocks.listGmailThreadMetadata,
  listGoogleCalendarEvents: mocks.listGoogleCalendarEvents,
}));

vi.mock("@/platform/integrations/slack", () => ({
  findSlackUserByEmail: mocks.findSlackUserByEmail,
  isSlackMessageRejectedError: mocks.isSlackMessageRejectedError,
  postSlackMessage: mocks.postSlackMessage,
}));

vi.mock("@/platform/naia/bridge", () => ({
  resolveBridgeUser: mocks.resolveBridgeUser,
}));

import {
  dispatchDailyBrief,
  loadDailyBriefData,
  runConfiguredDailyBriefs,
} from "./daily-brief";

const NOW = new Date("2026-08-10T08:30:00.000Z");
const TIME_ZONE = "Africa/Casablanca";
const OWNER = {
  email: "ali@qarizmi.com",
  fullName: "Ali EL ABBASSY",
  organizationId: "org-1",
  profileId: "profile-ali",
  role: "owner" as const,
};

function createSupabaseMock({
  claimResult = { data: { id: "run-1" }, error: null },
  reclaimResult = { data: null, error: null },
  updateErrors = [],
}: {
  claimResult?: {
    data: { id: string } | null;
    error: { code?: string } | null;
  };
  reclaimResult?: {
    data: { id: string } | null;
    error: { code?: string } | null;
  };
  updateErrors?: Array<{ message: string } | null>;
} = {}) {
  let updateIndex = 0;
  const updateFinalEq = vi.fn().mockImplementation(async () => ({
    error: updateErrors[updateIndex++] ?? null,
  }));
  const updateFirstEq = vi.fn(() => ({ eq: updateFinalEq }));
  const update = vi.fn(() => ({ eq: updateFirstEq }));
  const insertSingle = vi.fn().mockResolvedValue(claimResult);
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({ single: insertSingle })),
  }));
  const rpcMaybeSingle = vi.fn().mockResolvedValue(reclaimResult);
  const rpc = vi.fn(() => ({ maybeSingle: rpcMaybeSingle }));
  const from = vi.fn((table: string) => {
    if (table === "naia_daily_brief_runs") return { insert, update };

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

  return {
    client: { from, rpc },
    insert,
    rpc,
    update,
    updateFinalEq,
  };
}

describe("NAIA daily brief dispatch", () => {
  beforeEach(() => {
    vi.stubEnv("NAIA_DAILY_BRIEF_RECIPIENTS", "ali@qarizmi.com");
    vi.stubEnv("NAIA_DAILY_BRIEF_TIME_ZONE", TIME_ZONE);
    mocks.resolveBridgeUser.mockResolvedValue(OWNER);
    mocks.listGmailThreadMetadata.mockResolvedValue([]);
    mocks.listGoogleCalendarEvents.mockResolvedValue([]);
    mocks.isSlackMessageRejectedError.mockReturnValue(false);
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
    vi.restoreAllMocks();
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

  it("starts both founder dispatches concurrently under one cron budget", async () => {
    vi.stubEnv(
      "NAIA_DAILY_BRIEF_RECIPIENTS",
      "ali@qarizmi.com,nabil@qarizmi.com",
    );
    const supabase = createSupabaseMock();
    mocks.createServiceRoleSupabaseClient.mockReturnValue(supabase.client);
    let releaseAli: ((user: typeof OWNER) => void) | undefined;
    const pendingAli = new Promise<typeof OWNER>((resolve) => {
      releaseAli = resolve;
    });
    mocks.resolveBridgeUser.mockImplementation((email: string) =>
      email === "ali@qarizmi.com"
        ? pendingAli
        : Promise.resolve({
            ...OWNER,
            email: "nabil@qarizmi.com",
            fullName: "Nabil",
            profileId: "profile-nabil",
          }),
    );

    const running = runConfiguredDailyBriefs({ now: NOW });
    await vi.waitFor(() =>
      expect(mocks.resolveBridgeUser).toHaveBeenCalledTimes(2),
    );
    releaseAli?.(OWNER);

    await expect(running).resolves.toEqual([
      { email: "ali@qarizmi.com", status: "sent" },
      { email: "nabil@qarizmi.com", status: "sent" },
    ]);
  });

  it("claims once and sends a founder-only Slack DM", async () => {
    const supabase = createSupabaseMock();
    mocks.createServiceRoleSupabaseClient.mockReturnValue(supabase.client);

    await expect(
      dispatchDailyBrief({
        email: "ali@qarizmi.com",
        now: NOW,
        timeZone: TIME_ZONE,
      }),
    ).resolves.toEqual({ email: "ali@qarizmi.com", status: "sent" });

    expect(mocks.listGmailThreadMetadata).toHaveBeenCalledWith(
      {
        maxResults: 100,
        query:
          "newer_than:30d -in:sent -in:drafts -in:spam -in:trash -category:promotions -category:social -category:forums -from:notifications@github.com -from:noreply -from:no-reply -from:donotreply -from:do-not-reply -from:dependabot",
      },
      expect.objectContaining({
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    );
    expect(mocks.findSlackUserByEmail).toHaveBeenCalledWith("ali@qarizmi.com");
    expect(mocks.postSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "U123",
        text: expect.stringContaining("Briefing NAIA"),
      }),
    );
    expect(supabase.updateFinalEq).toHaveBeenCalledWith(
      "organization_id",
      "org-1",
    );
    expect(supabase.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        delivery_started_at: expect.any(String),
      }),
    );
    expect(supabase.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.postSlackMessage.mock.invocationCallOrder[0],
    );
  });

  it("bounds a stalled Google read and continues with an explicit warning", async () => {
    vi.useFakeTimers();
    try {
      const supabase = createSupabaseMock();
      mocks.listGoogleCalendarEvents.mockReturnValue(new Promise(() => {}));

      const loading = loadDailyBriefData({
        now: NOW,
        supabase: supabase.client as never,
        user: OWNER,
      });
      await vi.advanceTimersByTimeAsync(12_000);

      await expect(loading).resolves.toEqual(
        expect.objectContaining({
          calendarEvents: [],
          warnings: expect.arrayContaining(["calendar_unavailable"]),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a 23505 conflict as an active duplicate when no failed row can be reclaimed", async () => {
    const supabase = createSupabaseMock({
      claimResult: { data: null, error: { code: "23505" } },
    });
    mocks.createServiceRoleSupabaseClient.mockReturnValue(supabase.client);

    await expect(
      dispatchDailyBrief({ email: OWNER.email, now: NOW, timeZone: TIME_ZONE }),
    ).resolves.toEqual({
      email: OWNER.email,
      reason: "already_claimed_for_local_date",
      status: "skipped",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("reclaim_naia_daily_brief_run", {
      p_local_date: "2026-08-10",
      p_organization_id: "org-1",
      p_profile_id: "profile-ali",
    });
    expect(mocks.postSlackMessage).not.toHaveBeenCalled();
  });

  it("atomically reclaims a failed run after the insert reports 23505", async () => {
    const supabase = createSupabaseMock({
      claimResult: { data: null, error: { code: "23505" } },
      reclaimResult: { data: { id: "failed-run-1" }, error: null },
    });
    mocks.createServiceRoleSupabaseClient.mockReturnValue(supabase.client);

    await expect(
      dispatchDailyBrief({ email: OWNER.email, now: NOW, timeZone: TIME_ZONE }),
    ).resolves.toEqual({ email: OWNER.email, status: "sent" });
    expect(mocks.postSlackMessage).toHaveBeenCalledTimes(1);
  });

  it("reports a sent-ledger update failure instead of silently succeeding", async () => {
    const supabase = createSupabaseMock({
      updateErrors: [null, { message: "database unavailable" }],
    });
    mocks.createServiceRoleSupabaseClient.mockReturnValue(supabase.client);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      dispatchDailyBrief({ email: OWNER.email, now: NOW, timeZone: TIME_ZONE }),
    ).resolves.toEqual({
      email: OWNER.email,
      reason: "daily_brief_sent_ledger_update_failed",
      status: "failed",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "NAIA daily brief sent but its ledger update failed.",
    );
  });

  it("marks an ambiguous Slack transport failure as non-retryable", async () => {
    const supabase = createSupabaseMock();
    mocks.createServiceRoleSupabaseClient.mockReturnValue(supabase.client);
    mocks.postSlackMessage.mockRejectedValue(new Error("network timeout"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      dispatchDailyBrief({ email: OWNER.email, now: NOW, timeZone: TIME_ZONE }),
    ).resolves.toEqual({
      email: OWNER.email,
      reason: "network_timeout",
      status: "failed",
    });
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "delivery_uncertain" }),
    );
  });

  it("marks an explicit Slack rejection as retryable", async () => {
    const supabase = createSupabaseMock();
    mocks.createServiceRoleSupabaseClient.mockReturnValue(supabase.client);
    const rejection = new Error("Slack rejected the message: rate_limited");
    mocks.postSlackMessage.mockRejectedValue(rejection);
    mocks.isSlackMessageRejectedError.mockImplementation(
      (error) => error === rejection,
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await dispatchDailyBrief({
      email: OWNER.email,
      now: NOW,
      timeZone: TIME_ZONE,
    });

    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });
});
