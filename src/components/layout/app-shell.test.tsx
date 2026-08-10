import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchCrmNavigationSummaryAction: vi.fn(),
  pathname: "/meetings",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/features/crm/pipeline-actions", () => ({
  fetchCrmNavigationSummaryAction: mocks.fetchCrmNavigationSummaryAction,
}));

vi.mock("./notification-bell", () => ({
  NotificationBell: () => <span>Notifications</span>,
}));

vi.mock("@/features/naia/naia-floating-assistant", () => ({
  NaiaFloatingAssistant: () => <span>Assistant flottant</span>,
}));

vi.mock("@/features/naia/naia-page-context", () => ({
  NaiaPageContextProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { AppShell } from "./app-shell";

const session = {
  authMode: "supabase" as const,
  isSupabaseConfigured: true,
  organization: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Qarizmi",
    slug: "qarizmi",
  },
  user: {
    email: "ali@qarizmi.com",
    id: "11111111-1111-4111-8111-111111111111",
    name: "Ali",
    role: "owner" as const,
  },
};

describe("AppShell meeting focus mode", () => {
  beforeEach(() => {
    mocks.pathname = "/meetings";
    mocks.fetchCrmNavigationSummaryAction.mockResolvedValue({
      clientsCount: 0,
      drivesCount: 0,
      followUpsCount: 0,
      pipelineCount: 0,
      todoCount: 0,
    });
  });

  it("hides navigation, topbar and the floating assistant on /meetings", () => {
    render(
      <AppShell modules={[]} session={session}>
        <div>Focus meeting</div>
      </AppShell>,
    );

    expect(screen.getByText("Focus meeting")).toBeInTheDocument();
    expect(
      screen.queryByText("QARIZMI · ESPACE INTERNE"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Assistant flottant")).not.toBeInTheDocument();
    expect(mocks.fetchCrmNavigationSummaryAction).not.toHaveBeenCalled();
  });

  it("keeps meeting history inside the same distraction-free shell", () => {
    mocks.pathname = "/meetings/history";
    render(
      <AppShell modules={[]} session={session}>
        <div>Historique meeting</div>
      </AppShell>,
    );

    expect(screen.getByText("Historique meeting")).toBeInTheDocument();
    expect(
      screen.queryByText("QARIZMI · ESPACE INTERNE"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Assistant flottant")).not.toBeInTheDocument();
    expect(mocks.fetchCrmNavigationSummaryAction).not.toHaveBeenCalled();
  });

  it("keeps the regular shell outside focus mode", async () => {
    mocks.pathname = "/crm";
    render(
      <AppShell modules={[]} session={session}>
        <div>CRM</div>
      </AppShell>,
    );

    expect(screen.getByText("QARIZMI · ESPACE INTERNE")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Assistant flottant")).toBeInTheDocument();
  });
});
