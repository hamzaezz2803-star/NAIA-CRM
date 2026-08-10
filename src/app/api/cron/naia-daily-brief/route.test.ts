import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runConfiguredDailyBriefs: vi.fn(),
}));

vi.mock("@/features/naia/daily-brief", () => ({
  runConfiguredDailyBriefs: mocks.runConfiguredDailyBriefs,
}));

import { GET } from "./route";

function request(secret?: string) {
  return new Request("https://os.qarizmi.com/api/cron/naia-daily-brief", {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe("NAIA daily brief cron route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    mocks.runConfiguredDailyBriefs.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects missing authorization without loading private data", async () => {
    const missing = await GET(request());

    expect(missing.status).toBe(401);
    expect(mocks.runConfiguredDailyBriefs).not.toHaveBeenCalled();
  });

  it("rejects a wrong Bearer secret without running the brief", async () => {
    const invalid = await GET(request("wrong-secret"));

    expect(invalid.status).toBe(401);
    expect(mocks.runConfiguredDailyBriefs).not.toHaveBeenCalled();
  });

  it("returns only aggregate delivery counts", async () => {
    mocks.runConfiguredDailyBriefs.mockResolvedValue([
      { email: "ali@qarizmi.com", status: "sent" },
      {
        email: "nabil@qarizmi.com",
        reason: "outside_local_dispatch_window",
        status: "skipped",
      },
    ]);

    const response = await GET(request("test-cron-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      summary: { failed: 0, sent: 1, skipped: 1 },
    });
  });

  it("signals when a private delivery fails", async () => {
    mocks.runConfiguredDailyBriefs.mockResolvedValue([
      {
        email: "ali@qarizmi.com",
        reason: "slack_recipient_not_found",
        status: "failed",
      },
    ]);

    const response = await GET(request("test-cron-secret"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      summary: { failed: 1, sent: 0, skipped: 0 },
    });
  });
});
