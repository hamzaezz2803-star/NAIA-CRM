import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("NAIA voice catalog route", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "officialVoice123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("exposes only the configured official voice as active and recommended", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        Response.json({
          voices: [
            {
              category: "premade",
              name: "Another Voice",
              voice_id: "anotherVoice999",
            },
            {
              category: "professional",
              labels: { accent: "french", language: "fr" },
              name: "NAIA Official",
              preview_url: "https://example.com/preview.mp3",
              voice_id: "officialVoice123",
            },
            {
              category: "premade",
              name: "Rescue Voice",
              voice_id: "rescueVoice456",
            },
          ],
        }),
      ),
    );

    const response = await GET();
    const body = (await response.json()) as {
      activeVoice?: { name?: string; voiceId?: string };
      configuredVoiceId?: string;
      mode?: string;
      recommendedVoiceId?: string;
      voices?: { voiceId?: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.mode).toBe("elevenlabs");
    expect(body.configuredVoiceId).toBe("officialVoice123");
    expect(body.recommendedVoiceId).toBe("officialVoice123");
    expect(body.activeVoice).toMatchObject({
      name: "NAIA Official",
      voiceId: "officialVoice123",
    });
    expect(body.voices).toEqual([
      expect.objectContaining({ voiceId: "officialVoice123" }),
    ]);
  });

  it("returns an empty catalog instead of a hard-coded voice when the primary is missing", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const body = (await response.json()) as {
      activeVoice?: unknown;
      configuredVoiceId?: string;
      mode?: string;
      recommendedVoiceId?: string;
      voices?: unknown[];
    };

    expect(response.status).toBe(200);
    expect(body.mode).toBe("browser-fallback-missing-primary");
    expect(body.configuredVoiceId).toBe("");
    expect(body.recommendedVoiceId).toBe("");
    expect(body.activeVoice).toBeUndefined();
    expect(body.voices).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the official configured voice when the provider catalog is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ detail: "unavailable" }, { status: 503 }),
        ),
    );

    const response = await GET();
    const body = (await response.json()) as {
      activeVoice?: { name?: string; voiceId?: string };
      configuredVoiceId?: string;
      mode?: string;
      recommendedVoiceId?: string;
      voices?: { voiceId?: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.mode).toBe("configured-provider-error");
    expect(body.configuredVoiceId).toBe("officialVoice123");
    expect(body.recommendedVoiceId).toBe("officialVoice123");
    expect(body.activeVoice).toEqual(
      expect.objectContaining({
        name: "NAIA",
        voiceId: "officialVoice123",
      }),
    );
    expect(body.voices).toEqual([
      expect.objectContaining({ voiceId: "officialVoice123" }),
    ]);
  });

  it("exposes only the official voice without a paid fallback contract", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");

    const response = await GET();
    const body = (await response.json()) as {
      recommendedVoiceId?: string;
      voices?: { voiceId?: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.recommendedVoiceId).toBe("officialVoice123");
    expect(body.voices).toEqual([
      expect.objectContaining({ voiceId: "officialVoice123" }),
    ]);
    expect(JSON.stringify(body)).not.toContain("fallbackConfigured");
  });
});
