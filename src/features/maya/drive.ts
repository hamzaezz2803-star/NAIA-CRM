import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getDriveFileMetadata,
  isDriveServiceConfigured,
  listDriveFolderFiles,
  downloadDriveFile,
  uploadDriveFile,
  type DriveFileSummary,
} from "@/platform/integrations/google-drive-service";

import type {
  MayaDeckFile,
  MayaDeckKind,
  MayaTemplateFamily,
} from "./contracts";
import { isNabilFinalPitchFileName } from "./storage";
import {
  classifyMayaTemplateFamily,
  selectLatestMayaTemplateCandidate,
} from "./template";

const PITCH_SUBFOLDER_NAME = "01_Pitch";
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";
const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ALLOWED_DRIVE_FOLDER_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
]);

export type MayaDriveConfig = {
  outputFolderId: string;
  sourceFolderId: string;
};

export type MayaDriveDeckFile = MayaDeckFile & {
  driveFileId: string;
  mimeType?: string;
  webViewLink?: string;
};

export type MayaDriveUploadResult = {
  draftFileName: string;
  draftFilePath: string;
};

export type MayaDriveDestination = {
  clientFolderId: string;
  clientFolderName: string;
  files: DriveFileSummary[];
  pitchFolderId: string;
  pitchFolderUrl: string;
};

export function hasMayaDriveFolderConfig(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    env.MAYA_DRIVE_SOURCE_FOLDER_ID?.trim() &&
    env.MAYA_DRIVE_OUTPUT_FOLDER_ID?.trim() &&
    isDriveServiceConfigured(),
  );
}

export function hasMayaClientDriveConfig(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    env.MAYA_DRIVE_OUTPUT_FOLDER_ID?.trim() && isDriveServiceConfigured(),
  );
}

export function getMayaClientsRootFolderId(
  env: NodeJS.ProcessEnv = process.env,
) {
  const outputFolderId = env.MAYA_DRIVE_OUTPUT_FOLDER_ID?.trim();
  if (!outputFolderId) {
    throw new Error("MAYA_DRIVE_OUTPUT_FOLDER_ID is required for Maya writes.");
  }
  return outputFolderId;
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

export function getMayaApprovedTemplateFileId(
  family: MayaTemplateFamily,
  env: NodeJS.ProcessEnv = process.env,
) {
  return (
    (family === "pitch"
      ? env.MAYA_PITCH_TEMPLATE_FILE_ID
      : env.MAYA_COMMERCIAL_PROPOSAL_TEMPLATE_FILE_ID
    )?.trim() || null
  );
}

export async function getMayaDriveTemplateFile({
  env = process.env,
  family,
}: {
  env?: NodeJS.ProcessEnv;
  family: MayaTemplateFamily;
}) {
  const approvedDriveFileId = getMayaApprovedTemplateFileId(family, env);
  if (!approvedDriveFileId) {
    throw new Error(
      family === "pitch"
        ? "MAYA_PITCH_TEMPLATE_FILE_ID is not configured."
        : "MAYA_COMMERCIAL_PROPOSAL_TEMPLATE_FILE_ID is not configured.",
    );
  }

  const metadata = await getDriveFileMetadata(approvedDriveFileId);
  if (metadata.id !== approvedDriveFileId) {
    throw new Error("Google Drive returned metadata for an unexpected file.");
  }
  if (metadata.mimeType !== PPTX_MIME_TYPE) {
    throw new Error(
      "Le modèle approuvé doit être un fichier .pptx natif pour garantir une copie byte-for-byte.",
    );
  }
  if (
    !metadata.modifiedTime ||
    Number.isNaN(new Date(metadata.modifiedTime).getTime())
  ) {
    throw new Error(
      "Google Drive n'a pas fourni la date de modification du modèle approuvé.",
    );
  }

  const candidate = toMayaDriveDeckFile(metadata);
  const selected = selectLatestMayaTemplateCandidate({
    approvedDriveFileId,
    candidates: [candidate],
    family,
  });
  if (!selected || classifyMayaTemplateFamily(selected.fileName) !== family) {
    throw new Error(
      `Le fichier Drive approuvé ne correspond pas à la famille ${family}.`,
    );
  }

  return {
    ...selected,
    driveFileId: approvedDriveFileId,
  } satisfies MayaDriveDeckFile;
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
    Buffer.from(
      await downloadDriveFile(file.driveFileId, { mimeType: file.mimeType }),
    ),
  );

  return {
    ...file,
    filePath,
  } satisfies MayaDriveDeckFile;
}

export async function uploadMayaDriveDraft({
  draftFileName,
  draftFilePath,
  pitchFolderId,
}: {
  draftFileName: string;
  draftFilePath: string;
  pitchFolderId: string;
}): Promise<MayaDriveUploadResult> {
  const draft = await uploadDriveFile({
    content: await readFile(draftFilePath),
    mimeType: PPTX_MIME_TYPE,
    name: draftFileName,
    parentFolderId: pitchFolderId,
  });

  return {
    draftFileName,
    draftFilePath:
      draft.webViewLink ??
      `https://drive.google.com/file/d/${draft.id ?? ""}/view`,
  };
}

export async function inspectMayaDriveDestination({
  clientFolderUrl,
  expectedRootFolderId,
}: {
  clientFolderUrl: string;
  expectedRootFolderId: string;
}): Promise<MayaDriveDestination> {
  const clientFolderId = parseMayaDriveFolderId(clientFolderUrl);
  const clientFolder = await getDriveFileMetadata(clientFolderId);
  if (clientFolder.mimeType !== GOOGLE_FOLDER_MIME_TYPE) {
    throw new Error("L'URL CRM ne pointe pas vers un dossier Google Drive.");
  }
  if (!clientFolder.parents?.includes(expectedRootFolderId)) {
    throw new Error(
      "Le dossier CRM est hors du root Clients autorisé ; aucune écriture n'est permise.",
    );
  }

  const children = await listDriveFolderFiles(clientFolderId, {
    maxResults: 1000,
  });
  const pitchFolders = children.filter(
    (file) =>
      file.mimeType === GOOGLE_FOLDER_MIME_TYPE &&
      file.name === PITCH_SUBFOLDER_NAME &&
      Boolean(file.id),
  );
  if (pitchFolders.length === 0) {
    throw new Error(
      `Le dossier CRM ne contient pas ${PITCH_SUBFOLDER_NAME}; aucune création automatique n'est autorisée.`,
    );
  }
  if (pitchFolders.length > 1) {
    throw new Error(
      `Le dossier CRM contient plusieurs sous-dossiers ${PITCH_SUBFOLDER_NAME}; la destination est ambiguë.`,
    );
  }

  const pitchFolderId = pitchFolders[0]!.id;
  const files = (
    await listDriveFolderFiles(pitchFolderId, { maxResults: 1000 })
  ).filter((file) => file.mimeType !== GOOGLE_FOLDER_MIME_TYPE);

  return {
    clientFolderId,
    clientFolderName: clientFolder.name,
    files,
    pitchFolderId,
    pitchFolderUrl: `https://drive.google.com/drive/folders/${pitchFolderId}`,
  };
}

export async function findMayaDriveArtifacts({
  clientFolderUrl,
  expectedRootFolderId,
}: {
  clientFolderUrl: string;
  expectedRootFolderId: string;
}) {
  const destination = await inspectMayaDriveDestination({
    clientFolderUrl,
    expectedRootFolderId,
  });
  const draft = destination.files
    .filter((file) => file.name?.includes("_vDraft.pptx"))
    .sort(compareGoogleDriveModifiedDesc)[0];
  const final = destination.files
    .filter((file) => file.name && isNabilFinalPitchFileName(file.name))
    .sort(compareGoogleDriveModifiedDesc)[0];

  return {
    destination,
    draft: toMayaDriveArtifact(draft),
    final: toMayaDriveArtifact(final),
  };
}

export function parseMayaDriveFolderId(folderUrl: string) {
  let url: URL;
  try {
    url = new URL(folderUrl);
  } catch {
    throw new Error(
      "L'URL de dossier Drive enregistrée dans le CRM est invalide.",
    );
  }

  if (!ALLOWED_DRIVE_FOLDER_HOSTS.has(url.hostname)) {
    throw new Error(
      "L'URL CRM n'utilise pas un domaine Google Drive autorisé.",
    );
  }

  const folderId = url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1];
  if (!folderId) {
    throw new Error(
      "L'URL CRM ne contient pas d'identifiant de dossier Drive.",
    );
  }

  return folderId;
}

function toMayaDriveArtifact(file: DriveFileSummary | undefined) {
  return file?.name
    ? {
        fileName: file.name,
        filePath:
          file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
      }
    : null;
}

function toMayaDriveDeckFile(file: DriveFileSummary): MayaDriveDeckFile {
  // Native Google Slides decks are exported to pptx on download, so their
  // local file name keeps the .pptx extension.
  const rawFileName = file.name ?? "Untitled.pptx";
  const fileName =
    file.mimeType === GOOGLE_SLIDES_MIME_TYPE && !/\.pptx$/i.test(rawFileName)
      ? `${rawFileName}.pptx`
      : rawFileName;

  return {
    driveFileId: file.id ?? "",
    fileName,
    filePath: `gdrive:${file.id ?? ""}`,
    kind: inferDriveDeckKind(fileName),
    mimeType: file.mimeType,
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
  return (
    file.mimeType === PPTX_MIME_TYPE ||
    file.mimeType === GOOGLE_SLIDES_MIME_TYPE ||
    /\.pptx$/i.test(file.name ?? "")
  );
}
