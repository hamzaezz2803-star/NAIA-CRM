import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pending: false,
}));

vi.mock("react-dom", () => ({
  useFormStatus: () => ({ pending: mocks.pending }),
}));

import { MagicLinkSubmitButton } from "./magic-link-submit-button";

describe("MagicLinkSubmitButton", () => {
  beforeEach(() => {
    mocks.pending = false;
  });

  it("is available when authentication is configured and no request is pending", () => {
    render(<MagicLinkSubmitButton disabled={false} />);

    expect(
      screen.getByRole("button", { name: "Send sign-in link" }),
    ).toBeEnabled();
  });

  it("shows progress and prevents repeated submissions while sending", () => {
    mocks.pending = true;

    render(<MagicLinkSubmitButton disabled={false} />);

    const button = screen.getByRole("button", {
      name: "Sending sign-in link...",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("stays disabled when Supabase authentication is not configured", () => {
    render(<MagicLinkSubmitButton disabled />);

    expect(
      screen.getByRole("button", { name: "Send sign-in link" }),
    ).toBeDisabled();
  });
});
