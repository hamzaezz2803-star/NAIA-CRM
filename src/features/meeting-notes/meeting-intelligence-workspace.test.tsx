import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MeetingIntelligenceState } from "./contracts";

const mocks = vi.hoisted(() => ({
  approveMeetingOutputAction: vi.fn(),
  askMeetingKnowledgeAction: vi.fn(),
  fetchMeetingIntelligenceAction: vi.fn(),
  fetchMeetingTranscriptAction: vi.fn(),
  linkGeminiArtifactToMeetingAction: vi.fn(),
  queueMeetingProcessingAction: vi.fn(),
  registerMeetingSupportAction: vi.fn(),
  retryMeetingDriveArchiveAction: vi.fn(),
  retryMeetingProcessingAction: vi.fn(),
  saveMeetingCaptureDraftAction: vi.fn(),
  syncGeminiMeetingNotesAction: vi.fn(),
  remove: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("./actions", () => ({
  approveMeetingOutputAction: mocks.approveMeetingOutputAction,
  askMeetingKnowledgeAction: mocks.askMeetingKnowledgeAction,
  fetchMeetingIntelligenceAction: mocks.fetchMeetingIntelligenceAction,
  fetchMeetingTranscriptAction: mocks.fetchMeetingTranscriptAction,
  linkGeminiArtifactToMeetingAction: mocks.linkGeminiArtifactToMeetingAction,
  queueMeetingProcessingAction: mocks.queueMeetingProcessingAction,
  registerMeetingSupportAction: mocks.registerMeetingSupportAction,
  retryMeetingDriveArchiveAction: mocks.retryMeetingDriveArchiveAction,
  retryMeetingProcessingAction: mocks.retryMeetingProcessingAction,
  saveMeetingCaptureDraftAction: mocks.saveMeetingCaptureDraftAction,
  syncGeminiMeetingNotesAction: mocks.syncGeminiMeetingNotesAction,
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
      attendees: [],
      companyName: "HPS",
      contactName: "Abdeslam Alaoui",
      id: meetingId,
      leadId: "55555555-5555-4555-8555-555555555555",
      liveNotesMarkdown: "",
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
    try {
      window.localStorage.clear();
    } catch {
      // Node can run jsdom without a persisted localStorage file.
    }
    mocks.upload.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({
      remove: mocks.remove,
      upload: mocks.upload,
    });
    mocks.queueMeetingProcessingAction.mockResolvedValue({ success: true });
    mocks.registerMeetingSupportAction.mockResolvedValue({ success: true });
    mocks.saveMeetingCaptureDraftAction.mockResolvedValue({ success: true });
    mocks.syncGeminiMeetingNotesAction.mockResolvedValue({
      imported: 0,
      matched: 0,
      nextPageToken: undefined,
      scanned: 0,
      success: true,
      total: 0,
    });
    mocks.linkGeminiArtifactToMeetingAction.mockResolvedValue({
      success: true,
    });
    mocks.askMeetingKnowledgeAction.mockResolvedValue({
      answer: "Passages pertinents.",
      sources: [],
      success: true,
    });
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads an imported recording in 5 MB chunks before queuing it", async () => {
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const audio = new File(
      [new Uint8Array(5 * 1024 * 1024), new Uint8Array([1])],
      "meeting.m4a",
      { type: "audio/mp4" },
    );
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="audio"]',
    );
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

  it("preserves uploaded chunks when a later chunk fails", async () => {
    mocks.upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "network down" } });
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const audio = new File(
      [new Uint8Array(5 * 1024 * 1024), new Uint8Array([1])],
      "meeting.m4a",
      { type: "audio/mp4" },
    );
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="audio"]',
    );
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [audio] },
    });

    await waitFor(() => {
      expect(screen.getByText(/Envoi audio interrompu/)).toBeInTheDocument();
    });
    expect(mocks.queueMeetingProcessingAction).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not upload a chunk when hashing fails", async () => {
    vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(
      new Error("WebCrypto unavailable"),
    );
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const audio = new File([new Uint8Array([1])], "meeting.m4a", {
      type: "audio/mp4",
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="audio"]',
    );
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [audio] },
    });

    await waitFor(() => {
      expect(screen.getByText(/WebCrypto unavailable/)).toBeInTheDocument();
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.queueMeetingProcessingAction).not.toHaveBeenCalled();
  });

  it("keeps uploaded chunks when the queue request may already have committed", async () => {
    mocks.queueMeetingProcessingAction.mockRejectedValueOnce(
      new Error("response lost after commit"),
    );
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const audio = new File([new Uint8Array([1])], "meeting.m4a", {
      type: "audio/mp4",
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="audio"]',
    );
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

  it("preserves uploaded chunks after an explicit pre-commit queue rejection", async () => {
    mocks.queueMeetingProcessingAction.mockResolvedValueOnce({
      discardUploadedAudio: true,
      error: "Un traitement est déjà en cours pour ce meeting.",
      success: false,
    });
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const audio = new File([new Uint8Array([1])], "meeting.m4a", {
      type: "audio/mp4",
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="audio"]',
    );
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [audio] },
    });

    await waitFor(() => {
      expect(screen.getByText(/déjà en cours/)).toBeInTheDocument();
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("requires explicit informed consent before recording", async () => {
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Démarrer l'enregistrement" }),
    );

    expect(
      await screen.findByText(
        /^Confirme que les participants ont été informés/i,
      ),
    ).toBeInTheDocument();
  });

  it("uses the discreet control to start, pause and resume capture", async () => {
    const pause = vi.fn();
    const resume = vi.fn();
    class FakeMediaRecorder {
      static isTypeSupported = () => true;
      mimeType = "audio/mp4";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state: "inactive" | "paused" | "recording" = "inactive";

      pause() {
        this.state = "paused";
        pause();
      }

      resume() {
        this.state = "recording";
        resume();
      }

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
      }
    }
    const stopTrack = vi.fn();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("navigator", {
      ...window.navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
    });

    render(<MeetingIntelligenceWorkspace initialState={baseState} />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /participants ont été informés/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Démarrer l'enregistrement" }),
    );
    const pauseButton = await screen.findByRole("button", {
      name: "Mettre l'enregistrement en pause",
    });
    fireEvent.click(pauseButton);
    expect(pause).toHaveBeenCalledTimes(1);
    const resumeButton = screen.getByRole("button", {
      name: "Reprendre l'enregistrement",
    });
    fireEvent.click(resumeButton);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("syncs Gemini read-only and searches private meeting knowledge", async () => {
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Synchroniser les notes Gemini depuis Gmail",
      }),
    );
    await waitFor(() => {
      expect(mocks.syncGeminiMeetingNotesAction).toHaveBeenCalledWith({
        pageToken: undefined,
      });
    });
    expect(
      screen.getByText(/0 message\(s\) Gmail analysé\(s\)/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Qu'avons-nous décidé/i), {
      target: { value: "Qu'avons-nous décidé pour le lancement ?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));
    await waitFor(() =>
      expect(mocks.askMeetingKnowledgeAction).toHaveBeenCalledWith({
        meetingId,
        question: "Qu'avons-nous décidé pour le lancement ?",
        scope: "meeting",
      }),
    );
    expect(screen.getByText("Passages pertinents.")).toBeInTheDocument();
  });

  it("continues the Gemini backfill with the returned cursor and reports scanned messages", async () => {
    mocks.syncGeminiMeetingNotesAction
      .mockResolvedValueOnce({
        imported: 2,
        matched: 1,
        nextPageToken: "gmail-page-2",
        scanned: 200,
        success: true,
        total: 2,
      })
      .mockResolvedValueOnce({
        imported: 0,
        matched: 0,
        nextPageToken: undefined,
        scanned: 37,
        success: true,
        total: 0,
      });
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Synchroniser les notes Gemini depuis Gmail",
      }),
    );

    await waitFor(() => {
      expect(mocks.syncGeminiMeetingNotesAction).toHaveBeenNthCalledWith(1, {
        pageToken: undefined,
      });
    });
    expect(
      await screen.findByText(/200 message\(s\) Gmail analysé\(s\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continuer le backfill Gemini" }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Continuer le backfill Gemini" }),
    );

    await waitFor(() => {
      expect(mocks.syncGeminiMeetingNotesAction).toHaveBeenNthCalledWith(2, {
        pageToken: "gmail-page-2",
      });
    });
    expect(
      await screen.findByText(/37 message\(s\) Gmail analysé\(s\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Synchroniser les notes Gemini depuis Gmail",
      }),
    ).toBeEnabled();
  });

  it("searches only the 50 most recent meetings when requested", async () => {
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    fireEvent.change(screen.getByLabelText("Périmètre de recherche"), {
      target: { value: "recent" },
    });
    expect(
      screen.getByRole("option", { name: "50 meetings récents" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Qu'avons-nous décidé/i), {
      target: { value: "Quelles décisions sont encore ouvertes ?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));

    await waitFor(() => {
      expect(mocks.askMeetingKnowledgeAction).toHaveBeenCalledWith({
        meetingId: undefined,
        question: "Quelles décisions sont encore ouvertes ?",
        scope: "recent",
      });
    });
  });

  it("authorizes Meet documents in a popup and trusts only the same origin callback", async () => {
    const popup = { close: vi.fn(), closed: false };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(popup as unknown as Window);
    mocks.fetchMeetingIntelligenceAction.mockResolvedValueOnce({
      ...baseState,
      geminiDocumentAccess: true,
    });
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    expect(
      screen.getByRole("button", {
        name: "Synchroniser les notes Gemini depuis Gmail",
      }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Autoriser les documents Meet" }),
    );
    expect(open).toHaveBeenCalledWith(
      "/api/integrations/google/auth?intent=meeting-notes",
      "GoogleMeetingNotesAuth",
      expect.stringContaining("width=520"),
    );
    expect(
      screen.getByRole("button", {
        name: "Synchroniser les notes Gemini depuis Gmail",
      }),
    ).toBeEnabled();

    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "GOOGLE_AUTH_SUCCESS" },
        origin: "https://attacker.example",
      }),
    );
    expect(mocks.fetchMeetingIntelligenceAction).not.toHaveBeenCalled();

    fireEvent(
      window,
      new MessageEvent("message", {
        data: { type: "GOOGLE_AUTH_SUCCESS" },
        origin: window.location.origin,
      }),
    );

    await waitFor(() => {
      expect(mocks.fetchMeetingIntelligenceAction).toHaveBeenCalledTimes(1);
    });
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Documents et transcripts Gemini actifs"),
    ).toBeInTheDocument();
  });

  it("blocks a legacy broad Drive connection and routes to explicit review", () => {
    render(
      <MeetingIntelligenceWorkspace
        initialState={{
          ...baseState,
          geminiDocumentAccess: false,
          googleWorkspaceReconnectRequired: true,
        }}
      />,
    );

    expect(screen.getByText("Connexion Google à revoir")).toBeInTheDocument();
    expect(
      screen.getByText(/ancienne autorisation Drive trop large a été bloquée/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Revoir la connexion Google" }),
    ).toHaveAttribute("href", "/integrations");
    expect(
      screen.queryByRole("button", {
        name: "Autoriser les documents Meet",
      }),
    ).not.toBeInTheDocument();
  });

  it("uses in-app navigation when the browser blocks the Google popup", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Autoriser les documents Meet" }),
    );

    expect(window.open).toHaveBeenNthCalledWith(
      2,
      "/api/integrations/google/auth?intent=meeting-notes",
      "_self",
    );
  });

  it("keeps unmatched Gemini notes private until a founder links them", async () => {
    const geminiState: MeetingIntelligenceState = {
      ...baseState,
      geminiArtifacts: [
        {
          documentTextAvailable: false,
          id: "44444444-4444-4444-8444-444444444444",
          notesMarkdown: "Résumé privé de la réunion.",
          occurredAt: "2026-07-18T10:00:00.000Z",
          provider: "google-gemini",
          title: "Projet HPS",
        },
      ],
    };
    render(<MeetingIntelligenceWorkspace initialState={geminiState} />);

    fireEvent.click(screen.getByRole("button", { name: "Projet HPS" }));
    await waitFor(() =>
      expect(mocks.linkGeminiArtifactToMeetingAction).toHaveBeenCalledWith({
        artifactId: "44444444-4444-4444-8444-444444444444",
        meetingId,
      }),
    );
  });

  it("prefills participants and exposes the matched Google Meet safely", async () => {
    render(
      <MeetingIntelligenceWorkspace
        calendarEvents={[
          {
            attachments: [
              {
                fileId: "drive-slide-1",
                fileUrl: "https://drive.google.com/file/d/drive-slide-1/view",
                mimeType: "application/vnd.google-apps.presentation",
                title: "Pitch HPS",
              },
            ],
            attendees: [
              { email: "ali@qarizmi.com", self: true },
              {
                displayName: "Sara Benali",
                email: "sara@hps.com",
                responseStatus: "accepted",
              },
            ],
            conferenceUrl: "https://meet.google.com/abc-defg-hij",
            htmlLink: "https://calendar.google.com/event?eid=private",
            id: "calendar-event-1",
            start: "2026-07-18T10:00:00.000Z",
            title: "Meeting HPS",
          },
        ]}
        initialState={baseState}
      />,
    );

    expect(screen.getByLabelText("Participants")).toHaveValue(
      "ali@qarizmi.com, Sara Benali <sara@hps.com>",
    );
    expect(
      screen.getByRole("link", { name: "Rejoindre Meet" }),
    ).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
    expect(
      screen.getByText(/aucun enregistrement automatique/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Qarizmi")).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pitch HPS/ })).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/drive-slide-1/view",
    );
  });

  it("autosaves live notes and participants to the founder-only draft", async () => {
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    fireEvent.change(screen.getByLabelText("Participants"), {
      target: { value: "Sara Benali, sara@hps.com" },
    });
    fireEvent.change(screen.getByLabelText(/Notes en direct/), {
      target: { value: "Le client confirme un pilote en septembre." },
    });

    await waitFor(
      () => {
        expect(mocks.saveMeetingCaptureDraftAction).toHaveBeenLastCalledWith({
          attendees: [{ name: "Sara Benali" }, { email: "sara@hps.com" }],
          consentConfirmed: false,
          liveNotesMarkdown: "Le client confirme un pilote en septembre.",
          meetingId,
          title: "Meeting HPS",
        });
      },
      { timeout: 2_500 },
    );
    expect(screen.getByText("Sauvegardé")).toBeInTheDocument();
  });

  it("registers an optional PDF support without deleting the uploaded file", async () => {
    render(<MeetingIntelligenceWorkspace initialState={baseState} />);

    const support = new File([new Uint8Array([1, 2, 3])], "pitch-hps.pdf", {
      type: "application/pdf",
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="application/pdf"]',
    );
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [support] },
    });

    await waitFor(() => {
      expect(mocks.registerMeetingSupportAction).toHaveBeenCalledWith({
        meetingId,
        support: expect.objectContaining({
          chunks: [
            expect.objectContaining({
              path: `${organizationId}/${meetingId}/${sessionId}/chunk-0000.pdf`,
              sizeBytes: 3,
            }),
          ],
          mimeType: "application/pdf",
          originalFileName: "pitch-hps.pdf",
          totalBytes: 3,
        }),
      });
    });
    expect(mocks.remove).not.toHaveBeenCalled();
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
