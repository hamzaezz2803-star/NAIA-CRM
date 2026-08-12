import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drainWhatsAppInboundQueue: vi.fn(),
  processWhatsAppInboundMessage: vi.fn(),
}));

vi.mock("@/platform/naia/whatsapp-inbox", () => ({
  drainWhatsAppInboundQueue: mocks.drainWhatsAppInboundQueue,
}));

vi.mock("@/platform/naia/whatsapp-inbound", () => ({
  processWhatsAppInboundMessage: mocks.processWhatsAppInboundMessage,
}));

import { GET } from "./route";

function request(secret?: string) {
  return new Request("https://os.qarizmi.com/api/cron/naia-whatsapp-inbox", {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe("NAIA WhatsApp inbox recovery cron", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    mocks.drainWhatsAppInboundQueue.mockResolvedValue({
      claimed: 0,
      completed: 0,
      failed: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects missing or invalid authorization", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong-secret"))).status).toBe(401);
    expect(mocks.drainWhatsAppInboundQueue).not.toHaveBeenCalled();
  });

  it("drains a bounded inbox batch with the production processor", async () => {
    mocks.drainWhatsAppInboundQueue.mockResolvedValue({
      claimed: 2,
      completed: 2,
      failed: 0,
    });

    const response = await GET(request("test-cron-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: { claimed: 2, completed: 2, failed: 0 },
    });
    expect(mocks.drainWhatsAppInboundQueue).toHaveBeenCalledWith({
      maxMessages: 4,
      processMessage: mocks.processWhatsAppInboundMessage,
    });
  });

  it("keeps failures observable for the next cron retry", async () => {
    mocks.drainWhatsAppInboundQueue.mockResolvedValue({
      claimed: 1,
      completed: 0,
      failed: 1,
    });

    const response = await GET(request("test-cron-secret"));

    expect(response.status).toBe(503);
    expect((await response.json()).ok).toBe(false);
  });
});
