import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_MANUAL_REVOCATION_CONFIRMATION,
  GOOGLE_REVOCATION_CONFIRMATION,
} from "@/platform/integrations/google-revocation-contract";

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  const refresh = vi.fn();
  return { push, refresh, router: { push, refresh } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

import { GoogleConnectButton } from "./google-connect-button";

describe("GoogleConnectButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens Google authorization in a popup", () => {
    const popup = { close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);

    render(<GoogleConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Login with Gmail" }));

    expect(open).toHaveBeenCalledWith(
      "/api/integrations/google/auth",
      "GoogleAuth",
      expect.stringContaining("width=520"),
    );
    expect(screen.getByText("Connexion Google en cours...")).toBeVisible();
  });

  it("uses Next navigation when the browser blocks the popup", () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    render(<GoogleConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Login with Gmail" }));

    expect(mocks.push).toHaveBeenCalledWith("/api/integrations/google/auth");
  });

  it("recovers when the user closes the OAuth popup", async () => {
    const popup = { close: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    render(<GoogleConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Login with Gmail" }));
    popup.closed = true;

    expect(
      await screen.findByText("Connexion Google annulée.", undefined, {
        timeout: 1_200,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Login with Gmail" }),
    ).toBeEnabled();
  });

  it("accepts only same-origin success messages", () => {
    render(<GoogleConnectButton />);

    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "GOOGLE_AUTH_SUCCESS" },
        origin: "https://attacker.example",
      }),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();

    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "GOOGLE_AUTH_SUCCESS" },
        origin: window.location.origin,
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("revokes remotely before clearing the connected account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GoogleConnectButton
        connectedAccount="ali@qarizmi.com"
        initialConnected
      />,
    );

    expect(screen.getByText(/ali@qarizmi.com/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Déconnecter Google" }));

    await waitFor(() => {
      expect(
        screen.getByText("Accès Google révoqué et déconnecté."),
      ).toBeVisible();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/integrations/google/revoke", {
      body: JSON.stringify({
        confirmation: GOOGLE_REVOCATION_CONFIRMATION,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("surfaces a server-side disconnect error without hiding the connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Database unavailable" }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        }),
      ),
    );

    render(
      <GoogleConnectButton
        connectedAccount="ali@qarizmi.com"
        initialConnected
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Déconnecter Google" }));

    expect(await screen.findByText("Database unavailable")).toBeVisible();
    expect(screen.getByText(/ali@qarizmi.com/)).toBeVisible();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("quarantines an unproven disconnect and exposes manual confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Google n’a pas confirmé la révocation.",
            manualReviewRequired: true,
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 502,
          },
        ),
      ),
    );

    render(
      <GoogleConnectButton
        connectedAccount="ali@qarizmi.com"
        initialConnected
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Déconnecter Google" }));

    expect(
      await screen.findByText("Google n’a pas confirmé la révocation."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Ouvrir les connexions Google" }),
    ).toHaveAttribute("href", "https://myaccount.google.com/connections");
    expect(
      screen.getByRole("button", { name: "J’ai révoqué l’accès dans Google" }),
    ).toBeVisible();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("requires an inline confirmation before revoking a legacy Google grant", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ alreadyRevoked: false, ok: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GoogleConnectButton label="Reconnecter Google" requiresRevocation />,
    );

    expect(
      screen.getByText("Ancienne autorisation Google bloquée"),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Révoquer l’ancien accès" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Aucun fichier, e-mail ou événement ne sera supprimé/i),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer la révocation" }),
    );

    expect(
      await screen.findByText(/Ancienne autorisation révoquée/i),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith("/api/integrations/google/revoke", {
      body: JSON.stringify({
        confirmation: GOOGLE_REVOCATION_CONFIRMATION,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(
      screen.getByRole("button", { name: "Reconnecter Google" }),
    ).toBeEnabled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("guides and double-confirms manual revocation after Google cannot prove it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "Révocation non confirmée.",
            manualReviewRequired: true,
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 502,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ manualConfirmed: true, ok: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GoogleConnectButton label="Reconnecter Google" requiresRevocation />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Révoquer l’ancien accès" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer la révocation" }),
    );

    expect(await screen.findByText("Révocation non confirmée.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirmer la révocation" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("link", { name: "Ouvrir les connexions Google" }),
    ).toHaveAttribute("href", "https://myaccount.google.com/connections");

    fireEvent.click(
      screen.getByRole("button", {
        name: "J’ai révoqué l’accès dans Google",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Je confirme avoir retiré moi-même l’accès NAIA/i),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirmer que j’ai révoqué dans Google",
      }),
    );

    expect(
      await screen.findByText(/Révocation manuelle confirmée/i),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/integrations/google/revoke",
      {
        body: JSON.stringify({
          confirmation: GOOGLE_MANUAL_REVOCATION_CONFIRMATION,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(
      screen.getByRole("button", { name: "Reconnecter Google" }),
    ).toBeEnabled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
