import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeExternalAiRequest: vi.fn(),
  consumeExternalAiQuota: vi.fn(),
  fetchExternalAi: vi.fn(),
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
    fetchExternalAi: mocks.fetchExternalAi,
  };
});

import { POST } from "./route";

function audioRequest(
  body: string,
  contentType = "audio/webm",
  declaredLength?: number,
) {
  return new Request("https://os.qarizmi.com/api/crm/transcribe", {
    body,
    headers: {
      "Content-Length": String(declaredLength ?? Buffer.byteLength(body)),
      "Content-Type": contentType,
      Origin: "https://os.qarizmi.com",
      "Sec-Fetch-Site": "same-origin",
    },
    method: "POST",
  });
}

describe("CRM transcription route", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mocks.authorizeExternalAiRequest.mockResolvedValue({
      allowed: true,
      profileId: "profile-ali",
      supabase: {},
    });
    mocks.consumeExternalAiQuota.mockResolvedValue(null);
    mocks.fetchExternalAi.mockResolvedValue(
      Response.json({ text: "Relancer le client mardi" }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects oversized audio before quota or provider work", async () => {
    const response = await POST(
      audioRequest("audio", "audio/webm", 11 * 1024 * 1024),
    );

    expect(response.status).toBe(413);
    expect(mocks.consumeExternalAiQuota).not.toHaveBeenCalled();
    expect(mocks.fetchExternalAi).not.toHaveBeenCalled();
  });

  it("rejects non-audio MIME before provider work", async () => {
    const response = await POST(audioRequest("audio", "application/pdf"));

    expect(response.status).toBe(415);
    expect(mocks.fetchExternalAi).not.toHaveBeenCalled();
  });

  it("transcribes bounded audio with one mocked Groq call", async () => {
    const response = await POST(audioRequest("audio"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Relancer le client mardi" });
    expect(mocks.fetchExternalAi).toHaveBeenCalledTimes(1);
  });
});
