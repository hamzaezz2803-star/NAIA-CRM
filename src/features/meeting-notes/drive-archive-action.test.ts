import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveMeetingOutput: vi.fn(),
  requireMeetingNotesAccess: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./access", () => ({
  requireMeetingNotesAccess: mocks.requireMeetingNotesAccess,
}));
vi.mock("./drive", () => ({
  archiveMeetingOutput: mocks.archiveMeetingOutput,
}));

import { retryMeetingDriveArchiveAction } from "./actions";

const organizationId = "11111111-1111-4111-8111-111111111111";
const meetingId = "22222222-2222-4222-8222-222222222222";
const companyId = "33333333-3333-4333-8333-333333333333";
const outputId = "44444444-4444-4444-8444-444444444444";
const profileId = "55555555-5555-4555-8555-555555555555";

describe("retryMeetingDriveArchiveAction authorization and CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks the first provider mutation after an owner downgrade", async () => {
    const fixture = makeFixture({ authorizeResults: [false] });
    grantAccess(fixture.supabase);
    mocks.archiveMeetingOutput.mockImplementation(async (input) => {
      await input.authorizeMutation?.();
      throw new Error("provider must not run");
    });

    const result = await retryMeetingDriveArchiveAction(meetingId);

    expect(result).toMatchObject({
      error: expect.stringContaining("autorisation"),
      success: false,
    });
    expect(fixture.rpc).toHaveBeenCalledWith(
      "authorize_meeting_drive_archive",
      expect.objectContaining({
        expected_review_revision: 3,
        requested_company_id: companyId,
        requested_output_id: outputId,
      }),
    );
    expect(fixture.rpc).not.toHaveBeenCalledWith(
      "finalize_meeting_drive_archive",
      expect.anything(),
    );
  });

  it("stops between provider mutations when the output revision changes", async () => {
    const fixture = makeFixture({ authorizeResults: [true, false] });
    grantAccess(fixture.supabase);
    mocks.archiveMeetingOutput.mockImplementation(async (input) => {
      await input.authorizeMutation?.();
      await input.authorizeMutation?.();
      return archiveResult;
    });

    const result = await retryMeetingDriveArchiveAction(meetingId);

    expect(result).toMatchObject({
      error: expect.stringContaining("révision"),
      success: false,
    });
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.rpc).not.toHaveBeenCalledWith(
      "finalize_meeting_drive_archive",
      expect.anything(),
    );
  });

  it("does not report success when Drive succeeded but the database CAS updated zero rows", async () => {
    const fixture = makeFixture({
      authorizeResults: [true, true],
      finalizeResult: false,
    });
    grantAccess(fixture.supabase);
    mocks.archiveMeetingOutput.mockImplementation(async (input) => {
      await input.authorizeMutation?.();
      await input.authorizeMutation?.();
      return archiveResult;
    });

    const result = await retryMeetingDriveArchiveAction(meetingId);

    expect(result).toMatchObject({
      error: expect.stringContaining("base a refusé"),
      success: false,
    });
    expect(fixture.rpc).toHaveBeenCalledWith(
      "finalize_meeting_drive_archive",
      expect.objectContaining({ archive_files: archiveManifest }),
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns success only after the atomic finalize and final state reread", async () => {
    const fixture = makeFixture({
      authorizeResults: [true, true],
      finalizeResult: true,
    });
    grantAccess(fixture.supabase);
    mocks.archiveMeetingOutput.mockImplementation(async (input) => {
      await input.authorizeMutation?.();
      await input.authorizeMutation?.();
      return archiveResult;
    });

    await expect(retryMeetingDriveArchiveAction(meetingId)).resolves.toEqual({
      driveFolderUrl: archiveResult.folderUrl,
      message: "Compte rendu archivé dans le Drive privé Qarizmi.",
      success: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/meetings");
  });
});

const archiveManifest = [
  makeFile("drive-notes", "meeting-notes", "notes.md", "text/markdown", "a"),
  makeFile(
    "drive-transcript",
    "transcript-text",
    "transcript.txt",
    "text/plain",
    "b",
  ),
  makeFile(
    "drive-srt",
    "transcript-srt",
    "transcript.srt",
    "application/x-subrip",
    "c",
  ),
  makeFile(
    "drive-json",
    "structured-output",
    "analysis.json",
    "application/json",
    "d",
  ),
];

const archiveResult = {
  files: archiveManifest.map((file) => ({
    ...file,
    externalId: file.externalId,
  })),
  folderId: "meeting-folder",
  folderUrl: "https://drive.google.com/drive/folders/meeting-folder",
};

function makeFile(
  externalId: string,
  kind:
    | "meeting-notes"
    | "structured-output"
    | "transcript-srt"
    | "transcript-text",
  name: string,
  mimeType: string,
  hashCharacter: string,
) {
  return {
    externalId,
    kind,
    mimeType,
    name,
    parentFolderId: "meeting-folder",
    sha256: hashCharacter.repeat(64),
    sizeBytes: 42,
    url: `https://drive.google.com/file/d/${externalId}/view`,
  };
}

function makeFixture({
  authorizeResults,
  finalizeResult = true,
}: {
  authorizeResults: boolean[];
  finalizeResult?: boolean;
}) {
  let meetingReads = 0;
  let outputReads = 0;
  const rpc = vi.fn(async (name: string) => {
    if (name === "authorize_meeting_drive_archive") {
      return { data: authorizeResults.shift() ?? false, error: null };
    }
    if (name === "finalize_meeting_drive_archive") {
      return { data: finalizeResult, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "meetings") {
        meetingReads += 1;
        return meetingReads === 1
          ? makeQuery({
              data: {
                company: { id: companyId, name: "Atlas" },
                company_id: companyId,
                id: meetingId,
                starts_at: "2026-08-10T09:30:00.000Z",
                title: "Kickoff",
              },
              error: null,
            })
          : makeQuery({
              data: {
                company_id: companyId,
                drive_folder_id: archiveResult.folderId,
                drive_folder_url: archiveResult.folderUrl,
                id: meetingId,
              },
              error: null,
            });
      }
      if (table === "meeting_outputs") {
        outputReads += 1;
        return outputReads === 1
          ? makeQuery({
              data: {
                approval_warnings: ["Version relue en attente"],
                id: outputId,
                notes_markdown: "Notes",
                review_revision: 3,
                review_status: "approved",
                reviewed_notes_markdown: "Notes relues",
                structured_output: {},
                transcript_srt: "SRT",
                transcript_text: "Transcript",
                version: 2,
                warnings: ["Archivage Drive différé: timeout"],
              },
              error: null,
            })
          : makeQuery({
              data: { id: outputId, review_revision: 3, version: 2 },
              error: null,
            });
      }
      if (table === "meeting_assets") {
        return makeQuery({
          data: archiveManifest.map((file) => ({
            display_name: file.name,
            external_id: file.externalId,
            metadata: {
              parentFolderId: file.parentFolderId,
              sha256: file.sha256,
            },
          })),
          error: null,
        });
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    rpc,
  };
  return { rpc, supabase };
}

function grantAccess(supabase: unknown) {
  mocks.requireMeetingNotesAccess.mockResolvedValue({
    organizationId,
    supabase,
    user: { id: profileId },
  });
}

function makeQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ["eq", "in", "limit", "order", "select"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  query.single = vi.fn().mockResolvedValue(result);
  query.then = (
    resolve: (value: typeof result) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}
