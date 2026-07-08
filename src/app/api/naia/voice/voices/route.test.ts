import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("NAIA voice catalog route", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not recommend a library voice only because it matches the old preferred name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        Response.json({
          voices: [
            {
              category: "professional",
              name: "Martin Dupont Intime",
              voice_id: "restrictedLibraryVoice",
            },
            {
              category: "premade",
              name: "Safe Premade",
              voice_id: "safePremadeVoice",
            },
          ],
        }),
      ),
    );

    const response = await GET();
    const body = (await response.json()) as { recommendedVoiceId?: string };

    expect(response.status).toBe(200);
    expect(body.recommendedVoiceId).toBe("safePremadeVoice");
  });

  it("defaults the configured voice to Martin Dupont and recommends it when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        Response.json({
          voices: [
            {
              category: "premade",
              name: "Safe Premade",
              voice_id: "safePremadeVoice",
            },
            {
              category: "professional",
              name: "Martin Dupont",
              voice_id: "a5n9pJUnAhX4fn7lx3uo",
            },
          ],
        }),
      ),
    );

    const response = await GET();
    const body = (await response.json()) as {
      configuredVoiceId?: string;
      recommendedVoiceId?: string;
    };

    expect(response.status).toBe(200);
    expect(body.configuredVoiceId).toBe("a5n9pJUnAhX4fn7lx3uo");
    expect(body.recommendedVoiceId).toBe("a5n9pJUnAhX4fn7lx3uo");
  });
});
