import { afterEach, describe, expect, it, vi } from "vitest";

import { playElevenLabsVoice } from "./voice-client";

describe("NAIA voice client", () => {
  afterEach(() => {
    window.__naiaCurrentAudio?.pause();
    window.__naiaCurrentAudio = undefined;
    vi.unstubAllGlobals();
  });

  it("does not mark playback as started before audio actually plays", async () => {
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>(() => {
          // Keep the voice request pending to prove loading is not playback.
        }),
    );
    const onStarted = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const handle = playElevenLabsVoice({
      onBlocked: vi.fn(),
      onEnded: vi.fn(),
      onStarted,
      text: "Bonjour Ali",
    });

    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onStarted).not.toHaveBeenCalled();

    handle.pause();
  });
});
