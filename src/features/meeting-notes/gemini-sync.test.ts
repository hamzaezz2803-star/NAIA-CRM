import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listGeminiMeetingNoteMessages: vi.fn(),
  requireMeetingNotesAccess: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./access", () => ({
  requireMeetingNotesAccess: mocks.requireMeetingNotesAccess,
}));
vi.mock("@/platform/integrations/google-workspace", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/platform/integrations/google-workspace")
    >();
  return {
    ...actual,
    listGeminiMeetingNoteMessages: mocks.listGeminiMeetingNoteMessages,
  };
});

import { syncGeminiMeetingNotesAction } from "./actions";

const organizationId = "11111111-1111-4111-8111-111111111111";
const meetingId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";

describe("Gemini Gmail meeting sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads only the allowlisted feed and upserts a deduplicated private artifact", async () => {
    mocks.listGeminiMeetingNoteMessages.mockResolvedValue([
      {
        bodyText: [
          'Notes de "Projet Atlas - Production"',
          "",
          "Résumé",
          "Le pilote a été validé.",
          "",
          "https://docs.google.com/document/d/doc-123/edit",
        ].join("\n"),
        date: "Thu, 6 Aug 2026 15:15:23 +0000",
        from: "Gemini <gemini-notes@google.com>",
        id: "gmail-message-1",
        senderEmail: "gemini-notes@google.com",
        subject: 'Notes : "Projet Atlas - Production" 6 août 2026',
        threadId: "gmail-thread-1",
      },
    ]);
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    let artifactReadCount = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "meetings") {
          return queryResult({
            data: [
              {
                id: meetingId,
                starts_at: "2026-08-06T15:00:00.000Z",
                title: "Projet Atlas - Production",
              },
            ],
            error: null,
          });
        }
        if (table === "meeting_external_artifacts") {
          artifactReadCount += 1;
          return artifactReadCount === 1
            ? queryResult({ data: [], error: null })
            : { upsert };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    mocks.requireMeetingNotesAccess.mockResolvedValue({
      organizationId,
      supabase,
      user: { id: profileId },
    });

    const result = await syncGeminiMeetingNotesAction();

    expect(result).toMatchObject({
      imported: 1,
      matched: 1,
      success: true,
      total: 1,
    });
    expect(mocks.listGeminiMeetingNoteMessages).toHaveBeenCalledWith(
      { maxResults: 40, newerThanDays: 180 },
      { organizationId, profileId, supabase },
    );
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          document_file_id: "doc-123",
          external_message_id: "gmail-message-1",
          meeting_id: meetingId,
          organization_id: organizationId,
          provider: "google-gemini",
          sender_email: "gemini-notes@google.com",
        }),
      ],
      { onConflict: "organization_id,provider,external_message_id" },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/meetings");
  });

  it("does not touch Supabase when Gmail returns no matching note", async () => {
    const supabase = { from: vi.fn() };
    mocks.listGeminiMeetingNoteMessages.mockResolvedValue([]);
    mocks.requireMeetingNotesAccess.mockResolvedValue({
      organizationId,
      supabase,
      user: { id: profileId },
    });

    await expect(syncGeminiMeetingNotesAction()).resolves.toEqual({
      imported: 0,
      matched: 0,
      success: true,
      total: 0,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

function queryResult(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {
    then: (
      resolve: (value: { data: unknown; error: unknown }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["eq", "in", "limit", "order", "select"]) {
    query[method] = vi.fn(() => query);
  }
  return query;
}
