import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MeetingWorkspace } from "./contracts";

const mocks = vi.hoisted(() => ({
  approveMeetingOutputAction: vi.fn(),
  askMeetingKnowledgeAction: vi.fn(),
  fetchMeetingIntelligenceAction: vi.fn(),
  fetchMeetingTranscriptAction: vi.fn(),
  retryMeetingDriveArchiveAction: vi.fn(),
  retryMeetingProcessingAction: vi.fn(),
  syncGeminiMeetingNotesAction: vi.fn(),
}));

vi.mock("./actions", () => ({
  approveMeetingOutputAction: mocks.approveMeetingOutputAction,
  askMeetingKnowledgeAction: mocks.askMeetingKnowledgeAction,
  fetchMeetingIntelligenceAction: mocks.fetchMeetingIntelligenceAction,
  fetchMeetingTranscriptAction: mocks.fetchMeetingTranscriptAction,
  retryMeetingDriveArchiveAction: mocks.retryMeetingDriveArchiveAction,
  retryMeetingProcessingAction: mocks.retryMeetingProcessingAction,
  syncGeminiMeetingNotesAction: mocks.syncGeminiMeetingNotesAction,
}));

import { MeetingHistory } from "./meeting-history";

const readyMeeting: MeetingWorkspace = {
  attendees: [],
  id: "11111111-1111-4111-8111-111111111111",
  liveNotesMarkdown: "",
  organizationId: "22222222-2222-4222-8222-222222222222",
  output: {
    appliedRecommendationIds: [],
    approvalWarnings: [],
    id: "33333333-3333-4333-8333-333333333333",
    notesMarkdown: "# Compte rendu initial\n\nDécision initiale.",
    reviewRevision: 1,
    reviewedNotesMarkdown: "# Compte rendu final\n\nDécision validée.",
    reviewStatus: "approved",
    structured: {
      actions: [],
      constraints: [],
      decisions: [],
      executiveSummary: "Décision validée.",
      needs: [],
      openQuestions: [],
      participants: [],
      topics: [],
    },
    transcriptAvailable: true,
    version: 2,
    warnings: [],
  },
  startsAt: "2026-08-10T10:00:00.000Z",
  status: "completed",
  title: "Point client HPS",
};

describe("MeetingHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMeetingTranscriptAction.mockResolvedValue({
      success: true,
      transcriptSrt: "1\n00:00:00,000 --> 00:00:01,000\nBonjour",
      transcriptText: "[00:00:00] Bonjour HPS.",
    });
    mocks.approveMeetingOutputAction.mockResolvedValue({
      success: true,
      warnings: [],
    });
    mocks.askMeetingKnowledgeAction.mockResolvedValue({
      answer: "Réponse sourcée.",
      sources: [],
      success: true,
    });
    mocks.fetchMeetingIntelligenceAction.mockResolvedValue({
      configured: true,
      meetings: [readyMeeting],
    });
    mocks.retryMeetingDriveArchiveAction.mockResolvedValue({
      message: "Archivé.",
      success: true,
    });
    mocks.retryMeetingProcessingAction.mockResolvedValue({
      jobId: "job-retry",
      success: true,
    });
    mocks.syncGeminiMeetingNotesAction.mockResolvedValue({
      imported: 1,
      matched: 1,
      scanned: 1,
      success: true,
      total: 1,
    });
  });

  it("lists only meetings with a generated output, most recent first", () => {
    render(
      <MeetingHistory
        meetings={[
          {
            ...readyMeeting,
            id: "44444444-4444-4444-8444-444444444444",
            output: undefined,
            title: "Meeting encore en traitement",
          },
          {
            ...readyMeeting,
            id: "55555555-5555-4555-8555-555555555555",
            startsAt: "2026-08-09T10:00:00.000Z",
            title: "Meeting plus ancien",
          },
          readyMeeting,
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Point client HPS/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Meeting plus ancien/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Meeting encore en traitement"),
    ).not.toBeInTheDocument();
  });

  it("opens reviewed notes and loads the organization-scoped transcript on demand", async () => {
    render(<MeetingHistory meetings={[readyMeeting]} />);

    fireEvent.click(screen.getByRole("button", { name: /Point client HPS/i }));
    expect(
      screen.getByRole("heading", { name: "Point client HPS" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Compte rendu final",
    );
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent(
      "Décision initiale",
    );
    expect(mocks.fetchMeetingTranscriptAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));

    await waitFor(() =>
      expect(mocks.fetchMeetingTranscriptAction).toHaveBeenCalledWith({
        meetingId: readyMeeting.id,
        outputId: readyMeeting.output?.id,
        outputVersion: readyMeeting.output?.version,
      }),
    );
    expect(
      await screen.findByText("[00:00:00] Bonjour HPS."),
    ).toBeInTheDocument();
  });

  it("shows a recoverable transcript error without hiding the notes", async () => {
    mocks.fetchMeetingTranscriptAction.mockResolvedValueOnce({
      error: "Transcript momentanément indisponible.",
      success: false,
    });
    render(<MeetingHistory meetings={[readyMeeting]} />);
    fireEvent.click(screen.getByRole("button", { name: /Point client HPS/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));

    expect(
      await screen.findByText("Transcript momentanément indisponible."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Décision validée");
  });

  it("keeps an explicit empty state when nothing is ready", () => {
    render(<MeetingHistory meetings={[]} />);

    expect(
      screen.getByRole("heading", { name: "Aucun meeting à suivre" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Retour aux notes de meeting" }),
    ).toHaveAttribute("href", "/meetings");
  });

  it("keeps failed processing visible and lets a founder retry safely", async () => {
    const failedMeeting: MeetingWorkspace = {
      ...readyMeeting,
      id: "66666666-6666-4666-8666-666666666666",
      job: {
        error: "Le worker local était hors ligne.",
        id: "job-failed",
        message: "Échec du traitement",
        progress: 42,
        status: "failed",
        updatedAt: "2026-08-10T10:30:00.000Z",
      },
      output: undefined,
      title: "Meeting en échec",
    };
    render(<MeetingHistory meetings={[failedMeeting]} />);

    fireEvent.click(screen.getByRole("button", { name: /Meeting en échec/i }));
    expect(
      screen.getByRole("heading", { name: "Traitement interrompu" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Relancer l’analyse" }));

    await waitFor(() =>
      expect(mocks.retryMeetingProcessingAction).toHaveBeenCalledWith(
        failedMeeting.id,
      ),
    );
    expect(mocks.fetchMeetingIntelligenceAction).toHaveBeenCalled();
  });

  it("preserves human review and explicit recommendation approval", async () => {
    const reviewMeeting: MeetingWorkspace = {
      ...readyMeeting,
      output: {
        ...readyMeeting.output!,
        reviewStatus: "draft",
        structured: {
          ...readyMeeting.output!.structured,
          actions: [
            {
              confidence: "high",
              detail: "Créer la relance CRM après validation.",
              evidence: [
                { quote: "Je vous relance lundi", timestamp: "00:12:00" },
              ],
              id: "crm-follow-up",
              kind: "crm-next-action",
              title: "Relancer le client lundi",
            },
          ],
        },
      },
    };
    render(<MeetingHistory meetings={[reviewMeeting]} />);
    fireEvent.click(screen.getByRole("button", { name: /Point client HPS/i }));
    fireEvent.change(screen.getByLabelText("Notes de réunion"), {
      target: { value: "Compte rendu relu et confirmé par Ali." },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Relancer le client lundi/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Valider la revue" }));

    await waitFor(() =>
      expect(mocks.approveMeetingOutputAction).toHaveBeenCalledWith({
        meetingId: reviewMeeting.id,
        notesMarkdown: "Compte rendu relu et confirmé par Ali.",
        outputId: reviewMeeting.output?.id,
        outputVersion: reviewMeeting.output?.version,
        reviewRevision: reviewMeeting.output?.reviewRevision,
        selectedRecommendationIds: ["crm-follow-up"],
      }),
    );
  });

  it("keeps Gemini sync in the post-meeting space", async () => {
    render(<MeetingHistory meetings={[readyMeeting]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Synchroniser Gemini" }),
    );

    await waitFor(() =>
      expect(mocks.syncGeminiMeetingNotesAction).toHaveBeenCalledWith({
        pageToken: undefined,
      }),
    );
  });
});
