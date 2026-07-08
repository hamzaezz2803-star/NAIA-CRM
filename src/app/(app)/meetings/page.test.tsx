import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchLeadsAction: vi.fn(),
  getAppSession: vi.fn(),
  getIntegrationReadiness: vi.fn(),
  listGoogleCalendarEvents: vi.fn(),
}));

vi.mock("@/features/crm/actions", () => ({
  fetchLeadsAction: mocks.fetchLeadsAction,
  generateFollowUpDraftAction: vi.fn(),
  syncLeadToGoogleCalendarAction: vi.fn(),
  updateLeadStatusAction: vi.fn(),
}));

vi.mock("@/platform/auth/session", () => ({
  getAppSession: mocks.getAppSession,
}));

vi.mock("@/platform/integrations/readiness", () => ({
  getIntegrationReadiness: mocks.getIntegrationReadiness,
}));

vi.mock("@/platform/integrations/google-workspace", () => ({
  listGoogleCalendarEvents: mocks.listGoogleCalendarEvents,
}));

vi.mock("@/components/integrations/google-connect-button", () => ({
  GoogleConnectButton: () => <button type="button">Login with Gmail</button>,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import MeetingsPage from "./page";

const crmLeadBase = {
  createdAt: "2026-07-01T10:00:00.000Z",
  organizationId: "org-1",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

describe("Meetings page", () => {
  beforeEach(() => {
    mocks.fetchLeadsAction.mockResolvedValue([]);
    mocks.getAppSession.mockResolvedValue({
      authMode: "supabase",
      isSupabaseConfigured: true,
      organization: { name: "Qarizmi", slug: "qarizmi" },
      user: { email: "ali@qarizmi.com", name: "Ali El Abbassy", role: "owner" },
    });
    mocks.getIntegrationReadiness.mockResolvedValue([
      {
        externalAccountLabel: "ali@qarizmi.com",
        provider: "google",
        status: "connected",
      },
    ]);
    mocks.listGoogleCalendarEvents.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders normally when the user has no Google connection", async () => {
    mocks.getIntegrationReadiness.mockResolvedValue([
      { provider: "google", status: "disconnected" },
    ]);
    mocks.listGoogleCalendarEvents.mockRejectedValue(
      new Error("Google Workspace is not connected for this user."),
    );

    render(await MeetingsPage());

    expect(screen.getByText("Meetings")).toBeInTheDocument();
    expect(screen.getByText("Planning des réunions")).toBeInTheDocument();
    expect(screen.queryByText("Mon agenda Google")).not.toBeInTheDocument();
  });

  it("lists Google agenda events and hides those already synced from a CRM lead", async () => {
    mocks.fetchLeadsAction.mockResolvedValue([
      {
        ...crmLeadBase,
        id: "lead-hps",
        leadDate: "2026-07-10T09:00:00.000Z",
        notes:
          "Entreprise: HPS\n[Google Calendar Event ID: evt-synced]\n[Google Calendar Event Link: https://calendar.google.com/event?eid=synced]",
        status: "meeting-booked",
        topic: "Meeting HPS",
      },
    ]);
    mocks.listGoogleCalendarEvents.mockResolvedValue([
      {
        htmlLink: "https://calendar.google.com/event?eid=synced",
        id: "evt-synced",
        start: "2026-07-10T09:00:00.000Z",
        title: "Meeting HPS - Abdeslam",
      },
      {
        htmlLink: "https://calendar.google.com/event?eid=personal",
        id: "evt-personal",
        start: "2026-07-11T14:30:00.000Z",
        title: "Point interne Qarizmi",
      },
    ]);

    render(await MeetingsPage());

    expect(mocks.listGoogleCalendarEvents).toHaveBeenCalledWith({
      daysAhead: 14,
      maxResults: 25,
    });
    expect(screen.getByText("Mon agenda Google")).toBeInTheDocument();
    expect(screen.getByText("Google Agenda")).toBeInTheDocument();
    expect(screen.getByText("Point interne Qarizmi")).toBeInTheDocument();
    expect(
      screen.queryByText("Meeting HPS - Abdeslam"),
    ).not.toBeInTheDocument();

    const agendaLink = screen.getByRole("link", {
      name: /Ouvrir dans Agenda/,
    });
    expect(agendaLink).toHaveAttribute(
      "href",
      "https://calendar.google.com/event?eid=personal",
    );
    expect(agendaLink).toHaveAttribute("target", "_blank");
  });
});
