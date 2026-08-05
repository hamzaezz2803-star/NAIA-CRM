import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NaiaFloatingAssistant } from "./naia-floating-assistant";
import { NaiaPageContextProvider } from "./naia-page-context";

function renderAssistant(pathname = "/dashboard/leads") {
  return render(
    <NaiaPageContextProvider pathname={pathname}>
      <NaiaFloatingAssistant />
    </NaiaPageContextProvider>,
  );
}

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
    renderAssistant();

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

  it("renders readable French labels in a proposed CRM lead", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/api/naia/voice/voices")) {
        return Response.json({
          configuredVoiceId: "voice-123",
          recommendedVoiceId: "voice-123",
          voices: [
            {
              category: "custom",
              name: "NAIA Paris",
              voiceId: "voice-123",
            },
          ],
        });
      }

      return Response.json({
        actions: [
          {
            agentId: "crm",
            approvalRequired: true,
            approvalToken: "approval-token",
            description: "Vérifier les informations avant création.",
            id: "create-lead",
            kind: "crm.createLead",
            label: "Créer le lead",
            payload: {
              contactPhone: "+212600000000",
              leadDate: "2026-07-30T10:00:00+01:00",
              status: "meeting-booked",
              topic: "Projet Maison",
            },
          },
        ],
        agent: { id: "crm", name: "Salma" },
        confidence: 0.96,
        response: "J'ai préparé la fiche du lead.",
      });
    });

    renderAssistant();

    const trigger = await screen.findByRole("button", {
      name: "Ouvrir NAIA",
    });
    fireEvent.pointerDown(trigger, {
      clientX: 0,
      clientY: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(trigger, { pointerId: 1 });

    const command = await screen.findByPlaceholderText(
      "Exécute une commande vocale ou texte…",
    );
    fireEvent.change(command, {
      target: { value: "Crée un lead pour Projet Maison" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));

    expect(await screen.findByText("Téléphone")).toBeInTheDocument();
    expect(screen.getByText("Date planifiée")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Valider et créer le lead" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("\\u");

    const orchestrationRequest = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input) === "/api/naia/orchestrate");
    expect(
      JSON.parse(String(orchestrationRequest?.[1]?.body)).pageContext,
    ).toMatchObject({
      dataMode: "live",
      moduleId: "crm",
      pathname: "/dashboard/leads",
      view: "pipeline",
    });
  });

  it("opens from the global event and restores focus to the floating trigger", async () => {
    renderAssistant("/meetings");
    const trigger = await screen.findByRole("button", { name: "Ouvrir NAIA" });

    window.dispatchEvent(new Event("naia:open-assistant"));
    expect(
      await screen.findByRole("dialog", { name: "Assistant NAIA" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Meetings · Agenda")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
