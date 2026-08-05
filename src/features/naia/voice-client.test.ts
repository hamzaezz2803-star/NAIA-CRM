import { afterEach, describe, expect, it, vi } from "vitest";

import {
  playElevenLabsVoice,
  primeVoicePlayback,
  VOICE_PLAYBACK_RATE,
} from "./voice-client";

class FakeAudio {
  defaultPlaybackRate = 1;
  muted = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  playbackRate = 1;
  preload = "";
  src = "";

  pause = vi.fn(() => {
    this.paused = true;
  });

  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
}

// jsdom does not implement object URLs on the URL global.
const urlWithObjectUrls = URL as unknown as Record<string, unknown>;

function stubObjectUrls() {
  urlWithObjectUrls.createObjectURL = vi.fn(() => "blob:naia-voice-test");
  urlWithObjectUrls.revokeObjectURL = vi.fn();
}

describe("NAIA voice client", () => {
  afterEach(() => {
    window.__naiaCurrentAudio?.pause();
    window.__naiaCurrentAudio = undefined;
    window.__naiaPrimedAudio = undefined;
    window.__naiaVoicePrimed = undefined;
    delete urlWithObjectUrls.createObjectURL;
    delete urlWithObjectUrls.revokeObjectURL;
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

  it("primes a reusable audio element inside the user gesture", async () => {
    vi.stubGlobal("Audio", FakeAudio);

    primeVoicePlayback();

    const primed = window.__naiaPrimedAudio as unknown as FakeAudio;
    expect(primed).toBeInstanceOf(FakeAudio);
    expect(primed.muted).toBe(true);
    expect(primed.src).toContain("data:audio/wav;base64,");
    expect(primed.play).toHaveBeenCalledOnce();
    expect(window.__naiaVoicePrimed).toBe(true);

    await Promise.resolve();
    expect(primed.pause).toHaveBeenCalled();

    // A second gesture must not restart the silent clip.
    primeVoicePlayback();
    expect(primed.play).toHaveBeenCalledOnce();
  });

  it("reuses the primed element and applies the shared playback rate", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    stubObjectUrls();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "audio/mpeg" : null,
        },
        blob: () =>
          Promise.resolve(new Blob(["audio-bytes"], { type: "audio/mpeg" })),
      } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onBlocked = vi.fn();
    const onStarted = vi.fn();

    primeVoicePlayback();
    const primed = window.__naiaPrimedAudio as unknown as FakeAudio;

    playElevenLabsVoice({
      onBlocked,
      onEnded: vi.fn(),
      onStarted,
      text: "Bonjour Ali",
    });

    await vi.waitFor(() => expect(onStarted).toHaveBeenCalledOnce());

    expect(window.__naiaPrimedAudio as unknown as FakeAudio).toBe(primed);
    expect(primed.src).toBe("blob:naia-voice-test");
    expect(primed.muted).toBe(false);
    expect(primed.playbackRate).toBe(VOICE_PLAYBACK_RATE);
    expect(primed.defaultPlaybackRate).toBe(VOICE_PLAYBACK_RATE);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("announces an explicit ElevenLabs fallback voice", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    stubObjectUrls();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          blob: () =>
            Promise.resolve(new Blob(["audio-bytes"], { type: "audio/mpeg" })),
          headers: {
            get: (name: string) => {
              if (name.toLowerCase() === "content-type") return "audio/mpeg";
              if (name.toLowerCase() === "x-naia-voice-fallback") {
                return "primary-voice-unavailable";
              }
              return null;
            },
          },
          ok: true,
          status: 200,
        } as unknown as Response),
      ),
    );
    const onBlocked = vi.fn();

    playElevenLabsVoice({
      onBlocked,
      onEnded: vi.fn(),
      onStarted: vi.fn(),
      text: "Bonjour Ali",
    });

    await vi.waitFor(() =>
      expect(onBlocked).toHaveBeenCalledWith(
        expect.stringContaining("voix de secours"),
      ),
    );
  });

  it("ignores stale pause() calls once a newer playback took over", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    stubObjectUrls();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "audio/mpeg" : null,
        },
        blob: () =>
          Promise.resolve(new Blob(["audio-bytes"], { type: "audio/mpeg" })),
      } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    const firstEnded = vi.fn();
    const firstStarted = vi.fn();
    const firstHandle = playElevenLabsVoice({
      onBlocked: vi.fn(),
      onEnded: firstEnded,
      onStarted: firstStarted,
      text: "Premiere reponse",
    });
    await vi.waitFor(() => expect(firstStarted).toHaveBeenCalledOnce());

    const secondEnded = vi.fn();
    const secondStarted = vi.fn();
    const secondHandle = playElevenLabsVoice({
      onBlocked: vi.fn(),
      onEnded: secondEnded,
      onStarted: secondStarted,
      text: "Deuxieme reponse",
    });

    // Starting the next playback releases the first one (isSpeaking resets).
    expect(firstEnded).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(secondStarted).toHaveBeenCalledOnce());

    const shared = window.__naiaPrimedAudio as unknown as FakeAudio;
    shared.pause.mockClear();

    // A stale pause must neither stop the shared element nor unregister the
    // newer handle nor fire onEnded a second time.
    firstHandle.pause();
    expect(shared.pause).not.toHaveBeenCalled();
    expect(firstEnded).toHaveBeenCalledOnce();
    expect(secondEnded).not.toHaveBeenCalled();
    expect(window.__naiaCurrentAudio).toBe(secondHandle);

    secondHandle.pause();
    expect(secondEnded).toHaveBeenCalledOnce();
    expect(window.__naiaCurrentAudio).toBeUndefined();
  });

  it("keeps the browser fallback rate aligned with the shared playback rate", async () => {
    class FakeUtterance {
      lang = "";
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onstart: (() => void) | null = null;
      pitch = 1;
      rate = 1;
      text: string;
      volume = 1;

      constructor(text: string) {
        this.text = text;
      }
    }

    const speak = vi.fn();
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { mode: "browser", reason: "missing-elevenlabs-config" },
            { status: 503 },
          ),
        ),
      ),
    );
    const onBlocked = vi.fn();

    playElevenLabsVoice({
      onBlocked,
      onEnded: vi.fn(),
      onStarted: vi.fn(),
      text: "Bonjour Ali",
    });

    await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());

    const utterance = speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance.rate).toBe(VOICE_PLAYBACK_RATE);
    expect(onBlocked).toHaveBeenCalledOnce();
  });
});
