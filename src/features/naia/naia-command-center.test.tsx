import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pause: vi.fn(),
  playElevenLabsVoice: vi.fn(),
  primeVoicePlayback: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("./voice-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("./voice-client")>();

  return {
    ...original,
    playElevenLabsVoice: mocks.playElevenLabsVoice,
    primeVoicePlayback: mocks.primeVoicePlayback,
  };
});

import { NaiaCommandCenter } from "./naia-command-center";

describe("NaiaCommandCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const storedValues = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: () => storedValues.clear(),
      getItem: (key: string) => storedValues.get(key) ?? null,
      key: (index: number) => [...storedValues.keys()][index] ?? null,
      get length() {
        return storedValues.size;
      },
      removeItem: (key: string) => storedValues.delete(key),
      setItem: (key: string, value: string) => storedValues.set(key, value),
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        removeEventListener: vi.fn(),
      }),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === "/api/naia/voice/voices") {
          return Response.json({
            configuredVoiceId: "voice-123",
            mode: "elevenlabs",
            recommendedVoiceId: "voice-123",
            voices: [
              {
                category: "custom",
                description: "",
                labels: {
                  accent: "parisian",
                  age: "adult",
                  gender: "female",
                  language: "fr",
                },
                name: "NAIA Paris",
                previewUrl: "",
                voiceId: "voice-123",
              },
            ],
          });
        }

        if (url === "/api/naia/transcribe") {
          return Response.json({ available: false });
        }

        if (url === "/api/naia/user") {
          return Response.json({ name: "Ali" });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    mocks.playElevenLabsVoice.mockImplementation(
      ({ onBlocked }: { onBlocked: (message: string) => void }) => {
        onBlocked(
          "ElevenLabs indisponible. Lecture via la voix du navigateur.",
        );
        return { pause: mocks.pause };
      },
    );
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps the cockpit clean when voice playback falls back to the browser", async () => {
    const { container } = render(<NaiaCommandCenter />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/naia/voice/voices", {
        cache: "no-store",
      });
    });
    expect(
      screen.queryByRole("option", { name: "NAIA Paris" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Entrer dans le cockpit",
      }),
    );

    await waitFor(() => {
      expect(mocks.playElevenLabsVoice).toHaveBeenCalledOnce();
    });
    expect(container.querySelector("audio")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "ElevenLabs indisponible. Lecture via la voix du navigateur.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the real agent module from the galaxy", () => {
    render(<NaiaCommandCenter />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ouvrir Salma, CRM",
      }),
    );

    expect(mocks.push).toHaveBeenCalledWith("/dashboard/leads");
  });
});
