import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMeetingIntelligenceAction: vi.fn(),
  getAppSession: vi.fn(),
  listGoogleCalendarEvents: vi.fn(),
}));

vi.mock("@/features/meeting-notes/actions", () => ({
  fetchMeetingIntelligenceAction: mocks.fetchMeetingIntelligenceAction,
}));

vi.mock("@/platform/auth/session", () => ({
  getAppSession: mocks.getAppSession,
}));

vi.mock("@/platform/integrations/google-workspace", () => ({
  listGoogleCalendarEvents: mocks.listGoogleCalendarEvents,
}));

vi.mock("@/features/meeting-notes/meeting-intelligence-workspace", () => ({
  MeetingIntelligenceWorkspace: ({
    calendarEvents,
    calendarUnavailable,
    variant,
  }: {
    calendarEvents: Array<{ id: string; title: string }>;
    calendarUnavailable: boolean;
    variant: string;
  }) => (
    <div
      data-calendar-unavailable={String(calendarUnavailable)}
      data-testid="meeting-workspace"
      data-variant={variant}
    >
      {calendarEvents.map((event) => (
        <span key={event.id}>{event.title}</span>
      ))}
    </div>
  ),
}));

import MeetingsPage from "./page";

describe("Meetings page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T08:30:00.000Z"));
    mocks.getAppSession.mockResolvedValue({
      authMode: "supabase",
      isSupabaseConfigured: true,
      organization: { name: "Qarizmi", slug: "qarizmi" },
      user: { email: "ali@qarizmi.com", name: "Ali", role: "owner" },
    });
    mocks.fetchMeetingIntelligenceAction.mockResolvedValue({
      configured: true,
      meetings: [],
      organizationId: "org-1",
    });
    mocks.listGoogleCalendarEvents.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("keeps manual note taking available when Google Calendar is unavailable", async () => {
    mocks.listGoogleCalendarEvents.mockRejectedValue(
      new Error("Google Workspace is not connected for this user."),
    );

    render(await MeetingsPage());

    expect(screen.getByTestId("meeting-workspace")).toHaveAttribute(
      "data-variant",
      "focus",
    );
    expect(screen.getByTestId("meeting-workspace")).toHaveAttribute(
      "data-calendar-unavailable",
      "true",
    );
  });

  it("loads the complete Casablanca day and passes only that agenda to focus mode", async () => {
    mocks.listGoogleCalendarEvents.mockResolvedValue([
      {
        id: "evt-oracle",
        start: "2026-08-10T10:30:00+01:00",
        title: "Oracle: AI & Data management Q/A",
      },
    ]);

    render(await MeetingsPage());

    expect(mocks.listGoogleCalendarEvents).toHaveBeenCalledWith({
      maxResults: 50,
      timeMax: "2026-08-10T23:00:00.000Z",
      timeMin: "2026-08-09T23:00:00.000Z",
    });
    expect(
      screen.getByText("Oracle: AI & Data management Q/A"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("meeting-workspace")).toHaveAttribute(
      "data-calendar-unavailable",
      "false",
    );
  });

  it("does not load meeting data for a session without an email", async () => {
    mocks.getAppSession.mockResolvedValue({
      authMode: "supabase",
      isSupabaseConfigured: true,
      organization: { name: "Qarizmi", slug: "qarizmi" },
      user: {
        email: "",
        name: "Stagiaire",
        role: "member",
      },
    });

    render(await MeetingsPage());

    expect(
      screen.getByText("Connecte-toi pour accéder aux notes de meeting."),
    ).toBeInTheDocument();
    expect(mocks.listGoogleCalendarEvents).not.toHaveBeenCalled();
    expect(mocks.fetchMeetingIntelligenceAction).not.toHaveBeenCalled();
  });
});
