import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

describe("NAIA voice route", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "officialVoice123");
    vi.stubEnv("ELEVENLABS_FALLBACK_VOICE_ID", "rescueVoice456");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("always uses the official voice and ignores a GET voice override", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("audio-bytes", {
        headers: { "Content-Type": "audio/mpeg" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "http://localhost/api/naia/voice?text=Bonjour%20Ali&voiceId=requestVoice999",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-NAIA-Voice-Id")).toBe("officialVoice123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("officialVoice123");
    expect(fetchMock.mock.calls[0][0]).not.toContain("requestVoice999");
  });

  it("always uses the official voice and ignores a POST voice override", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("audio-bytes", {
        headers: { "Content-Type": "audio/mpeg" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/naia/voice", {
        body: JSON.stringify({
          text: "Bonjour Ali",
          voiceId: "requestVoice999",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-NAIA-Voice-Id")).toBe("officialVoice123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("officialVoice123");
    expect(fetchMock.mock.calls[0][0]).not.toContain("requestVoice999");
  });

  it("uses browser fallback when the official voice is not configured", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/naia/voice?text=Bonjour%20Ali"),
    );
    const body = (await response.json()) as {
      mode?: string;
      reason?: string;
    };

    expect(response.status).toBe(503);
    expect(body).toEqual({
      mode: "browser",
      reason: "missing-elevenlabs-config",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the explicit rescue voice when ElevenLabs rejects the official voice", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_ID", "restrictedPrimary789");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            detail: {
              code: "paid_plan_required",
              message: "The configured voice is unavailable on this plan.",
            },
          },
          { status: 402 },
        ),
      )
      .mockResolvedValueOnce(
        new Response("audio-bytes", {
          headers: { "Content-Type": "audio/mpeg" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/naia/voice?text=Bonjour%20Ali"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-NAIA-Voice-Id")).toBe("rescueVoice456");
    expect(response.headers.get("X-NAIA-Voice-Fallback")).toBe(
      "paid_plan_required",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("restrictedPrimary789");
    expect(fetchMock.mock.calls[1][0]).toContain("rescueVoice456");
  });

  it("uses browser fallback when no explicit rescue voice is configured", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_ID", "primaryWithoutRescue789");
    vi.stubEnv("ELEVENLABS_FALLBACK_VOICE_ID", "");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { detail: { code: "paid_plan_required" } },
          { status: 402 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/naia/voice?text=Bonjour%20Ali"),
    );
    const body = (await response.json()) as {
      mode?: string;
      reason?: string;
    };

    expect(response.status).toBe(502);
    expect(body.mode).toBe("browser");
    expect(body.reason).toBe("elevenlabs-error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("short-circuits a known restricted primary to the explicit rescue voice", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_ID", "memoizedPrimary789");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { detail: { code: "paid_plan_required" } },
          { status: 402 },
        ),
      )
      .mockResolvedValueOnce(
        new Response("audio-bytes", {
          headers: { "Content-Type": "audio/mpeg" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response("audio-bytes", {
          headers: { "Content-Type": "audio/mpeg" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const first = await GET(
      new Request("http://localhost/api/naia/voice?text=Bonjour%20Ali"),
    );
    const second = await GET(
      new Request("http://localhost/api/naia/voice?text=Encore%20Ali"),
    );

    expect(first.headers.get("X-NAIA-Voice-Id")).toBe("rescueVoice456");
    expect(second.headers.get("X-NAIA-Voice-Id")).toBe("rescueVoice456");
    expect(second.headers.get("X-NAIA-Voice-Fallback")).toBe(
      "primary-voice-unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain("rescueVoice456");
  });
});
