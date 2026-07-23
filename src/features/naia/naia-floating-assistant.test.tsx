import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NaiaFloatingAssistant } from "./naia-floating-assistant";

describe("NaiaFloatingAssistant", () => {
  beforeEach(() => {
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
      "fetch",
      vi.fn(async () =>
        Response.json({
          configuredVoiceId: "voice-123",
          recommendedVoiceId: "voice-123",
          voices: [
            {
              category: "custom",
              name: "NAIA Paris",
              voiceId: "voice-123",
            },
          ],
        }),
      ),
    );
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders readable French copy instead of escaped Unicode sequences", async () => {
    render(<NaiaFloatingAssistant />);

    const trigger = await screen.findByRole("button", {
      name: "Ouvrir NAIA",
    });
    fireEvent.pointerDown(trigger, {
      clientX: 0,
      clientY: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(trigger, { pointerId: 1 });

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Exécute une commande vocale ou texte…"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "NAIA prépare — vous validez. Aucune action sans accord.",
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("\\u");
  });
});
