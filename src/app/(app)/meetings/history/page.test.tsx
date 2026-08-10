import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMeetingIntelligenceAction: vi.fn(),
  getAppSession: vi.fn(),
}));

vi.mock("@/features/meeting-notes/actions", () => ({
  fetchMeetingIntelligenceAction: mocks.fetchMeetingIntelligenceAction,
}));

vi.mock("@/platform/auth/session", () => ({
  getAppSession: mocks.getAppSession,
}));

vi.mock("@/features/meeting-notes/meeting-history", () => ({
  MeetingHistory: ({
    meetings,
  }: {
    meetings: Array<{ id: string; title: string }>;
  }) => (
    <div data-testid="meeting-history">
      {meetings.map((meeting) => (
        <span key={meeting.id}>{meeting.title}</span>
      ))}
    </div>
  ),
}));

import MeetingHistoryPage from "./page";

describe("Meeting history page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAppSession.mockResolvedValue({
      user: { email: "ali@qarizmi.com", role: "owner" },
    });
    mocks.fetchMeetingIntelligenceAction.mockResolvedValue({
      configured: true,
      meetings: [
        {
          id: "meeting-ready",
          output: { id: "output-ready" },
          title: "Compte rendu prêt",
        },
        {
          id: "meeting-processing",
          job: { id: "job-processing", status: "analyzing" },
          title: "Meeting en traitement",
        },
        {
          id: "meeting-scheduled",
          title: "Meeting sans traitement",
        },
      ],
    });
  });

  it("serializes only outputs and active processing for a cofounder", async () => {
    render(await MeetingHistoryPage());

    expect(screen.getByTestId("meeting-history")).toHaveTextContent(
      "Compte rendu prêt",
    );
    expect(screen.getByTestId("meeting-history")).toHaveTextContent(
      "Meeting en traitement",
    );
    expect(screen.getByTestId("meeting-history")).not.toHaveTextContent(
      "Meeting sans traitement",
    );
  });

  it("does not fetch private history for another account", async () => {
    mocks.getAppSession.mockResolvedValue({
      user: { email: "stagiaire@qarizmi.com", role: "member" },
    });

    render(await MeetingHistoryPage());

    expect(
      screen.getByText("Les comptes rendus sont réservés à Ali et Nabil."),
    ).toBeInTheDocument();
    expect(mocks.fetchMeetingIntelligenceAction).not.toHaveBeenCalled();
  });
});
