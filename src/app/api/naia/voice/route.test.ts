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

import { GET, POST } from "./route";

function voiceRequest(payload: unknown, declaredLength?: number) {
  const body = JSON.stringify(payload);
  return new Request("https://os.qarizmi.com/api/naia/voice", {
    body,
    headers: {
      "Content-Length": String(declaredLength ?? Buffer.byteLength(body)),
      "Content-Type": "application/json",
      Origin: "https://os.qarizmi.com",
      "Sec-Fetch-Site": "same-origin",
    },
    method: "POST",
  });
}

describe("NAIA voice route", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "officialVoice123");
    mocks.authorizeExternalAiRequest.mockResolvedValue({
      allowed: true,
      profileId: "profile-ali",
      supabase: {},
    });
    mocks.consumeExternalAiQuota.mockResolvedValue(null);
    mocks.fetchExternalAi.mockResolvedValue(
      new Response("audio-bytes", {
        headers: { "Content-Type": "audio/mpeg" },
        status: 200,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects GET without touching ElevenLabs", async () => {
    const response = await GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(mocks.fetchExternalAi).not.toHaveBeenCalled();
  });

  it("uses one bounded provider call and ignores voice overrides", async () => {
    const response = await POST(
      voiceRequest({ text: "Bonjour Ali", voiceId: "requestVoice999" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-NAIA-Voice-Provider")).toBe("elevenlabs");
    expect(mocks.fetchExternalAi).toHaveBeenCalledTimes(1);
    expect(mocks.fetchExternalAi.mock.calls[0][0]).toContain(
      "officialVoice123",
    );
    expect(mocks.fetchExternalAi.mock.calls[0][0]).not.toContain(
      "requestVoice999",
    );
  });

  it("rejects oversized text before quota or provider work", async () => {
    const response = await POST(voiceRequest({ text: "a".repeat(1201) }));

    expect(response.status).toBe(413);
    expect(mocks.consumeExternalAiQuota).not.toHaveBeenCalled();
    expect(mocks.fetchExternalAi).not.toHaveBeenCalled();
  });

  it("returns quota 429 without touching the provider", async () => {
    mocks.consumeExternalAiQuota.mockResolvedValue(
      Response.json({ error: "external-ai-quota-exceeded" }, { status: 429 }),
    );

    const response = await POST(voiceRequest({ text: "Bonjour Ali" }));

    expect(response.status).toBe(429);
    expect(mocks.fetchExternalAi).not.toHaveBeenCalled();
  });

  it("does not make a second paid call after an upstream rejection", async () => {
    mocks.fetchExternalAi.mockResolvedValue(
      Response.json({ detail: "paid plan required" }, { status: 402 }),
    );

    const response = await POST(voiceRequest({ text: "Bonjour Ali" }));

    expect(response.status).toBe(502);
    expect(mocks.fetchExternalAi).toHaveBeenCalledTimes(1);
  });
});
