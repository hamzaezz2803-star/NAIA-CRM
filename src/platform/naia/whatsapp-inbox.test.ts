import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import {
  drainWhatsAppInboundQueue,
  enqueueWhatsAppInboundMessages,
} from "./whatsapp-inbox";

const queuedMessage = {
  authorizedEmail: "ali@qarizmi.com",
  from: "212600000000",
  id: "wamid.queue-1",
  organizationId: "11111111-1111-1111-1111-111111111111",
  profileId: "22222222-2222-2222-2222-222222222222",
  text: { body: "  analyse   mes CFs  " },
  type: "text",
};

describe("NAIA WhatsApp durable inbox", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed before acknowledging when the service inbox is unavailable", async () => {
    mocks.createServiceRoleSupabaseClient.mockReturnValue(null);

    await expect(enqueueWhatsAppInboundMessages([queuedMessage])).resolves.toBe(
      false,
    );
  });

  it("persists a bounded authorized command idempotently before processing", async () => {
    const cleanup = chain({ error: null }, ["delete", "in", "lt"]);
    const insert = chain({ error: null }, ["upsert"]);
    const from = vi
      .fn()
      .mockReturnValueOnce(cleanup.builder)
      .mockReturnValueOnce(insert.builder);
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from });

    await expect(enqueueWhatsAppInboundMessages([queuedMessage])).resolves.toBe(
      true,
    );

    expect(from).toHaveBeenNthCalledWith(1, "naia_whatsapp_inbound_queue");
    expect(from).toHaveBeenNthCalledWith(2, "naia_whatsapp_inbound_queue");
    expect(insert.calls.upsert).toHaveBeenCalledWith(
      [
        {
          authorized_email: "ali@qarizmi.com",
          button_reply_id: null,
          media_id: null,
          message_kind: "text",
          organization_id: "11111111-1111-1111-1111-111111111111",
          profile_id: "22222222-2222-2222-2222-222222222222",
          sender_phone: "212600000000",
          text_body: "analyse mes CFs",
          wamid: "wamid.queue-1",
        },
      ],
      { ignoreDuplicates: true, onConflict: "wamid" },
    );
  });

  it("claims, processes, and completes one message behind its lease token", async () => {
    const claimRow = {
      attempts: 1,
      authorized_email: "ali@qarizmi.com",
      button_reply_id: null,
      id: "queue-1",
      lease_token: "lease-1",
      media_id: null,
      message_kind: "text",
      organization_id: "11111111-1111-1111-1111-111111111111",
      profile_id: "22222222-2222-2222-2222-222222222222",
      sender_phone: "212600000000",
      text_body: "analyse mes CFs",
      wamid: "wamid.queue-1",
    };
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: claimRow, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const rpc = vi.fn(() => ({ maybeSingle }));
    const cleanup = chain({ error: null }, ["delete", "in", "lt"]);
    const completion = chain({ data: { id: "queue-1" }, error: null }, [
      "update",
      "eq",
      "select",
      "maybeSingle",
    ]);
    const from = vi
      .fn()
      .mockReturnValueOnce(cleanup.builder)
      .mockReturnValueOnce(completion.builder);
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from, rpc });
    const processMessage = vi.fn().mockResolvedValue(undefined);

    const result = await drainWhatsAppInboundQueue({
      maxMessages: 4,
      processMessage,
    });

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(cleanup.calls.in).toHaveBeenCalledWith("status", [
      "completed",
      "failed",
    ]);
    expect(processMessage).toHaveBeenCalledWith({
      authorizedEmail: "ali@qarizmi.com",
      from: "212600000000",
      id: "wamid.queue-1",
      organizationId: "11111111-1111-1111-1111-111111111111",
      profileId: "22222222-2222-2222-2222-222222222222",
      text: { body: "analyse mes CFs" },
      type: "text",
    });
    expect(completion.calls.eq).toHaveBeenCalledWith("lease_token", "lease-1");
    expect(completion.calls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        lease_token: null,
        status: "completed",
        text_body: null,
      }),
    );
  });

  it("requeues a failed pre-delivery attempt with the same fencing token", async () => {
    const claimRow = {
      attempts: 1,
      authorized_email: "ali@qarizmi.com",
      button_reply_id: null,
      id: "queue-1",
      lease_token: "lease-1",
      media_id: "media-1",
      message_kind: "audio",
      organization_id: "11111111-1111-1111-1111-111111111111",
      profile_id: "22222222-2222-2222-2222-222222222222",
      sender_phone: "212600000000",
      text_body: null,
      wamid: "wamid.queue-1",
    };
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: claimRow, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const rpc = vi.fn(() => ({ maybeSingle }));
    const cleanup = chain({ error: null }, ["delete", "in", "lt"]);
    const release = chain({ data: null, error: null }, ["update", "eq"]);
    const from = vi
      .fn()
      .mockReturnValueOnce(cleanup.builder)
      .mockReturnValueOnce(release.builder);
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from, rpc });
    const processMessage = vi
      .fn()
      .mockRejectedValue(new Error("provider down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await drainWhatsAppInboundQueue({
      maxMessages: 1,
      processMessage,
    });

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 1 });
    expect(release.calls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error_code: "processing_failed",
        lease_token: null,
        status: "queued",
      }),
    );
    expect(release.calls.eq).toHaveBeenCalledWith("lease_token", "lease-1");
    errorSpy.mockRestore();
  });

  it("marks the fifth failed attempt terminal so later messages can proceed", async () => {
    const claimRow = {
      attempts: 5,
      authorized_email: "ali@qarizmi.com",
      button_reply_id: "naia_approve:draft-1",
      id: "queue-1",
      lease_token: "lease-5",
      media_id: null,
      message_kind: "button_reply",
      organization_id: "11111111-1111-1111-1111-111111111111",
      profile_id: "22222222-2222-2222-2222-222222222222",
      sender_phone: "212600000000",
      text_body: null,
      wamid: "wamid.queue-1",
    };
    const rpc = vi.fn(() => ({
      maybeSingle: vi.fn().mockResolvedValue({ data: claimRow, error: null }),
    }));
    const cleanup = chain({ error: null }, ["delete", "in", "lt"]);
    const release = chain({ data: null, error: null }, ["update", "eq"]);
    const from = vi
      .fn()
      .mockReturnValueOnce(cleanup.builder)
      .mockReturnValueOnce(release.builder);
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from, rpc });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await drainWhatsAppInboundQueue({
      maxMessages: 1,
      processMessage: vi.fn().mockRejectedValue(new Error("provider down")),
    });

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 1 });
    expect(release.calls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error_code: "processing_failed",
        lease_token: null,
        status: "failed",
      }),
    );
    errorSpy.mockRestore();
  });
});

function chain(result: { data?: unknown; error: unknown }, methods: string[]) {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const builder: Record<string, unknown> = {};

  for (const method of methods) {
    const mock = vi.fn(() => builder);
    calls[method] = mock;
    builder[method] = mock;
  }
  builder.then = (resolve: (value: typeof result) => unknown) =>
    Promise.resolve(result).then(resolve);
  if (methods.includes("maybeSingle")) {
    calls.maybeSingle.mockImplementation(() => Promise.resolve(result));
  }

  return { builder, calls };
}
