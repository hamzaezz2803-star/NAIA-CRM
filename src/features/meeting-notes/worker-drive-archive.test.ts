import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveMeetingOutput: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));
vi.mock("./drive", () => ({
  archiveMeetingOutput: mocks.archiveMeetingOutput,
  loadMeetingSupportContext: vi.fn(),
}));

import { completeMeetingJob, MeetingJobLeaseError } from "./worker-service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const meetingId = "22222222-2222-4222-8222-222222222222";
const companyId = "33333333-3333-4333-8333-333333333333";
const outputId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";
const leaseToken = "66666666-6666-4666-8666-666666666666";

describe("worker one-step Drive archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an expired reservation before any Drive call", async () => {
    const fixture = makeWorkerFixture({ reservationResult: null });
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fixture.supabase);

    await expect(
      completeMeetingJob(jobId, completionPayload),
    ).rejects.toBeInstanceOf(MeetingJobLeaseError);
    expect(mocks.archiveMeetingOutput).not.toHaveBeenCalled();
    expect(fixture.reservationQuery.gt).toHaveBeenCalledWith(
      "lease_expires_at",
      expect.any(String),
    );
  });

  it("keeps the transcript successful but warns when provider success is followed by DB CAS zero", async () => {
    const fixture = makeWorkerFixture({ finalizeResult: false });
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fixture.supabase);
    mocks.archiveMeetingOutput.mockImplementation(async (input) => {
      await input.authorizeMutation?.();
      return archiveResult;
    });

    const result = await completeMeetingJob(jobId, completionPayload);

    expect(result.outputId).toBe(outputId);
    expect(result.warnings).toEqual([
      expect.stringContaining("finalisation CAS du job a été refusée"),
    ]);
    expect(fixture.rpc).toHaveBeenCalledWith(
      "finalize_worker_meeting_drive_archive",
      expect.objectContaining({
        archive_files: archiveManifest,
        archive_manifest_sha256:
          "c869bb59e10ed7aaf66a07104bd9cfb422a4f3c2ef6626801bae670bd5951584",
      }),
    );
  });

  it.each([["non-founder creator"], ["revoked owner"], ["wrong output"]])(
    "fails closed when worker authorization rejects a %s",
    async () => {
      const fixture = makeWorkerFixture({ authorizeResult: false });
      mocks.createServiceRoleSupabaseClient.mockReturnValue(fixture.supabase);
      mocks.archiveMeetingOutput.mockImplementation(async (input) => {
        await input.authorizeMutation?.();
        return archiveResult;
      });

      const result = await completeMeetingJob(jobId, completionPayload);

      expect(result.warnings).toEqual([
        expect.stringContaining("créateur owner ou la révision"),
      ]);
      expect(fixture.rpc).not.toHaveBeenCalledWith(
        "finalize_worker_meeting_drive_archive",
        expect.anything(),
      );
    },
  );

  it("finalizes and rereads a replayed manifest without duplicating assets", async () => {
    const fixture = makeWorkerFixture({});
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fixture.supabase);
    mocks.archiveMeetingOutput.mockImplementation(async (input) => {
      await input.authorizeMutation?.();
      await input.authorizeMutation?.();
      return archiveResult;
    });

    await expect(completeMeetingJob(jobId, completionPayload)).resolves.toEqual(
      {
        outputId,
        warnings: [],
      },
    );
    expect(fixture.rpc).toHaveBeenCalledTimes(3);
    expect(fixture.from).toHaveBeenCalledWith("meeting_assets");
    expect(fixture.completionJobQuery.maybeSingle).toHaveBeenCalledOnce();
  });
});

const completionPayload = {
  engine: {},
  leaseToken,
  notesMarkdown: "Compte rendu suffisamment long pour le worker.",
  structured: {},
  transcriptSrt:
    "1\n00:00:00,000 --> 00:00:02,000\nTranscript suffisamment long.",
  transcriptText: "Transcript suffisamment long pour valider le schéma.",
  warnings: [],
  workerId: "qa-worker",
};

const archiveManifest = [
  makeFile("a_drive", "meeting-notes", "notes.md", "text/markdown", "a"),
  makeFile("A-drive", "transcript-text", "transcript.txt", "text/plain", "b"),
  makeFile(
    "_drive",
    "transcript-srt",
    "transcript.srt",
    "application/x-subrip",
    "c",
  ),
  makeFile(
    "-drive",
    "structured-output",
    "analysis.json",
    "application/json",
    "d",
  ),
];
const archiveResult = {
  files: archiveManifest,
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

function makeWorkerFixture({
  authorizeResult = true,
  finalizeResult = true,
  reservationResult = { id: jobId },
}: {
  authorizeResult?: boolean;
  finalizeResult?: boolean;
  reservationResult?: { id: string } | null;
}) {
  const job = {
    audio_asset_id: "77777777-7777-4777-8777-777777777777",
    id: jobId,
    lease_token: leaseToken,
    meeting_id: meetingId,
    organization_id: organizationId,
    status: "uploading",
    worker_id: "qa-worker",
  };
  const output = {
    approval_warnings: [],
    id: outputId,
    job_id: jobId,
    meeting_id: meetingId,
    notes_markdown: completionPayload.notesMarkdown,
    organization_id: organizationId,
    review_revision: 0,
    structured_output: {},
    transcript_srt: completionPayload.transcriptSrt,
    transcript_text: completionPayload.transcriptText,
    version: 1,
    warnings: [],
  };
  const meeting = {
    company_id: companyId,
    id: meetingId,
    organization_id: organizationId,
    starts_at: "2026-08-10T09:30:00.000Z",
    title: "Atlas kickoff",
  };
  const initialJobQuery = makeQuery({ data: job, error: null });
  const reservationQuery = makeQuery({
    data: reservationResult,
    error: null,
  });
  const completionJobQuery = makeQuery({
    data: { id: jobId },
    error: null,
  });
  const jobQueries = [initialJobQuery, reservationQuery, completionJobQuery];
  const outputQueries = [
    makeQuery({ data: output, error: null }),
    makeQuery({
      data: { id: outputId, job_id: jobId, review_revision: 0, version: 1 },
      error: null,
    }),
    makeQuery({ data: null, error: null }),
  ];
  const meetingQueries = [
    makeQuery({ data: meeting, error: null }),
    makeQuery({
      data: {
        company_id: companyId,
        drive_folder_id: archiveResult.folderId,
        drive_folder_url: archiveResult.folderUrl,
        id: meetingId,
      },
      error: null,
    }),
    makeQuery({ data: null, error: null }),
  ];
  const assetQueries = [
    makeQuery({
      data: archiveManifest.map((file) => ({
        display_name: file.name,
        external_id: file.externalId,
        metadata: {
          parentFolderId: file.parentFolderId,
          sha256: file.sha256,
        },
      })),
      error: null,
    }),
  ];
  const tableQueries: Record<string, Array<Record<string, unknown>>> = {
    crm_companies: [
      makeQuery({
        data: { industry: "Tech", name: "Atlas", notes: null, website: null },
        error: null,
      }),
    ],
    meeting_assets: assetQueries,
    meeting_outputs: outputQueries,
    meeting_processing_jobs: jobQueries,
    meetings: meetingQueries,
  };
  const rpc = vi.fn(async (name: string) => {
    if (name === "authorize_worker_meeting_drive_archive") {
      return { data: authorizeResult, error: null };
    }
    if (name === "finalize_worker_meeting_drive_archive") {
      return { data: finalizeResult, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const from = vi.fn((table: string) => {
    const query = tableQueries[table]?.shift();
    if (!query) throw new Error(`Unexpected table call ${table}`);
    return query;
  });
  return {
    assetQueries,
    completionJobQuery,
    from,
    reservationQuery,
    rpc,
    supabase: {
      from,
      rpc,
    },
  };
}

function makeQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of [
    "eq",
    "gt",
    "in",
    "limit",
    "order",
    "select",
    "update",
  ]) {
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
