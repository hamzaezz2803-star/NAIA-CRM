import { describe, expect, it } from "vitest";

import type { GmailMeetingNoteMessage } from "@/platform/integrations/google-workspace";

import {
  matchGeminiNoteToMeeting,
  parseGeminiMeetingNoteMessage,
} from "./gemini-email";

const message: GmailMeetingNoteMessage = {
  bodyText: [
    'Notes de "Projet Atlas - Production"',
    "",
    "Ces notes ont été envoyées aux invités.",
    "",
    "Résumé",
    "Le périmètre de la phase pilote a été validé.",
    "",
    "Décisions",
    "Le lancement reste prévu lundi.",
    "",
    "https://docs.google.com/document/d/doc-file-123/edit?usp=meet_tnfm_email",
    "https://drive.google.com/file/d/video-file-456/view?usp=drive_web",
    "",
    'La section "Étapes suivantes" de cet e-mail est-elle utile ?',
    "Google LLC, Mountain View",
  ].join("\n"),
  date: "Thu, 6 Aug 2026 15:15:23 +0000",
  documentText: "Transcript\nAli: Le pilote est validé.",
  from: "Gemini <gemini-notes@google.com>",
  id: "gmail-message-1",
  senderEmail: "gemini-notes@google.com",
  subject: 'Notes : "Projet Atlas - Production" 6 août 2026',
  threadId: "gmail-thread-1",
};

describe("Gemini meeting note email parsing", () => {
  it("extracts a bounded private note and its Google artifacts", () => {
    const parsed = parseGeminiMeetingNoteMessage(message);

    expect(parsed).toMatchObject({
      documentFileId: "doc-file-123",
      documentUrl: "https://docs.google.com/document/d/doc-file-123/edit",
      documentText: "Transcript\nAli: Le pilote est validé.",
      externalMessageId: "gmail-message-1",
      externalThreadId: "gmail-thread-1",
      occurredAt: "2026-08-06T15:15:23.000Z",
      recordingUrl: "https://drive.google.com/file/d/video-file-456/view",
      senderEmail: "gemini-notes@google.com",
      title: "Projet Atlas - Production",
    });
    expect(parsed?.notesMarkdown).toContain("Résumé");
    expect(parsed?.notesMarkdown).toContain("Le lancement reste prévu lundi.");
    expect(parsed?.notesMarkdown).not.toContain("Google LLC");
    expect(parsed?.notesMarkdown).not.toContain("qualtrics");
  });

  it("rejects an empty notification instead of persisting metadata only", () => {
    expect(
      parseGeminiMeetingNoteMessage({ ...message, bodyText: "" }),
    ).toBeUndefined();
  });
});

describe("Gemini meeting matching", () => {
  it("matches an exact title and nearby date", () => {
    const parsed = parseGeminiMeetingNoteMessage(message)!;
    expect(
      matchGeminiNoteToMeeting(parsed, [
        {
          id: "meeting-atlas",
          startsAt: "2026-08-06T14:45:00.000Z",
          title: "Projet Atlas - Production",
        },
        {
          id: "meeting-other",
          startsAt: "2026-08-06T14:45:00.000Z",
          title: "Projet Atlas - Logistique",
        },
      ]),
    ).toBe("meeting-atlas");
  });

  it("fails closed when two generic meetings are equally plausible", () => {
    expect(
      matchGeminiNoteToMeeting(
        { occurredAt: "2026-08-06T15:15:23.000Z", title: "Réunion" },
        [
          {
            id: "meeting-a",
            startsAt: "2026-08-06T15:00:00.000Z",
            title: "Réunion",
          },
          {
            id: "meeting-b",
            startsAt: "2026-08-06T15:05:00.000Z",
            title: "Réunion",
          },
        ],
      ),
    ).toBeUndefined();
  });
});
