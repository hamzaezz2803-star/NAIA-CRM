import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeExternalAiRequest: vi.fn(),
  completeGroqText: vi.fn(),
  consumeExternalAiQuota: vi.fn(),
  getGroqApiKey: vi.fn(),
}));

vi.mock("@/platform/ai/groq", () => ({
  completeGroqText: mocks.completeGroqText,
  getGroqApiKey: mocks.getGroqApiKey,
}));

vi.mock("@/platform/ai/external-provider-security", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/platform/ai/external-provider-security")
    >();
  return {
    ...actual,
    authorizeExternalAiRequest: mocks.authorizeExternalAiRequest,
    consumeExternalAiQuota: mocks.consumeExternalAiQuota,
  };
});

import { POST } from "./route";

function completeRequest(
  payload: unknown,
  options: { declaredLength?: number; includeLength?: boolean } = {},
) {
  const body = JSON.stringify(payload);
  const includeLength = options.includeLength ?? true;
  return new Request("https://os.qarizmi.com/api/naia/complete", {
    body,
    headers: {
      ...(includeLength
        ? {
            "Content-Length": String(
              options.declaredLength ?? Buffer.byteLength(body),
            ),
          }
        : {}),
      "Content-Type": "application/json",
      Origin: "https://os.qarizmi.com",
      "Sec-Fetch-Site": "same-origin",
    },
    method: "POST",
  });
}

describe("NAIA completion route", () => {
  beforeEach(() => {
    mocks.authorizeExternalAiRequest.mockResolvedValue({
      allowed: true,
      profileId: "profile-ali",
      supabase: {},
    });
    mocks.consumeExternalAiQuota.mockResolvedValue(null);
    mocks.getGroqApiKey.mockReturnValue("test-groq-key");
    mocks.completeGroqText.mockResolvedValue({
      data: "Réponse privée et bornée.",
      model: "test",
      usedFallback: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ignores forged client context and builds context server-side", async () => {
    const response = await POST(
      completeRequest({
        context: { secret: "FORGED_CLIENT_CONTEXT" },
        prompt: "Priorités",
        sectionId: "crm",
      }),
    );

    expect(response.status).toBe(200);
    const request = mocks.completeGroqText.mock.calls[0][0];
    const userMessage = request.messages.find(
      (message: { role: string }) => message.role === "user",
    ).content as string;
    expect(userMessage).not.toContain("FORGED_CLIENT_CONTEXT");
    expect(userMessage).toContain('"module":"CRM assiste"');
    expect(userMessage).toContain('"context"');
    expect(request.providerSurface).toBe("founder-route");
  });

  it("rejects a missing Content-Length before quota or Groq", async () => {
    const response = await POST(
      completeRequest({ prompt: "Priorités" }, { includeLength: false }),
    );

    expect(response.status).toBe(411);
    expect(mocks.consumeExternalAiQuota).not.toHaveBeenCalled();
    expect(mocks.completeGroqText).not.toHaveBeenCalled();
  });

  it("rejects actual oversized chunked content even when declared small", async () => {
    const response = await POST(
      completeRequest({ prompt: "a".repeat(17 * 1024) }, { declaredLength: 1 }),
    );

    expect(response.status).toBe(413);
    expect(mocks.consumeExternalAiQuota).not.toHaveBeenCalled();
    expect(mocks.completeGroqText).not.toHaveBeenCalled();
  });

  it("returns quota 429 without calling Groq", async () => {
    mocks.consumeExternalAiQuota.mockResolvedValue(
      Response.json({ error: "external-ai-quota-exceeded" }, { status: 429 }),
    );

    const response = await POST(completeRequest({ prompt: "Priorités" }));

    expect(response.status).toBe(429);
    expect(mocks.completeGroqText).not.toHaveBeenCalled();
  });
});
