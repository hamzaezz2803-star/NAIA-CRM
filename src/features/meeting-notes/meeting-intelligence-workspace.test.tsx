import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MeetingIntelligenceState } from "./contracts";

const mocks = vi.hoisted(() => ({
  approveMeetingOutputAction: vi.fn(),
  fetchMeetingIntelligenceAction: vi.fn(),
  fetchMeetingTranscriptAction: vi.fn(),
  queueMeetingProcessingAction: vi.fn(),
  retryMeetingDriveArchiveAction: vi.fn(),
  retryMeetingProcessingAction: vi.fn(),
  remove: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("./actions", () => ({
  approveMeetingOutputAction: mocks.approveMeetingOutputAction,
  fetchMeetingIntelligenceAction: mocks.fetchMeetingIntelligenceAction,
  fetchMeetingTranscriptAction: mocks.fetchMeetingTranscriptAction,
  queueMeetingProcessingAction: mocks.queueMeetingProcessingAction,
  retryMeetingDriveArchiveAction: mocks.retryMeetingDriveArchiveAction,
  retryMeetingProcessingAction: mocks.retryMeetingProcessingAction,
}));

vi.mock("@/platform/auth/supabase-client", () => ({
  createBrowserSupabaseClient: () => ({
    storage: { from: mocks.storageFrom },
  }),
}));

import { MeetingIntelligenceWorkspace } from "./meeting-intelligence-workspace";

const organizationId = "11111111-1111-4111-8111-111111111111";
const meetingId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

const baseState: MeetingIntelligenceState = {
  configured: true,
  meetings: [
    {
      companyName: "HPS",
      contactName: "Abdeslam Alaoui",
      id: meetingId,
      leadId: "55555555-5555-4555-8555-555555555555",
      organizationId,
      startsAt: "2026-07-18T10:00:00.000Z",
      status: "scheduled",
      title: "Meeting HPS",
    },
  ],
  organizationId,
};

describe("MeetingIntelligenceWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({
      remove: mocks.remove,
      upload: mocks.upload,
    });
    mocks.queueMeetingProcessingAction.mockResolvedValue({ success: true });
    mocks.fetchMeetingTranscriptAction.mockResolvedValue({
      success: true,
      transcriptSrt:
        "1\n00:00:01,000 --> 00:00:04,000\nLe client confirme le pilote.",
      transcriptText:
        "[00:00:01] Le client confirme le lancement du pilote HPS.",
    });
    mocks.retryMeetingDriveArchiveAction.mockResolvedValue({ success: true });
    mocks.retryMeetingProcessingAction.mockResolvedValue({ success: true });
    mocks.approveMeetingOutputAction.mockResolvedValue({
      success: true,
      warnings: [],
    });
    mocks.fetchMeetingIntelligenceAction.mockResolvedValue(baseState);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(sessionId);
  });

  it("uploads an imported recording in 5 MB chunks before queuing it", async () => {
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const audio = new File(
      [new Uint8Array(5 * 1024 * 1024), new Uint8Array([1])],
      "meeting.m4a",
      { type: "audio/mp4" },
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [audio] },
    });

    await waitFor(() => {
      expect(mocks.queueMeetingProcessingAction).toHaveBeenCalledTimes(1);
    });

    expect(mocks.storageFrom).toHaveBeenCalledWith("meeting-recordings");
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.upload).toHaveBeenNthCalledWith(
      1,
      `${organizationId}/${meetingId}/${sessionId}/chunk-0000.m4a`,
      expect.any(Blob),
      expect.objectContaining({ contentType: "audio/mp4", upsert: false }),
    );
    expect(mocks.upload).toHaveBeenNthCalledWith(
      2,
      `${organizationId}/${meetingId}/${sessionId}/chunk-0001.m4a`,
      expect.any(Blob),
      expect.objectContaining({ contentType: "audio/mp4", upsert: false }),
    );
    expect(mocks.queueMeetingProcessingAction).toHaveBeenCalledWith(
      meetingId,
      expect.objectContaining({
        chunks: [
          {
            path: `${organizationId}/${meetingId}/${sessionId}/chunk-0000.m4a`,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            sizeBytes: 5 * 1024 * 1024,
          },
          {
            path: `${organizationId}/${meetingId}/${sessionId}/chunk-0001.m4a`,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            sizeBytes: 1,
          },
        ],
        mimeType: "audio/mp4",
        originalFileName: "meeting.m4a",
        totalBytes: 5 * 1024 * 1024 + 1,
      }),
    );
  });

  it("removes uploaded chunks when a later chunk fails", async () => {
    mocks.upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "network down" } });
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const audio = new File(
      [new Uint8Array(5 * 1024 * 1024), new Uint8Array([1])],
      "meeting.m4a",
      { type: "audio/mp4" },
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [audio] },
    });

    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith([
        `${organizationId}/${meetingId}/${sessionId}/chunk-0000.m4a`,
      ]);
    });
    expect(mocks.queueMeetingProcessingAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Envoi audio interrompu/)).toBeInTheDocument();
  });

  it("keeps uploaded chunks when the queue request may already have committed", async () => {
    mocks.queueMeetingProcessingAction.mockRejectedValueOnce(
      new Error("response lost after commit"),
    );
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const audio = new File([new Uint8Array([1])], "meeting.m4a", {
      type: "audio/mp4",
    });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [audio] },
    });

    await waitFor(() => {
      expect(
        screen.getByText(/response lost after commit/),
      ).toBeInTheDocument();
    });
    expect(mocks.queueMeetingProcessingAction).toHaveBeenCalledTimes(1);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("removes uploaded chunks after an explicit pre-commit queue rejection", async () => {
    mocks.queueMeetingProcessingAction.mockResolvedValueOnce({
      discardUploadedAudio: true,
      error: "Un traitement est déjà en cours pour ce meeting.",
      success: false,
    });
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const audio = new File([new Uint8Array([1])], "meeting.m4a", {
      type: "audio/mp4",
    });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [audio] },
    });

    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith([
        `${organizationId}/${meetingId}/${sessionId}/chunk-0000.m4a`,
      ]);
    });
    expect(screen.getByText(/déjà en cours/)).toBeInTheDocument();
  });

  it("submits edited notes with only the recommendations selected by the founder", async () => {
    const reviewState: MeetingIntelligenceState = {
      ...baseState,
      meetings: [
        {
          ...baseState.meetings[0],
          output: {
            appliedRecommendationIds: [],
            approvalWarnings: ["Version relue non archivée: timeout"],
            driveFolderUrl: "https://drive.google.com/drive/folders/private",
            id: "44444444-4444-4444-8444-444444444444",
            notesMarkdown: "# Compte rendu\n\nNotes initiales de la réunion.",
            reviewRevision: 0,
            reviewStatus: "draft",
            structured: {
              actions: [
                {
                  confidence: "high",
                  detail: "Ajouter le besoin confirmé au CRM.",
                  evidence: [
                    {
                      quote: "le besoin est confirmé",
                      timestamp: "00:04:20",
                    },
                  ],
                  id: "crm-note-1",
                  kind: "crm-note",
                  title: "Documenter le besoin",
                },
                {
                  confidence: "medium",
                  detail: "Relancer le client lundi.",
                  evidence: [
                    {
                      quote: "on se reparle lundi",
                      timestamp: "00:28:10",
                    },
                  ],
                  id: "task-1",
                  kind: "task",
                  title: "Relancer le client",
                },
              ],
              constraints: [],
              decisions: [],
              executiveSummary: "HPS souhaite cadrer un premier pilote.",
              needs: [],
              openQuestions: [],
              participants: [],
              topics: [],
            },
            transcriptAvailable: true,
            version: 1,
            warnings: [],
          },
        },
      ],
    };
    mocks.fetchMeetingIntelligenceAction.mockResolvedValue(reviewState);

    render(<MeetingIntelligenceWorkspace initialState={reviewState} />);

    const highConfidence = screen.getByRole("checkbox", {
      name: /Documenter le besoin/,
    });
    const mediumConfidence = screen.getByRole("checkbox", {
      name: /Relancer le client/,
    });
    expect(highConfidence).not.toBeChecked();
    expect(mediumConfidence).not.toBeChecked();
    expect(
      screen.getByText("Visible par l'équipe CRM après validation"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Réessayer Drive" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText("Transcript source de vérité"),
      ).toHaveTextContent("Le client confirme le lancement du pilote HPS."),
    );
    expect(mocks.fetchMeetingTranscriptAction).toHaveBeenCalledWith({
      meetingId,
      outputId: "44444444-4444-4444-8444-444444444444",
      outputVersion: 1,
    });
    expect(screen.queryByLabelText("Notes de réunion")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    fireEvent.click(highConfidence);
    fireEvent.click(mediumConfidence);
    fireEvent.change(screen.getByLabelText("Notes de réunion"), {
      target: {
        value: "# Compte rendu relu\n\nDécision confirmée avec le client HPS.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Valider la revue" }));

    await waitFor(() => {
      expect(mocks.approveMeetingOutputAction).toHaveBeenCalledWith({
        meetingId,
        notesMarkdown:
          "# Compte rendu relu\n\nDécision confirmée avec le client HPS.",
        outputId: "44444444-4444-4444-8444-444444444444",
        reviewRevision: 0,
        outputVersion: 1,
        selectedRecommendationIds: ["crm-note-1", "task-1"],
      });
    });
  });
});
