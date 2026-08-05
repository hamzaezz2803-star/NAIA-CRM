import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
  }),
}));

import { GoogleConnectButton } from "./google-connect-button";

describe("GoogleConnectButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
});
