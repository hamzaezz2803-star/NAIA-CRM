import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const driveServiceMocks = vi.hoisted(() => ({
  downloadDriveFile: vi.fn(),
  getDriveFileMetadata: vi.fn(),
  isDriveServiceConfigured: vi.fn(() => true),
  listDriveFolderFiles: vi.fn(),
  uploadDriveFile: vi.fn(),
}));

vi.mock("@/platform/integrations/google-drive-service", () => ({
  downloadDriveFile: driveServiceMocks.downloadDriveFile,
  getDriveFileMetadata: driveServiceMocks.getDriveFileMetadata,
  isDriveServiceConfigured: driveServiceMocks.isDriveServiceConfigured,
  listDriveFolderFiles: driveServiceMocks.listDriveFolderFiles,
  uploadDriveFile: driveServiceMocks.uploadDriveFile,
}));

import {
  downloadMayaDriveDeckToTemp,
  findMayaDriveArtifacts,
  getMayaDriveConfigFromEnv,
  getMayaDriveTemplateFile,
  hasMayaClientDriveConfig,
  hasMayaDriveFolderConfig,
  inspectMayaDriveDestination,
  listMayaDriveDeckFiles,
  parseMayaDriveFolderId,
  uploadMayaDriveDraft,
} from "./drive";

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

describe("Maya Drive configuration and approved templates", () => {
  let tempRoot: string | null = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Object.values(driveServiceMocks).forEach((mock) => mock.mockReset());
    driveServiceMocks.isDriveServiceConfigured.mockReturnValue(true);
    if (tempRoot) {
      await rm(tempRoot, { force: true, recursive: true });
      tempRoot = null;
    }
  });

  it("uses the cofounder shared-drive folder IDs from the environment", () => {
    vi.stubEnv("MAYA_DRIVE_SOURCE_FOLDER_ID", "pitch-library-id");
    vi.stubEnv("MAYA_DRIVE_OUTPUT_FOLDER_ID", "clients-root-id");

    expect(hasMayaDriveFolderConfig()).toBe(true);
    expect(getMayaDriveConfigFromEnv()).toEqual({
      outputFolderId: "clients-root-id",
      sourceFolderId: "pitch-library-id",
    });
  });

  it("validates client destinations without depending on the legacy source folder", () => {
    vi.stubEnv("MAYA_DRIVE_OUTPUT_FOLDER_ID", "clients-root-id");
    vi.stubEnv("MAYA_DRIVE_SOURCE_FOLDER_ID", "");

    expect(hasMayaClientDriveConfig()).toBe(true);
    expect(hasMayaDriveFolderConfig()).toBe(false);
  });

  it("loads the pinned, audited Teaser PPTX as the pitch template", async () => {
    vi.stubEnv("MAYA_PITCH_TEMPLATE_FILE_ID", "approved-teaser-id");
    driveServiceMocks.getDriveFileMetadata.mockResolvedValue({
      id: "approved-teaser-id",
      mimeType: PPTX_MIME_TYPE,
      modifiedTime: "2026-08-03T22:14:53.763Z",
      name: "Qarizmi_Introduction_Service as a software_Teaser.pptx",
      size: "4933715",
      webViewLink:
        "https://docs.google.com/presentation/d/approved-teaser-id/edit",
    });

    await expect(
      getMayaDriveTemplateFile({ family: "pitch" }),
    ).resolves.toMatchObject({
      driveFileId: "approved-teaser-id",
      fileName: "Qarizmi_Introduction_Service as a software_Teaser.pptx",
      sizeBytes: 4_933_715,
    });
  });

  it("rejects a native Google Slides source because export is not byte-faithful", async () => {
    vi.stubEnv("MAYA_PITCH_TEMPLATE_FILE_ID", "slides-id");
    driveServiceMocks.getDriveFileMetadata.mockResolvedValue({
      id: "slides-id",
      mimeType: "application/vnd.google-apps.presentation",
      modifiedTime: "2026-08-03T22:14:53.763Z",
      name: "Qarizmi_Introduction_Service as a software_Teaser",
    });

    await expect(getMayaDriveTemplateFile({ family: "pitch" })).rejects.toThrow(
      ".pptx natif",
    );
  });

  it("keeps legacy library listing for founder private-knowledge reads", async () => {
    driveServiceMocks.listDriveFolderFiles.mockResolvedValue([
      {
        id: "deck-1",
        mimeType: PPTX_MIME_TYPE,
        modifiedTime: "2026-07-08T09:00:00.000Z",
        name: "Qarizmi Generic Pitch.pptx",
        size: "4096",
      },
      { id: "ignored", mimeType: "application/pdf", name: "notes.pdf" },
    ]);

    const decks = await listMayaDriveDeckFiles({
      sourceFolderId: "pitch-library-id",
    });

    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({
      driveFileId: "deck-1",
      kind: "generic",
    });
  });

  it("downloads the selected file into an isolated temporary folder", async () => {
    driveServiceMocks.downloadDriveFile.mockResolvedValue(
      new Uint8Array([80, 75]).buffer,
    );

    const downloaded = await downloadMayaDriveDeckToTemp({
      driveFileId: "approved-teaser-id",
      fileName: "Qarizmi_Introduction_Service as a software_Teaser.pptx",
      filePath: "gdrive:approved-teaser-id",
      kind: "example",
      mimeType: PPTX_MIME_TYPE,
      modifiedAt: new Date("2026-08-03T22:14:53.763Z"),
      sizeBytes: 4_933_715,
    });
    tempRoot = path.dirname(downloaded.filePath);

    expect(driveServiceMocks.downloadDriveFile).toHaveBeenCalledWith(
      "approved-teaser-id",
      { mimeType: PPTX_MIME_TYPE },
    );
  });
});

describe("Maya fail-closed Drive destination", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.values(driveServiceMocks).forEach((mock) => mock.mockReset());
    driveServiceMocks.isDriveServiceConfigured.mockReturnValue(true);
  });

  it("accepts only the CRM-linked client folder under the configured root", async () => {
    mockValidDestination();

    const result = await findMayaDriveArtifacts({
      clientFolderUrl:
        "https://drive.google.com/drive/folders/client-folder-id",
      expectedRootFolderId: "clients-root-id",
    });

    expect(result.destination.pitchFolderId).toBe("pitch-folder-id");
    expect(result.draft?.fileName).toBe("HPS_vDraft.pptx");
    expect(driveServiceMocks.listDriveFolderFiles).toHaveBeenNthCalledWith(
      1,
      "client-folder-id",
      { maxResults: 1000 },
    );
  });

  it("blocks a CRM folder outside the configured Clients root", async () => {
    driveServiceMocks.getDriveFileMetadata.mockResolvedValue({
      id: "client-folder-id",
      mimeType: FOLDER_MIME_TYPE,
      name: "HPS",
      parents: ["different-root"],
    });

    await expect(
      inspectMayaDriveDestination({
        clientFolderUrl:
          "https://drive.google.com/drive/folders/client-folder-id",
        expectedRootFolderId: "clients-root-id",
      }),
    ).rejects.toThrow("hors du root Clients");
    expect(driveServiceMocks.listDriveFolderFiles).not.toHaveBeenCalled();
  });

  it("blocks missing and duplicate 01_Pitch children without creating one", async () => {
    driveServiceMocks.getDriveFileMetadata.mockResolvedValue({
      id: "client-folder-id",
      mimeType: FOLDER_MIME_TYPE,
      name: "HPS",
      parents: ["clients-root-id"],
    });
    driveServiceMocks.listDriveFolderFiles.mockResolvedValueOnce([]);

    await expect(
      inspectMayaDriveDestination({
        clientFolderUrl:
          "https://drive.google.com/drive/folders/client-folder-id",
        expectedRootFolderId: "clients-root-id",
      }),
    ).rejects.toThrow("aucune création automatique");

    driveServiceMocks.listDriveFolderFiles.mockResolvedValueOnce([
      { id: "pitch-1", mimeType: FOLDER_MIME_TYPE, name: "01_Pitch" },
      { id: "pitch-2", mimeType: FOLDER_MIME_TYPE, name: "01_Pitch" },
    ]);
    await expect(
      inspectMayaDriveDestination({
        clientFolderUrl:
          "https://drive.google.com/drive/folders/client-folder-id",
        expectedRootFolderId: "clients-root-id",
      }),
    ).rejects.toThrow("destination est ambiguë");
    expect(driveServiceMocks.uploadDriveFile).not.toHaveBeenCalled();
  });

  it("rejects non-Google folder URLs", () => {
    expect(() =>
      parseMayaDriveFolderId("https://example.com/folders/client-folder-id"),
    ).toThrow("domaine Google Drive autorisé");
  });

  it("uploads exactly one PPTX into the already-validated 01_Pitch", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maya-upload-"));
    const draftPath = path.join(tempRoot, "draft.pptx");
    await writeFile(draftPath, Buffer.from([1, 2, 3]));
    driveServiceMocks.uploadDriveFile.mockResolvedValue({
      id: "draft-id",
      name: "HPS_vDraft.pptx",
      webViewLink: "https://drive.google.com/file/d/draft-id/view",
    });

    try {
      await expect(
        uploadMayaDriveDraft({
          draftFileName: "HPS_vDraft.pptx",
          draftFilePath: draftPath,
          pitchFolderId: "pitch-folder-id",
        }),
      ).resolves.toEqual({
        draftFileName: "HPS_vDraft.pptx",
        draftFilePath: "https://drive.google.com/file/d/draft-id/view",
      });
      expect(driveServiceMocks.uploadDriveFile).toHaveBeenCalledTimes(1);
      expect(driveServiceMocks.uploadDriveFile).toHaveBeenCalledWith({
        content: expect.any(Buffer),
        mimeType: PPTX_MIME_TYPE,
        name: "HPS_vDraft.pptx",
        parentFolderId: "pitch-folder-id",
      });
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

function mockValidDestination() {
  driveServiceMocks.getDriveFileMetadata.mockResolvedValue({
    id: "client-folder-id",
    mimeType: FOLDER_MIME_TYPE,
    name: "HPS",
    parents: ["clients-root-id"],
  });
  driveServiceMocks.listDriveFolderFiles
    .mockResolvedValueOnce([
      {
        id: "pitch-folder-id",
        mimeType: FOLDER_MIME_TYPE,
        name: "01_Pitch",
      },
    ])
    .mockResolvedValueOnce([
      {
        id: "draft-id",
        modifiedTime: "2026-08-09T09:00:00.000Z",
        name: "HPS_vDraft.pptx",
      },
    ]);
}
