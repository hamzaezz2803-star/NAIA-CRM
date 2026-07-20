import "server-only";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { indexMayaDeck } from "@/features/maya/pptx";
import {
  downloadDriveFile,
  ensureClientDriveFolder,
  ensureDriveChildFolder,
  isDriveServiceConfigured,
  listDriveFolderFiles,
  uploadDriveFile,
  type DriveFileSummary,
} from "@/platform/integrations/google-drive-service";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";
const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export type MeetingSupportContext = {
  fileId?: string;
  fileName?: string;
  fileUrl?: string;
  slideText?: string;
  warning?: string;
};

export type MeetingArchiveFile = {
  externalId?: string;
  kind:
    | "meeting-notes"
    | "structured-output"
    | "transcript-srt"
    | "transcript-text";
  mimeType: string;
  name: string;
  url?: string;
};

export async function loadMeetingSupportContext({
  companyName,
  preferredFileId,
  preferredFileName,
}: {
  companyName: string;
  preferredFileId?: string | null;
  preferredFileName?: string | null;
}): Promise<MeetingSupportContext> {
  if (!isDriveServiceConfigured()) {
    return { warning: "Le Drive privé Qarizmi n'est pas configuré." };
  }

  let file: DriveFileSummary | null = null;
  if (preferredFileId) {
    file = {
      id: preferredFileId,
      mimeType: inferMimeType(preferredFileName),
      name: preferredFileName || "Support meeting.pptx",
      webViewLink: `https://drive.google.com/file/d/${preferredFileId}/view`,
    };
  } else {
    const clientFolder = await ensureClientDriveFolder(companyName);
    const pitchFolderId = await findStandardSubfolder(
      clientFolder.folderId,
      "01_Pitch",
    );
    const files = await listDriveFolderFiles(pitchFolderId, {
      maxResults: 1000,
    });
    const presentations = files
      .filter(isPresentation)
      .sort(
        (left, right) =>
          new Date(right.modifiedTime ?? 0).getTime() -
          new Date(left.modifiedTime ?? 0).getTime(),
      );
    file =
      presentations.find((candidate) => /_vf\.pptx$/i.test(candidate.name)) ??
      presentations[0] ??
      null;
  }

  if (!file) {
    return { warning: `Aucun support pitch trouvé pour ${companyName}.` };
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "meeting-support-"));
  const localPath = path.join(tempRoot, safeFileName(file.name));

  try {
    await writeFile(
      localPath,
      Buffer.from(
        await downloadDriveFile(file.id, { mimeType: file.mimeType }),
      ),
    );
    const indexed = await indexMayaDeck(localPath);
    const slideText = indexed.slides
      .map(
        (slide) =>
          `[Slide ${slide.slideNumber}${slide.title ? ` - ${slide.title}` : ""}]\n${slide.text}`,
      )
      .join("\n\n")
      .slice(0, 150_000);

    return {
      fileId: file.id,
      fileName: file.name,
      fileUrl:
        file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
      slideText,
    };
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

export async function archiveMeetingOutput({
  companyName,
  meetingDate,
  meetingId,
  meetingTitle,
  notesMarkdown,
  outputVersion,
  structuredOutput,
  transcriptSrt,
  transcriptText,
}: {
  companyName: string;
  meetingDate?: string | null;
  meetingId: string;
  meetingTitle: string;
  notesMarkdown: string;
  outputVersion: number;
  structuredOutput: unknown;
  transcriptSrt: string;
  transcriptText: string;
}) {
  if (!isDriveServiceConfigured()) {
    throw new Error("Le Drive privé Qarizmi n'est pas configuré.");
  }

  const clientFolder = await ensureClientDriveFolder(companyName);
  const notesRootId = await findStandardSubfolder(
    clientFolder.folderId,
    "02_Meeting Notes",
  );
  const datePrefix = meetingDate
    ? new Date(meetingDate).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const meetingFolderName = `${datePrefix} - ${sanitizeFolderName(meetingTitle)} - ${meetingId.slice(0, 8)}`;
  const meetingFolderId = await ensureDriveChildFolder(
    notesRootId,
    meetingFolderName,
  );

  const baseName = `${datePrefix}_${sanitizeFileStem(companyName)}_meeting_v${outputVersion}`;
  const uploads: MeetingArchiveFile[] = [];
  const definitions = [
    {
      content: notesMarkdown,
      kind: "meeting-notes" as const,
      mimeType: "text/markdown",
      name: `${baseName}_notes.md`,
    },
    {
      content: transcriptText,
      kind: "transcript-text" as const,
      mimeType: "text/plain",
      name: `${baseName}_transcript.txt`,
    },
    {
      content: transcriptSrt,
      kind: "transcript-srt" as const,
      mimeType: "application/x-subrip",
      name: `${baseName}_transcript.srt`,
    },
    {
      content: JSON.stringify(structuredOutput, null, 2),
      kind: "structured-output" as const,
      mimeType: "application/json",
      name: `${baseName}_analysis.json`,
    },
  ];

  const existingFiles = await listDriveFolderFiles(meetingFolderId, {
    maxResults: 1000,
  });

  for (const definition of definitions) {
    const existing = existingFiles.find(
      (candidate) => candidate.name === definition.name,
    );
    if (existing?.id) {
      uploads.push({
        externalId: existing.id,
        kind: definition.kind,
        mimeType: definition.mimeType,
        name: definition.name,
        url:
          existing.webViewLink ??
          `https://drive.google.com/file/d/${existing.id}/view`,
      });
      continue;
    }

    const uploaded = await uploadDriveFile({
      content: Buffer.from(definition.content, "utf8"),
      mimeType: definition.mimeType,
      name: definition.name,
      parentFolderId: meetingFolderId,
    });
    uploads.push({
      externalId: uploaded.id,
      kind: definition.kind,
      mimeType: definition.mimeType,
      name: definition.name,
      url:
        uploaded.webViewLink ??
        (uploaded.id
          ? `https://drive.google.com/file/d/${uploaded.id}/view`
          : undefined),
    });
  }

  return {
    files: uploads,
    folderId: meetingFolderId,
    folderUrl: `https://drive.google.com/drive/folders/${meetingFolderId}`,
  };
}

async function findStandardSubfolder(parentFolderId: string, name: string) {
  const files = await listDriveFolderFiles(parentFolderId, {
    maxResults: 1000,
  });
  const folder = files.find(
    (file) => file.mimeType === FOLDER_MIME_TYPE && file.name === name,
  );
  if (!folder?.id) {
    return ensureDriveChildFolder(parentFolderId, name);
  }
  return folder.id;
}

function isPresentation(file: DriveFileSummary) {
  return (
    file.mimeType === PPTX_MIME_TYPE ||
    file.mimeType === SLIDES_MIME_TYPE ||
    /\.pptx$/i.test(file.name)
  );
}

function inferMimeType(fileName?: string | null) {
  return fileName && /\.pptx$/i.test(fileName) ? PPTX_MIME_TYPE : undefined;
}

function safeFileName(name: string) {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "-");
  return /\.pptx$/i.test(cleaned) ? cleaned : `${cleaned}.pptx`;
}

function sanitizeFolderName(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .slice(0, 120) || "Meeting"
  );
}

function sanitizeFileStem(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "client"
  );
}
