import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSupabaseClaims: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
  signInWithGoogleAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span aria-label={alt} role="img" />,
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({
    actions,
    description,
    title,
  }: {
    actions?: ReactNode;
    description: string;
    title: string;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </header>
  ),
}));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: () => <span>configured</span>,
}));
vi.mock("@/platform/auth/actions", () => ({
  signInWithGoogleAction: mocks.signInWithGoogleAction,
}));
vi.mock("@/platform/auth/config", () => ({
  isSupabaseConfigured: () => true,
}));
vi.mock("@/platform/auth/supabase-server", () => ({
  getCurrentSupabaseClaims: mocks.getCurrentSupabaseClaims,
}));

import LoginPage from "./page";

describe("Google-only login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH_ALLOWED_EMAILS", "");
    mocks.getCurrentSupabaseClaims.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders one Google form and no email or password controls", async () => {
    const { container } = render(
      await LoginPage({ searchParams: Promise.resolve({}) }),
    );

    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeEnabled();
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Email sign-in link")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("redirects an already authorized Google OAuth session", async () => {
    mocks.getCurrentSupabaseClaims.mockResolvedValue(
      googleClaims({ method: "oauth" }),
    );

    await expect(
      LoginPage({
        searchParams: Promise.resolve({ redirectedFrom: "/meetings" }),
      }),
    ).rejects.toThrow("REDIRECT:/meetings");
  });

  it("keeps a legacy magic-link session on the Google login page", async () => {
    mocks.getCurrentSupabaseClaims.mockResolvedValue(
      googleClaims({ method: "magiclink" }),
    );

    render(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeEnabled();
  });
});

function googleClaims({ method }: { method: string }) {
  return {
    amr: [{ method, timestamp: 1_722_000_000 }],
    app_metadata: { provider: "email", providers: ["email", "google"] },
    email: "ali@qarizmi.com",
    sub: "user-ali",
  };
}
