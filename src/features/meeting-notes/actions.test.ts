import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listGoogleCalendarEvents: vi.fn(),
  requireMeetingNotesAccess: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("./access", () => ({
  requireMeetingNotesAccess: mocks.requireMeetingNotesAccess,
}));

vi.mock("@/platform/integrations/google-workspace", () => ({
  createGoogleCalendarReminder: vi.fn(),
  listGeminiMeetingNoteMessages: vi.fn(),
  listGoogleCalendarEvents: mocks.listGoogleCalendarEvents,
}));

import {
  fetchMeetingIntelligenceAction,
  openMeetingWorkspaceAction,
  queueMeetingProcessingAction,
  registerMeetingSupportAction,
  saveMeetingCaptureDraftAction,
} from "./actions";

const organizationId = "11111111-1111-4111-8111-111111111111";
const meetingId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const chunkPath = `${organizationId}/${meetingId}/${sessionId}/chunk-0000.m4a`;
const manifest = {
  chunks: [{ path: chunkPath, sha256: "a".repeat(64), sizeBytes: 1 }],
  mimeType: "audio/mp4",
  originalFileName: "meeting.m4a",
  totalBytes: 1,
};

describe("meeting intelligence queue action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves uploaded audio after an atomic queue rejection", async () => {
    const fixture = makeSupabaseFixture({
      assetRecovery: null,
      rpcResult: {
        data: null,
        error: { message: "processing job insert failed" },
      },
    });
    grantAccess(fixture.supabase);

    const result = await queueMeetingProcessingAction(meetingId, manifest);

    expect(result).toMatchObject({
      error: "processing job insert failed",
      success: false,
    });
    expect(fixture.remove).not.toHaveBeenCalled();
  });

  it("recovers a committed job when the RPC response is lost", async () => {
    const fixture = makeSupabaseFixture({
      assetRecovery: { id: "44444444-4444-4444-8444-444444444444" },
      jobRecovery: { id: "55555555-5555-4555-8555-555555555555" },
      rpcError: new Error("response lost after commit"),
    });
    grantAccess(fixture.supabase);

    const result = await queueMeetingProcessingAction(meetingId, manifest);

    expect(result).toEqual({
      jobId: "55555555-5555-4555-8555-555555555555",
      success: true,
    });
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/meetings");
  });
});

describe("one-step meeting capture validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty title before accessing founder data", async () => {
    const result = await saveMeetingCaptureDraftAction({
      attendees: [],
      liveNotesMarkdown: "notes",
      meetingId,
      title: "   ",
    });

    expect(result).toMatchObject({ success: false });
    expect(mocks.requireMeetingNotesAccess).not.toHaveBeenCalled();
  });

  it("rejects unsupported presentation formats before storage access", async () => {
    const result = await registerMeetingSupportAction({
      meetingId,
      support: {
        chunks: [
          {
            path: `${organizationId}/${meetingId}/${sessionId}/chunk-0000.pptx`,
            sha256: "a".repeat(64),
            sizeBytes: 1,
          },
        ],
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        originalFileName: "pitch.pptx",
        totalBytes: 1,
      },
    });

    expect(result).toMatchObject({
      error: "Le support doit être un PDF, TXT ou Markdown.",
      success: false,
    });
    expect(mocks.requireMeetingNotesAccess).not.toHaveBeenCalled();
  });
});

describe("focused meeting workspace action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-reads today's Calendar event server-side before creating its workspace", async () => {
    const existingQuery = makeActionQuery({ data: null, error: null });
    const createdRow = {
      attendees: [{ displayName: "Sara", email: "sara@client.com" }],
      calendar_event_id: "evt-client",
      calendar_event_url: "https://calendar.google.com/event?eid=client",
      id: meetingId,
      live_notes_markdown: "",
      organization_id: organizationId,
      starts_at: "2026-08-10T09:00:00.000Z",
      status: "scheduled",
      title: "Point client",
      updated_at: "2026-08-10T08:00:00.000Z",
    };
    const insertQuery = makeActionQuery({ data: createdRow, error: null });
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(existingQuery)
        .mockReturnValueOnce(insertQuery),
    };
    grantAccess(supabase);
    mocks.listGoogleCalendarEvents.mockResolvedValue([
      {
        attendees: [{ displayName: "Sara", email: "sara@client.com" }],
        htmlLink: "https://calendar.google.com/event?eid=client",
        id: "evt-client",
        start: "2026-08-10T10:00:00+01:00",
        title: "Point client",
      },
    ]);

    const result = await openMeetingWorkspaceAction({
      calendarEventId: "evt-client",
      source: "google-calendar",
    });

    expect(result).toMatchObject({
      meeting: {
        calendarEventId: "evt-client",
        id: meetingId,
        title: "Point client",
      },
      success: true,
    });
    expect(mocks.listGoogleCalendarEvents).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 50 }),
      {
        organizationId,
        profileId: "66666666-6666-4666-8666-666666666666",
        supabase,
      },
    );
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendar_event_id: "evt-client",
        organization_id: organizationId,
        source: "google-calendar",
        title: "Point client",
      }),
    );
  });

  it("creates a manual workspace without making a Calendar request", async () => {
    const createdRow = {
      attendees: [{ name: "Nabil" }],
      id: meetingId,
      live_notes_markdown: "",
      organization_id: organizationId,
      starts_at: "2026-08-10T09:00:00.000Z",
      status: "scheduled",
      title: "Point Qarizmi",
      updated_at: "2026-08-10T09:00:00.000Z",
    };
    const insertQuery = makeActionQuery({ data: createdRow, error: null });
    grantAccess({ from: vi.fn(() => insertQuery) });

    const result = await openMeetingWorkspaceAction({
      attendees: [{ name: "Nabil" }],
      source: "manual",
      title: "Point Qarizmi",
    });

    expect(result).toMatchObject({
      meeting: { id: meetingId, title: "Point Qarizmi" },
      success: true,
    });
    expect(mocks.listGoogleCalendarEvents).not.toHaveBeenCalled();
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "manual", title: "Point Qarizmi" }),
    );
  });

  it("refreshes Calendar metadata without overwriting a founder's draft fields", async () => {
    const existingRow = {
      attendees: [{ name: "Participant ajusté" }],
      calendar_event_id: "evt-client",
      id: meetingId,
      live_notes_markdown: "Notes locales synchronisées",
      organization_id: organizationId,
      starts_at: "2026-08-10T09:00:00.000Z",
      status: "scheduled",
      title: "Titre ajusté par Ali",
      updated_at: "2026-08-10T08:00:00.000Z",
    };
    const existingQuery = makeActionQuery({
      data: existingRow,
      error: null,
    });
    const updateQuery = makeActionQuery({ data: existingRow, error: null });
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(existingQuery)
        .mockReturnValueOnce(updateQuery),
    };
    grantAccess(supabase);
    mocks.listGoogleCalendarEvents.mockResolvedValue([
      {
        attendees: [{ displayName: "Calendar participant" }],
        htmlLink: "https://calendar.google.com/event?eid=client",
        id: "evt-client",
        start: "2026-08-10T10:00:00+01:00",
        title: "Titre modifié dans Calendar",
      },
    ]);

    const result = await openMeetingWorkspaceAction({
      calendarEventId: "evt-client",
      source: "google-calendar",
    });

    expect(result).toMatchObject({
      meeting: {
        attendees: [{ name: "Participant ajusté" }],
        title: "Titre ajusté par Ali",
      },
      success: true,
    });
    expect(updateQuery.update).toHaveBeenCalledWith({
      calendar_event_url: "https://calendar.google.com/event?eid=client",
      ends_at: null,
      location: null,
      starts_at: "2026-08-10T09:00:00.000Z",
    });
    expect(updateQuery.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ attendees: expect.anything() }),
    );
    expect(updateQuery.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ updated_at: expect.anything() }),
    );
  });
});

describe("Meeting Intelligence Google scope state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces an explicit reconnect state for a legacy broad Drive grant", async () => {
    const meetings = makeThenableQuery({ data: [], error: null });
    const artifacts = makeThenableQuery({ data: [], error: null });
    const connection = makeThenableQuery({
      data: {
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/drive.file",
        ],
      },
      error: null,
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "meetings") return meetings;
        if (table === "meeting_external_artifacts") return artifacts;
        if (table === "integration_connections") return connection;
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    grantAccess(supabase);

    const state = await fetchMeetingIntelligenceAction();

    expect(state).toMatchObject({
      configured: true,
      geminiDocumentAccess: false,
      googleWorkspaceReconnectRequired: true,
    });
  });
});

function grantAccess(supabase: unknown) {
  mocks.requireMeetingNotesAccess.mockResolvedValue({
    organizationId,
    supabase,
    user: { id: "66666666-6666-4666-8666-666666666666" },
  });
}

function makeSupabaseFixture({
  assetRecovery,
  jobRecovery = null,
  rpcError,
  rpcResult = { data: "77777777-7777-4777-8777-777777777777", error: null },
}: {
  assetRecovery: { id: string } | null;
  jobRecovery?: { id: string } | null;
  rpcError?: Error;
  rpcResult?: { data: string | null; error: { message: string } | null };
}) {
  const meetingQuery = makeQuery({ data: { id: meetingId }, error: null });
  const activeJobQuery = makeQuery({ data: null, error: null });
  const assetRecoveryQuery = makeQuery({
    data: assetRecovery,
    error: null,
  });
  const jobRecoveryQuery = makeQuery({ data: jobRecovery, error: null });
  let processingQueryCount = 0;
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const rpc = rpcError
    ? vi.fn().mockRejectedValue(rpcError)
    : vi.fn().mockResolvedValue(rpcResult);

  return {
    remove,
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "meetings") return meetingQuery;
        if (table === "meeting_assets") return assetRecoveryQuery;
        if (table === "meeting_processing_jobs") {
          processingQueryCount += 1;
          return processingQueryCount === 1 ? activeJobQuery : jobRecoveryQuery;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      rpc,
      storage: {
        from: vi.fn(() => ({
          list: vi.fn().mockResolvedValue({
            data: [{ name: "chunk-0000.m4a" }],
            error: null,
          }),
          remove,
        })),
      },
    },
  };
}

function makeQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["eq", "in", "select"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  query.single = vi.fn().mockResolvedValue(result);
  return query;
}

function makeThenableQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ["eq", "limit", "order", "select"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  query.then = (resolve: (value: typeof result) => unknown) =>
    Promise.resolve(resolve(result));
  return query;
}

function makeActionQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["eq", "insert", "limit", "order", "select", "update"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  query.single = vi.fn().mockResolvedValue(result);
  return query;
}
