import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("NAIA voice route", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "libraryVoice123");
    vi.stubEnv("ELEVENLABS_FALLBACK_VOICE_ID", "freeVoice456");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("falls back to the free voice when ElevenLabs rejects library voices for free accounts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            detail: {
              message:
                "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.",
            },
          },
          { status: 400 },
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
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("X-NAIA-Voice-Id")).toBe("freeVoice456");
    expect(response.headers.get("X-NAIA-Voice-Fallback")).toBe(
      "voice-unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("libraryVoice123");
    expect(fetchMock.mock.calls[1][0]).toContain("freeVoice456");
  });

  it("uses the Martin Dupont default voice when no primary voice is configured", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");

    const fetchMock = vi.fn().mockResolvedValueOnce(
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
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("X-NAIA-Voice-Id")).toBe(
      "a5n9pJUnAhX4fn7lx3uo",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("a5n9pJUnAhX4fn7lx3uo");
  });

  it("retries with the fallback voice when the Martin Dupont default is unavailable", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");

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
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/naia/voice?text=Bonjour%20Ali"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-NAIA-Voice-Id")).toBe("freeVoice456");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("a5n9pJUnAhX4fn7lx3uo");
    expect(fetchMock.mock.calls[1][0]).toContain("freeVoice456");
  });

  it("short-circuits a known restricted voice on subsequent requests", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_ID", "restrictedVoice789");

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

    expect(first.status).toBe(200);
    expect(first.headers.get("X-NAIA-Voice-Id")).toBe("freeVoice456");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("restrictedVoice789");

    const second = await GET(
      new Request("http://localhost/api/naia/voice?text=Encore%20Ali"),
    );

    expect(second.status).toBe(200);
    expect(second.headers.get("X-NAIA-Voice-Id")).toBe("freeVoice456");
    // The restricted voice is memoized: one direct call to the fallback voice.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain("freeVoice456");
    expect(second.headers.get("X-NAIA-Voice-Fallback")).toBeNull();
  });
});
