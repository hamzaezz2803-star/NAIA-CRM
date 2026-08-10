// @vitest-environment node

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

async function audioRequest(audio: Blob, declaredLength?: number) {
  const form = new FormData();
  form.append("audio", audio, "recording.webm");
  const encoded = new Request("https://os.qarizmi.com/api/naia/transcribe", {
    body: form,
    headers: {
      Origin: "https://os.qarizmi.com",
      "Sec-Fetch-Site": "same-origin",
    },
    method: "POST",
  });
  encoded.headers.set(
    "Content-Length",
    String(declaredLength ?? audio.size + 512),
  );
  return encoded;
}

describe("NAIA transcription route", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mocks.authorizeExternalAiRequest.mockResolvedValue({
      allowed: true,
      profileId: "profile-ali",
      supabase: {},
    });
    mocks.consumeExternalAiQuota.mockResolvedValue(null);
    mocks.fetchExternalAi.mockResolvedValue(
      Response.json({ text: "Bonjour NAIA" }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("reports read-only availability without calling the provider", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: true });
    expect(mocks.fetchExternalAi).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME before quota or provider work", async () => {
    const response = await POST(
      await audioRequest(new Blob(["x"], { type: "text/plain" })),
    );

    expect({
      body: await response.clone().json(),
      status: response.status,
    }).toEqual({
      body: { mode: "unsupported-audio-type", transcript: "" },
      status: 415,
    });
    expect(mocks.consumeExternalAiQuota).not.toHaveBeenCalled();
    expect(mocks.fetchExternalAi).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized request before provider work", async () => {
    const response = await POST(
      await audioRequest(
        new Blob(["audio"], { type: "audio/webm" }),
        11 * 1024 * 1024,
      ),
    );

    expect(response.status).toBe(413);
    expect(mocks.fetchExternalAi).not.toHaveBeenCalled();
  });

  it("transcribes bounded allowlisted audio with one mocked provider call", async () => {
    const response = await POST(
      await audioRequest(new Blob(["audio"], { type: "audio/webm" })),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "groq",
      transcript: "Bonjour NAIA",
    });
    expect(mocks.fetchExternalAi).toHaveBeenCalledTimes(1);
  });
});
