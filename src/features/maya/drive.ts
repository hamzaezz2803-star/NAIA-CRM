import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getGoogleWorkspaceAccessToken } from "@/platform/integrations/google-workspace";

import type { MayaDeckFile, MayaDeckKind } from "./contracts";
import { isNabilFinalPitchFileName, sanitizeMayaClientName } from "./storage";

export const MAYA_DRIVE_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
] as const;

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

type GoogleDriveFile = {
  id?: string;
  modifiedTime?: string;
  name?: string;
  size?: string;
  webViewLink?: string;
};

export function hasMayaDriveFolderConfig(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    env.MAYA_DRIVE_SOURCE_FOLDER_ID?.trim() &&
    env.MAYA_DRIVE_OUTPUT_FOLDER_ID?.trim(),
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
  const accessToken = await getMayaDriveAccessToken();
  const files = await listGoogleDriveFiles({
    accessToken,
    folderId: sourceFolderId,
    query:
      "mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' or name contains '.pptx'",
  });

  return files
    .map(toMayaDriveDeckFile)
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export async function downloadMayaDriveDeckToTemp(file: MayaDriveDeckFile) {
  const accessToken = await getMayaDriveAccessToken();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maya-drive-deck-"));
  const filePath = path.join(tempRoot, file.fileName);
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.driveFileId)}`,
  );

  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await googleDriveError("download file", response));
  }

  await writeFile(filePath, Buffer.from(await response.arrayBuffer()));

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
  outputFolderId,
}: {
  clientName: string;
  draftFileName: string;
  draftFilePath: string;
  manifestPath: string;
  outputFolderId: string;
}): Promise<MayaDriveUploadResult> {
  const accessToken = await getMayaDriveAccessToken();
  const pitchFolderId = await ensureMayaDriveClientPitchFolder({
    accessToken,
    clientName,
    outputFolderId,
  });
  const draft = await uploadGoogleDriveFile({
    accessToken,
    content: await readFile(draftFilePath),
    fileName: draftFileName,
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    parentFolderId: pitchFolderId,
  });
  const manifest = await uploadGoogleDriveFile({
    accessToken,
    content: await readFile(manifestPath),
    fileName: "maya-generation-manifest.json",
    mimeType: "application/json",
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
  outputFolderId,
}: {
  clientName: string;
  outputFolderId: string;
}) {
  const files = await listMayaDriveClientPitchFiles({
    clientName,
    outputFolderId,
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
  outputFolderId,
}: {
  clientName: string;
  outputFolderId: string;
}) {
  const files = await listMayaDriveClientPitchFiles({
    clientName,
    outputFolderId,
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
  outputFolderId,
}: {
  clientName: string;
  outputFolderId: string;
}) {
  const accessToken = await getMayaDriveAccessToken();
  const clientFolder = await findGoogleDriveFolder({
    accessToken,
    name: sanitizeMayaClientName(clientName),
    parentFolderId: outputFolderId,
  });

  if (!clientFolder?.id) return [];

  const pitchFolder = await findGoogleDriveFolder({
    accessToken,
    name: "Pitch",
    parentFolderId: clientFolder.id,
  });

  if (!pitchFolder?.id) return [];

  return listGoogleDriveFiles({
    accessToken,
    folderId: pitchFolder.id,
    query: "mimeType != 'application/vnd.google-apps.folder'",
  });
}

async function ensureMayaDriveClientPitchFolder({
  accessToken,
  clientName,
  outputFolderId,
}: {
  accessToken: string;
  clientName: string;
  outputFolderId: string;
}) {
  const clientFolderName = sanitizeMayaClientName(clientName);
  const clientFolder =
    (await findGoogleDriveFolder({
      accessToken,
      name: clientFolderName,
      parentFolderId: outputFolderId,
    })) ??
    (await createGoogleDriveFolder({
      accessToken,
      name: clientFolderName,
      parentFolderId: outputFolderId,
    }));
  if (!clientFolder.id) {
    throw new Error("Google Drive did not return a client folder id.");
  }

  const pitchFolder =
    (await findGoogleDriveFolder({
      accessToken,
      name: "Pitch",
      parentFolderId: clientFolder.id,
    })) ??
    (await createGoogleDriveFolder({
      accessToken,
      name: "Pitch",
      parentFolderId: clientFolder.id,
    }));
  if (!pitchFolder.id) {
    throw new Error("Google Drive did not return a pitch folder id.");
  }

  return pitchFolder.id;
}

async function getMayaDriveAccessToken() {
  return getGoogleWorkspaceAccessToken({
    requiredScopes: [...MAYA_DRIVE_REQUIRED_SCOPES],
  });
}

async function listGoogleDriveFiles({
  accessToken,
  folderId,
  query,
}: {
  accessToken: string;
  folderId: string;
  query: string;
}) {
  const files: GoogleDriveFile[] = [];
  let pageToken = "";

  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    const q = [
      `'${escapeDriveQueryValue(folderId)}' in parents`,
      "trashed = false",
    ];

    if (query) q.push(`(${query})`);

    url.searchParams.set("q", q.join(" and "));
    url.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,modifiedTime,size,webViewLink)",
    );
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(await googleDriveError("list files", response));
    }

    const payload = (await response.json()) as {
      files?: GoogleDriveFile[];
      nextPageToken?: string;
    };

    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);

  return files;
}

async function findGoogleDriveFolder({
  accessToken,
  name,
  parentFolderId,
}: {
  accessToken: string;
  name: string;
  parentFolderId: string;
}) {
  const files = await listGoogleDriveFiles({
    accessToken,
    folderId: parentFolderId,
    query: `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQueryValue(name)}'`,
  });

  return files[0]?.id ? files[0] : null;
}

async function createGoogleDriveFolder({
  accessToken,
  name,
  parentFolderId,
}: {
  accessToken: string;
  name: string;
  parentFolderId: string;
}) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");

  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,webViewLink");

  const response = await fetch(url, {
    body: JSON.stringify({
      mimeType: "application/vnd.google-apps.folder",
      name,
      parents: [parentFolderId],
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await googleDriveError("create folder", response));
  }

  return (await response.json()) as Required<Pick<GoogleDriveFile, "id">> &
    GoogleDriveFile;
}

async function uploadGoogleDriveFile({
  accessToken,
  content,
  fileName,
  mimeType,
  parentFolderId,
}: {
  accessToken: string;
  content: Buffer;
  fileName: string;
  mimeType: string;
  parentFolderId: string;
}) {
  const boundary = `maya_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = {
    mimeType,
    name: fileName,
    parents: [parentFolderId],
  };
  const body = Buffer.concat([
    Buffer.from(
      [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${mimeType}`,
        "",
      ].join("\r\n"),
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");

  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,webViewLink");

  const response = await fetch(url, {
    body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await googleDriveError("upload file", response));
  }

  return (await response.json()) as GoogleDriveFile;
}

function toMayaDriveDeckFile(file: GoogleDriveFile): MayaDriveDeckFile {
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
  left: GoogleDriveFile,
  right: GoogleDriveFile,
) {
  return (
    new Date(right.modifiedTime ?? 0).getTime() -
    new Date(left.modifiedTime ?? 0).getTime()
  );
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function googleDriveError(action: string, response: Response) {
  return `Google Drive ${action} failed (${response.status}): ${(await response.text()).slice(0, 500)}`;
}
