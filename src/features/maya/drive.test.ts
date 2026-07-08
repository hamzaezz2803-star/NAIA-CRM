import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const driveServiceMocks = vi.hoisted(() => ({
  downloadDriveFile: vi.fn(),
  ensureClientDriveFolder: vi.fn(),
  isDriveServiceConfigured: vi.fn(() => true),
  listDriveFolderFiles: vi.fn(),
  uploadDriveFile: vi.fn(),
}));

vi.mock("@/platform/integrations/google-drive-service", () => ({
  downloadDriveFile: driveServiceMocks.downloadDriveFile,
  ensureClientDriveFolder: driveServiceMocks.ensureClientDriveFolder,
  getClientsRootFolderId: vi.fn(() => process.env.MAYA_DRIVE_OUTPUT_FOLDER_ID),
  getPitchSourceFolderId: vi.fn(() => process.env.MAYA_DRIVE_SOURCE_FOLDER_ID),
  isDriveServiceConfigured: driveServiceMocks.isDriveServiceConfigured,
  listDriveFolderFiles: driveServiceMocks.listDriveFolderFiles,
  uploadDriveFile: driveServiceMocks.uploadDriveFile,
}));

import {
  getMayaDriveConfigFromEnv,
  hasMayaDriveFolderConfig,
  listMayaDriveDeckFiles,
  uploadMayaDriveDraftArtifacts,
} from "./drive";

describe("Maya Drive configuration", () => {
  let tempRoot: string | null = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    driveServiceMocks.downloadDriveFile.mockReset();
    driveServiceMocks.ensureClientDriveFolder.mockReset();
    driveServiceMocks.isDriveServiceConfigured.mockReset();
    driveServiceMocks.isDriveServiceConfigured.mockReturnValue(true);
    driveServiceMocks.listDriveFolderFiles.mockReset();
    driveServiceMocks.uploadDriveFile.mockReset();
    if (tempRoot) {
      await rm(tempRoot, { force: true, recursive: true });
      tempRoot = null;
    }
  });

  it("uses the cofounder shared drive folder IDs provided by environment variables", () => {
    vi.stubEnv(
      "MAYA_DRIVE_SOURCE_FOLDER_ID",
      "1IeekoGpVpIwGRHsYjS1cuvPnSP9OJsmH",
    );
    vi.stubEnv(
      "MAYA_DRIVE_OUTPUT_FOLDER_ID",
      "1ayZ6wUIpWElEM4N0Xm1UqHRNzCz0uSn0",
    );

    expect(hasMayaDriveFolderConfig()).toBe(true);
    expect(getMayaDriveConfigFromEnv()).toEqual({
      outputFolderId: "1ayZ6wUIpWElEM4N0Xm1UqHRNzCz0uSn0",
      sourceFolderId: "1IeekoGpVpIwGRHsYjS1cuvPnSP9OJsmH",
    });
  });

  it("lists Maya source decks through the service account Drive helper", async () => {
    driveServiceMocks.listDriveFolderFiles.mockResolvedValue([
      {
        id: "deck-1",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        modifiedTime: "2026-07-08T09:00:00.000Z",
        name: "Qarizmi Generic Pitch.pptx",
        size: "4096",
        webViewLink: "https://drive.google.com/file/d/deck-1/view",
      },
      {
        id: "ignored-doc",
        mimeType: "application/pdf",
        name: "notes.pdf",
      },
    ]);

    const decks = await listMayaDriveDeckFiles({
      sourceFolderId: "pitch-library-id",
    });

    expect(driveServiceMocks.listDriveFolderFiles).toHaveBeenCalledWith(
      "pitch-library-id",
      { maxResults: 1000 },
    );
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({
      driveFileId: "deck-1",
      fileName: "Qarizmi Generic Pitch.pptx",
      kind: "generic",
      webViewLink: "https://drive.google.com/file/d/deck-1/view",
    });
  });

  it("uploads Maya drafts into the client 01_Pitch folder through the service account", async () => {
    driveServiceMocks.ensureClientDriveFolder.mockResolvedValue({
      created: false,
      folderId: "client-root-folder",
      folderUrl: "https://drive.google.com/drive/folders/client-root-folder",
    });
    driveServiceMocks.listDriveFolderFiles.mockResolvedValue([
      {
        id: "pitch-folder",
        mimeType: "application/vnd.google-apps.folder",
        name: "01_Pitch",
      },
    ]);
    driveServiceMocks.uploadDriveFile
      .mockResolvedValueOnce({
        id: "draft-id",
        name: "Atlas_AI_vDraft.pptx",
        webViewLink: "https://drive.google.com/file/d/draft-id/view",
      })
      .mockResolvedValueOnce({
        id: "manifest-id",
        name: "maya-generation-manifest.json",
        webViewLink: "https://drive.google.com/file/d/manifest-id/view",
      });
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "maya-drive-test-"));
    const draftPath = path.join(tempRoot, "draft.pptx");
    const manifestPath = path.join(tempRoot, "manifest.json");
    await writeFile(draftPath, Buffer.from([1, 2, 3]));
    await writeFile(manifestPath, Buffer.from([123, 125]));

    const result = await uploadMayaDriveDraftArtifacts({
      clientName: "Atlas AI",
      draftFileName: "Atlas_AI_vDraft.pptx",
      draftFilePath: draftPath,
      manifestPath,
    });

    expect(driveServiceMocks.ensureClientDriveFolder).toHaveBeenCalledWith(
      "Atlas AI",
    );
    expect(driveServiceMocks.uploadDriveFile).toHaveBeenNthCalledWith(1, {
      content: expect.any(Buffer),
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      name: "Atlas_AI_vDraft.pptx",
      parentFolderId: "pitch-folder",
    });
    expect(driveServiceMocks.uploadDriveFile).toHaveBeenNthCalledWith(2, {
      content: expect.any(Buffer),
      mimeType: "application/json",
      name: "maya-generation-manifest.json",
      parentFolderId: "pitch-folder",
    });
    expect(result).toEqual({
      draftFileName: "Atlas_AI_vDraft.pptx",
      draftFilePath: "https://drive.google.com/file/d/draft-id/view",
      manifestPath: "https://drive.google.com/file/d/manifest-id/view",
    });
  });
});
