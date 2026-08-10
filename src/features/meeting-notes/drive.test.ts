import { beforeEach, describe, expect, it, vi } from "vitest";

const driveMocks = vi.hoisted(() => ({
  downloadDriveFile: vi.fn(),
  ensureClientDriveFolder: vi.fn(),
  ensureDriveChildFolder: vi.fn(),
  generateDriveFileId: vi.fn(),
  getDriveFileMetadata: vi.fn(),
  isDriveServiceConfigured: vi.fn(),
  listDriveFolderFiles: vi.fn(),
  listDriveFolderFilesByName: vi.fn(),
  uploadDriveFile: vi.fn(),
}));

vi.mock("@/platform/integrations/google-drive-service", () => ({
  ...driveMocks,
}));
vi.mock("@/features/maya/pptx", () => ({ indexMayaDeck: vi.fn() }));

import { archiveMeetingOutput } from "./drive";

const meetingId = "22222222-2222-4222-8222-222222222222";

describe("meeting Drive archive attestation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveMocks.isDriveServiceConfigured.mockReturnValue(true);
    driveMocks.ensureClientDriveFolder.mockResolvedValue({
      created: false,
      folderId: "client-folder",
      folderUrl: "https://drive.google.com/drive/folders/client-folder",
    });
    driveMocks.listDriveFolderFiles.mockResolvedValue([
      {
        id: "notes-root",
        mimeType: "application/vnd.google-apps.folder",
        name: "02_Meeting Notes",
      },
    ]);
    driveMocks.ensureDriveChildFolder.mockResolvedValue("meeting-folder");
  });

  it("rejects an exact-name file whose bytes do not match", async () => {
    driveMocks.listDriveFolderFilesByName.mockResolvedValueOnce([
      {
        id: "stale-file",
        mimeType: "text/markdown",
        name: "2026-08-10_Atlas_meeting_v1_notes.md",
        parents: ["meeting-folder"],
      },
    ]);
    driveMocks.getDriveFileMetadata.mockResolvedValue({
      id: "stale-file",
      mimeType: "text/markdown",
      name: "2026-08-10_Atlas_meeting_v1_notes.md",
      parents: ["meeting-folder"],
      size: "11",
      trashed: false,
    });
    driveMocks.downloadDriveFile.mockResolvedValue(
      Uint8Array.from(Buffer.from("wrong bytes", "utf8")).buffer,
    );

    await expect(
      archiveMeetingOutput(makeArchiveInput({ notesMarkdown: "hello world" })),
    ).rejects.toThrow("contenu différent");
    expect(driveMocks.uploadDriveFile).not.toHaveBeenCalled();
  });

  it("uploads reserved ids, re-reads every byte and returns a hashed manifest", async () => {
    const uploadedContent = new Map<string, Buffer>();
    let reservation = 0;
    driveMocks.listDriveFolderFilesByName.mockResolvedValue([]);
    driveMocks.generateDriveFileId.mockImplementation(async () => {
      reservation += 1;
      return `reserved-${reservation}`;
    });
    driveMocks.uploadDriveFile.mockImplementation(async (input) => {
      uploadedContent.set(input.fileId, Buffer.from(input.content));
      return {
        id: input.fileId,
        mimeType: input.mimeType,
        name: input.name,
        webViewLink: `https://drive.google.com/file/d/${input.fileId}/view`,
      };
    });
    driveMocks.getDriveFileMetadata.mockImplementation(async (fileId) => {
      const upload = driveMocks.uploadDriveFile.mock.calls.find(
        ([input]) => input.fileId === fileId,
      )?.[0];
      return {
        id: fileId,
        mimeType: upload.mimeType,
        name: upload.name,
        parents: ["meeting-folder"],
        size: String(uploadedContent.get(fileId)?.byteLength ?? 0),
        trashed: false,
        webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
      };
    });
    driveMocks.downloadDriveFile.mockImplementation(
      async (fileId) =>
        Uint8Array.from(uploadedContent.get(fileId) ?? Buffer.alloc(0)).buffer,
    );
    const authorizeMutation = vi.fn().mockResolvedValue(undefined);

    const result = await archiveMeetingOutput({
      ...makeArchiveInput(),
      authorizeMutation,
    });

    expect(result.files).toHaveLength(4);
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "reserved-1",
          parentFolderId: "meeting-folder",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          sizeBytes: Buffer.byteLength("hello world"),
        }),
      ]),
    );
    expect(driveMocks.uploadDriveFile).toHaveBeenCalledTimes(4);
    expect(driveMocks.downloadDriveFile).toHaveBeenCalledTimes(4);
    expect(authorizeMutation).toHaveBeenCalledTimes(8);
  });
});

function makeArchiveInput(
  overrides: Partial<Parameters<typeof archiveMeetingOutput>[0]> = {},
): Parameters<typeof archiveMeetingOutput>[0] {
  return {
    authorizeMutation: vi.fn().mockResolvedValue(undefined),
    companyName: "Atlas",
    meetingDate: "2026-08-10T09:30:00.000Z",
    meetingId,
    meetingTitle: "Kickoff",
    notesMarkdown: "hello world",
    outputVersion: 1,
    structuredOutput: { actions: [], decisions: [], summary: "Summary" },
    transcriptSrt: "1\n00:00:00,000 --> 00:00:01,000\nBonjour",
    transcriptText: "Bonjour",
    ...overrides,
  };
}
