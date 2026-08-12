import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import { fetchWhatsAppHistory, storeWhatsAppMessage } from "./whatsapp-memory";

type FakeResult = { data: unknown; error: unknown };
type RecordedCall = { args: unknown[]; method: string };

function createFakeSupabase(results: FakeResult[]) {
  const queries: RecordedCall[][] = [];
  const from = vi.fn(() => {
    const calls: RecordedCall[] = [];
    queries.push(calls);
    const result = results.shift() ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};

    for (const method of [
      "delete",
      "eq",
      "insert",
      "limit",
      "lt",
      "order",
      "select",
      "upsert",
    ]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ args, method });
        return builder;
      };
    }

    builder.then = (resolve: (value: FakeResult) => unknown) =>
      Promise.resolve(result).then(resolve);

    return builder;
  });

  return { client: { from }, from, queries };
}

describe("private WhatsApp memory", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stores normalized content without persisting a phone number", async () => {
    const fake = createFakeSupabase([{ data: null, error: null }]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);

    await storeWhatsAppMessage({
      content: "  Crée   le lead HPS  ",
      messageId: "wamid.command-1",
      organizationId: "org-1",
      profileId: "profile-ali",
      role: "user",
    });

    const upsert = fake.queries[0].find((call) => call.method === "upsert");
    expect(fake.from).toHaveBeenCalledWith("naia_private_whatsapp_messages");
    expect(upsert?.args[0]).toEqual({
      content: "Crée le lead HPS",
      organization_id: "org-1",
      profile_id: "profile-ali",
      role: "user",
      wamid: "wamid.command-1",
    });
    expect(upsert?.args[1]).toEqual({
      ignoreDuplicates: true,
      onConflict: "wamid",
    });
    expect(upsert?.args[0]).not.toHaveProperty("phone");
  });

  it("does not write an empty message", async () => {
    const fake = createFakeSupabase([]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);

    await storeWhatsAppMessage({
      content: "   ",
      messageId: "wamid.command-2",
      organizationId: "org-1",
      profileId: "profile-ali",
      role: "user",
    });

    expect(fake.from).not.toHaveBeenCalled();
  });

  it("reads history with organization and profile isolation", async () => {
    const fake = createFakeSupabase([
      { data: null, error: null },
      {
        data: [
          { content: "Abdeslam est le contact", role: "user" },
          { content: "Crée un lead", role: "user" },
          { content: "Réponse privée NAIA", role: "assistant" },
        ],
        error: null,
      },
    ]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);

    const history = await fetchWhatsAppHistory({
      limit: 99,
      organizationId: "org-1",
      profileId: "profile-ali",
    });

    const historyCalls = fake.queries[1];
    expect(historyCalls).toContainEqual({
      args: ["organization_id", "org-1"],
      method: "eq",
    });
    expect(historyCalls).toContainEqual({
      args: ["profile_id", "profile-ali"],
      method: "eq",
    });
    expect(historyCalls).toContainEqual({
      args: ["role", "user"],
      method: "eq",
    });
    expect(historyCalls).toContainEqual({ args: [8], method: "limit" });
    expect(history).toEqual([
      { content: "Crée un lead", role: "user" },
      { content: "Abdeslam est le contact", role: "user" },
    ]);
  });

  it("excludes the replayed wamid while retaining the prior history window", async () => {
    const fake = createFakeSupabase([
      { data: null, error: null },
      {
        data: [
          { content: "Commande rejouée", role: "user", wamid: "wamid.current" },
          ...Array.from({ length: 8 }, (_, index) => ({
            content: `Contexte ${8 - index}`,
            role: "user",
            wamid: `wamid.previous-${8 - index}`,
          })),
        ],
        error: null,
      },
    ]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);

    const history = await fetchWhatsAppHistory({
      excludeMessageId: "wamid.current",
      organizationId: "org-1",
      profileId: "profile-ali",
    });

    expect(fake.queries[1]).toContainEqual({ args: [9], method: "limit" });
    expect(history).toHaveLength(8);
    expect(history.map((message) => message.content)).not.toContain(
      "Commande rejouée",
    );
  });

  it("returns no history when the database read fails", async () => {
    const fake = createFakeSupabase([
      { data: null, error: null },
      { data: null, error: { message: "read failed" } },
    ]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const history = await fetchWhatsAppHistory({
      organizationId: "org-1",
      profileId: "profile-ali",
    });

    expect(history).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
