import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureClientDriveFolder,
  isDriveServiceConfigured,
  listDriveFolderFiles,
  downloadDriveFile,
  uploadDriveFile,
  type DriveFileSummary,
} from "@/platform/integrations/google-drive-service";

import type { MayaDeckFile, MayaDeckKind } from "./contracts";
import { isNabilFinalPitchFileName } from "./storage";

const PITCH_SUBFOLDER_NAME = "01_Pitch";
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export type MayaDriveConfig = {
  outputFolderId: string;
  sourceFolderId: string;
};

export type MayaDriveDeckFile = MayaDeckFile & {
  driveFileId: string;
  webViewLink?: string;
};

export type MayaDriveUploadResult = {
  draftFileName: string;
  draftFilePath: string;
  manifestPath?: string;
};

export function hasMayaDriveFolderConfig(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    env.MAYA_DRIVE_SOURCE_FOLDER_ID?.trim() &&
    env.MAYA_DRIVE_OUTPUT_FOLDER_ID?.trim() &&
    isDriveServiceConfigured(),
  );
}

export function getMayaDriveConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MayaDriveConfig {
  const sourceFolderId = env.MAYA_DRIVE_SOURCE_FOLDER_ID?.trim();
  const outputFolderId = env.MAYA_DRIVE_OUTPUT_FOLDER_ID?.trim();

  if (!sourceFolderId || !outputFolderId) {
    throw new Error(
      "MAYA_DRIVE_SOURCE_FOLDER_ID and MAYA_DRIVE_OUTPUT_FOLDER_ID are required for Maya Drive mode.",
    );
  }

  return {
    outputFolderId,
    sourceFolderId,
  };
}

export async function listMayaDriveDeckFiles({
  sourceFolderId,
}: {
  sourceFolderId: string;
}) {
  const files = await listDriveFolderFiles(sourceFolderId, {
    maxResults: 1000,
  });

  return files
    .filter(isPptxDriveFile)
    .map(toMayaDriveDeckFile)
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export async function downloadMayaDriveDeckToTemp(file: MayaDriveDeckFile) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maya-drive-deck-"));
  const filePath = path.join(tempRoot, file.fileName);

  await writeFile(
    filePath,
    Buffer.from(await downloadDriveFile(file.driveFileId)),
  );

  return {
    ...file,
    filePath,
  } satisfies MayaDriveDeckFile;
}

export async function uploadMayaDriveDraftArtifacts({
  clientName,
  draftFileName,
  draftFilePath,
  manifestPath,
}: {
  clientName: string;
  draftFileName: string;
  draftFilePath: string;
  manifestPath: string;
}): Promise<MayaDriveUploadResult> {
  const clientFolder = await ensureClientDriveFolder(clientName);
  const pitchFolderId = await findClientPitchFolderId(clientFolder.folderId);
  const draft = await uploadDriveFile({
    content: await readFile(draftFilePath),
    mimeType: PPTX_MIME_TYPE,
    name: draftFileName,
    parentFolderId: pitchFolderId,
  });
  const manifest = await uploadDriveFile({
    content: await readFile(manifestPath),
    mimeType: "application/json",
    name: "maya-generation-manifest.json",
    parentFolderId: pitchFolderId,
  });

  return {
    draftFileName,
    draftFilePath:
      draft.webViewLink ??
      `https://drive.google.com/file/d/${draft.id ?? ""}/view`,
    manifestPath: manifest.webViewLink,
  };
}

export async function findMayaDriveDraftForClient({
  clientName,
}: {
  clientName: string;
}) {
  const files = await listMayaDriveClientPitchFiles({
    clientName,
  });
  const draft = files
    .filter((file) => file.name?.includes("_vDraft.pptx"))
    .sort(compareGoogleDriveModifiedDesc)[0];

  return draft?.name
    ? {
        fileName: draft.name,
        filePath: draft.webViewLink,
      }
    : null;
}

export async function findMayaDriveFinalForClient({
  clientName,
}: {
  clientName: string;
}) {
  const files = await listMayaDriveClientPitchFiles({
    clientName,
  });
  const final = files
    .filter((file) => file.name && isNabilFinalPitchFileName(file.name))
    .sort(compareGoogleDriveModifiedDesc)[0];

  return final?.name
    ? {
        fileName: final.name,
        filePath: final.webViewLink,
      }
    : null;
}

async function listMayaDriveClientPitchFiles({
  clientName,
}: {
  clientName: string;
}) {
  const clientFolder = await ensureClientDriveFolder(clientName);
  const pitchFolderId = await findClientPitchFolderId(clientFolder.folderId);

  return (
    await listDriveFolderFiles(pitchFolderId, { maxResults: 1000 })
  ).filter((file) => file.mimeType !== GOOGLE_FOLDER_MIME_TYPE);
}

async function findClientPitchFolderId(clientFolderId: string) {
  const folders = await listDriveFolderFiles(clientFolderId, {
    maxResults: 1000,
  });
  const pitchFolder = folders.find(
    (file) =>
      file.mimeType === GOOGLE_FOLDER_MIME_TYPE &&
      file.name === PITCH_SUBFOLDER_NAME,
  );

  if (!pitchFolder?.id) {
    throw new Error(
      `Google Drive client folder is missing the ${PITCH_SUBFOLDER_NAME} subfolder.`,
    );
  }

  return pitchFolder.id;
}

function toMayaDriveDeckFile(file: DriveFileSummary): MayaDriveDeckFile {
  const fileName = file.name ?? "Untitled.pptx";

  return {
    driveFileId: file.id ?? "",
    fileName,
    filePath: `gdrive:${file.id ?? ""}`,
    kind: inferDriveDeckKind(fileName),
    modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(0),
    sizeBytes: Number(file.size ?? 0),
    webViewLink: file.webViewLink,
  };
}

function inferDriveDeckKind(fileName: string): MayaDeckKind {
  const normalized = fileName.toLocaleLowerCase("fr-FR");
  if (normalized.includes("generic")) return "generic";
  if (/_vf\.pptx$/i.test(fileName)) return "nabil_final";
  if (normalized.includes("vdraft")) return "maya_draft";
  return "example";
}

function compareGoogleDriveModifiedDesc(
  left: DriveFileSummary,
  right: DriveFileSummary,
) {
  return (
    new Date(right.modifiedTime ?? 0).getTime() -
    new Date(left.modifiedTime ?? 0).getTime()
  );
}

function isPptxDriveFile(file: DriveFileSummary) {
  return file.mimeType === PPTX_MIME_TYPE || /\.pptx$/i.test(file.name ?? "");
}
