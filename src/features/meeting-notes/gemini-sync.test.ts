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
    mocks.listGeminiMeetingNoteMessages.mockResolvedValue({
      documentCount: 1,
      messages: [
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
      ],
      nextPageToken: "next-opaque-cursor",
      processedBytes: 4096,
      scanned: 25,
    });
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
      rpc: vi.fn(async (name: string) => {
        if (name === "claim_meeting_gemini_sync") {
          return {
            data: executeClaim("starting-durable-cursor"),
            error: null,
          };
        }
        if (name === "complete_meeting_gemini_sync") {
          return { data: true, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      }),
    };
    mocks.requireMeetingNotesAccess.mockResolvedValue({
      organizationId,
      supabase,
      user: { id: profileId },
    });

    const result = await syncGeminiMeetingNotesAction({
      pageToken: "starting-opaque-cursor",
    });

    expect(result).toMatchObject({
      imported: 1,
      matched: 1,
      nextPageToken: "next-opaque-cursor",
      scanned: 25,
      success: true,
      total: 1,
    });
    expect(mocks.listGeminiMeetingNoteMessages).toHaveBeenCalledWith(
      {
        deadlineAt: "2026-08-10T10:01:30.000Z",
        maxBytes: 10_485_760,
        maxDocuments: 5,
        maxResults: 25,
        newerThanDays: 180,
        pageToken: "starting-durable-cursor",
      },
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
    expect(supabase.rpc).toHaveBeenCalledWith("complete_meeting_gemini_sync", {
      document_count: 1,
      processed_bytes: 4096,
      requested_lease_token: leaseToken,
      requested_organization_id: organizationId,
      returned_page_token: "next-opaque-cursor",
      scanned_count: 25,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/meetings");
  });

  it("does not touch Supabase when Gmail returns no matching note", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_meeting_gemini_sync") {
        return { data: executeClaim(null), error: null };
      }
      if (name === "complete_meeting_gemini_sync") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const supabase = { from: vi.fn(), rpc };
    mocks.listGeminiMeetingNoteMessages.mockResolvedValue({
      documentCount: 0,
      messages: [],
      nextPageToken: undefined,
      processedBytes: 0,
      scanned: 0,
    });
    mocks.requireMeetingNotesAccess.mockResolvedValue({
      organizationId,
      supabase,
      user: { id: profileId },
    });

    await expect(syncGeminiMeetingNotesAction()).resolves.toEqual({
      imported: 0,
      matched: 0,
      nextPageToken: undefined,
      scanned: 0,
      success: true,
      total: 0,
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_meeting_gemini_sync",
      expect.objectContaining({ requested_lease_token: leaseToken }),
    );
  });

  it("rejects a concurrent sync before any Gmail provider read", async () => {
    const supabase = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: { action: "busy" },
        error: null,
      }),
    };
    mocks.requireMeetingNotesAccess.mockResolvedValue({
      organizationId,
      supabase,
      user: { id: profileId },
    });

    await expect(syncGeminiMeetingNotesAction()).resolves.toEqual({
      error: "Une synchronisation Gemini est déjà en cours pour ce profil.",
      success: false,
    });
    expect(mocks.listGeminiMeetingNoteMessages).not.toHaveBeenCalled();
  });

  it("resumes from the durable profile cursor and ignores a forged browser cursor", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_meeting_gemini_sync") {
        return { data: executeClaim("durable-resume-cursor"), error: null };
      }
      if (name === "complete_meeting_gemini_sync") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const supabase = { from: vi.fn(), rpc };
    mocks.requireMeetingNotesAccess.mockResolvedValue({
      organizationId,
      supabase,
      user: { id: profileId },
    });
    mocks.listGeminiMeetingNoteMessages.mockResolvedValue({
      documentCount: 0,
      messages: [],
      nextPageToken: "durable-next",
      processedBytes: 0,
      scanned: 12,
    });

    await syncGeminiMeetingNotesAction({ pageToken: "forged-browser-cursor" });

    expect(mocks.listGeminiMeetingNoteMessages).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: "durable-resume-cursor" }),
      expect.anything(),
    );
  });

  it("releases the durable lease when cursor finalization updates zero rows", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_meeting_gemini_sync") {
        return { data: executeClaim(null), error: null };
      }
      if (name === "complete_meeting_gemini_sync") {
        return { data: false, error: null };
      }
      if (name === "release_meeting_gemini_sync_claim") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const supabase = { from: vi.fn(), rpc };
    mocks.requireMeetingNotesAccess.mockResolvedValue({
      organizationId,
      supabase,
      user: { id: profileId },
    });
    mocks.listGeminiMeetingNoteMessages.mockResolvedValue({
      documentCount: 0,
      messages: [],
      nextPageToken: "next-page",
      processedBytes: 0,
      scanned: 25,
    });

    const result = await syncGeminiMeetingNotesAction();

    expect(result).toMatchObject({ success: false });
    expect(rpc).toHaveBeenCalledWith(
      "release_meeting_gemini_sync_claim",
      expect.objectContaining({ requested_lease_token: leaseToken }),
    );
  });
});

const leaseToken = "77777777-7777-4777-8777-777777777777";

function executeClaim(pageToken: string | null) {
  return {
    action: "execute",
    deadlineAt: "2026-08-10T10:01:30.000Z",
    leaseToken,
    maxBytes: 10_485_760,
    maxDocuments: 20,
    maxResults: 25,
    pageToken,
  };
}

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
