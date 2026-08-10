import "server-only";

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { indexMayaDeck } from "@/features/maya/pptx";
import {
  downloadDriveFile,
  ensureClientDriveFolder,
  ensureDriveChildFolder,
  generateDriveFileId,
  getDriveFileMetadata,
  isDriveServiceConfigured,
  listDriveFolderFiles,
  listDriveFolderFilesByName,
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
  parentFolderId: string;
  sha256: string;
  sizeBytes: number;
  url?: string;
};

export type MeetingArchiveMutationAuthorizer = () => Promise<void>;

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
  authorizeMutation,
  companyName,
  meetingDate,
  meetingId,
  meetingTitle,
  notesMarkdown,
  outputVersion,
  reviewedNotes,
  structuredOutput,
  transcriptSrt,
  transcriptText,
}: {
  authorizeMutation: MeetingArchiveMutationAuthorizer;
  companyName: string;
  meetingDate?: string | null;
  meetingId: string;
  meetingTitle: string;
  notesMarkdown: string;
  outputVersion: number;
  reviewedNotes?: {
    notesMarkdown: string;
    reviewRevision: number;
  };
  structuredOutput: unknown;
  transcriptSrt: string;
  transcriptText: string;
}) {
  if (!isDriveServiceConfigured()) {
    throw new Error("Le Drive privé Qarizmi n'est pas configuré.");
  }

  const clientFolder = await ensureClientDriveFolder(companyName, {
    beforeMutation: authorizeMutation,
  });
  const notesRootId = await findStandardSubfolder(
    clientFolder.folderId,
    "02_Meeting Notes",
    authorizeMutation,
  );
  const datePrefix = meetingDate
    ? new Date(meetingDate).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const meetingFolderName = `${datePrefix} - ${sanitizeFolderName(meetingTitle)} - ${meetingId.slice(0, 8)}`;
  const meetingFolderId = await ensureDriveChildFolder(
    notesRootId,
    meetingFolderName,
    { beforeMutation: authorizeMutation },
  );

  const baseName = `${datePrefix}_${sanitizeFileStem(companyName)}_meeting_v${outputVersion}`;
  const uploads: MeetingArchiveFile[] = [];
  const definitions: Array<{
    content: string;
    kind: MeetingArchiveFile["kind"];
    mimeType: string;
    name: string;
  }> = [
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
  if (reviewedNotes) {
    definitions.push({
      content: reviewedNotes.notesMarkdown,
      kind: "meeting-notes",
      mimeType: "text/markdown",
      name: `meeting_notes_v${outputVersion}_review_r${reviewedNotes.reviewRevision}.md`,
    });
  }

  for (const definition of definitions) {
    const content = Buffer.from(definition.content, "utf8");
    const expectedSha256 = sha256(content);
    const exactMatches = await listDriveFolderFilesByName(
      meetingFolderId,
      definition.name,
      { maxResults: 2 },
    );
    if (exactMatches.length > 1) {
      throw new Error(
        `Plusieurs fichiers Drive portent le nom exact ${definition.name}; la reprise est ambiguë.`,
      );
    }
    const existing = exactMatches[0];
    if (existing?.id) {
      const verified = await verifyMeetingArchiveFile({
        expectedContent: content,
        expectedFileName: definition.name,
        expectedMimeType: definition.mimeType,
        expectedParentFolderId: meetingFolderId,
        expectedSha256,
        fileId: existing.id,
      });
      uploads.push({
        externalId: verified.id,
        kind: definition.kind,
        mimeType: definition.mimeType,
        name: definition.name,
        parentFolderId: meetingFolderId,
        sha256: expectedSha256,
        sizeBytes: content.byteLength,
        url:
          verified.webViewLink ??
          `https://drive.google.com/file/d/${verified.id}/view`,
      });
      continue;
    }

    await authorizeMutation();
    const reservedFileId = await generateDriveFileId();
    await authorizeMutation();
    const uploaded = await uploadDriveFile({
      content,
      fileId: reservedFileId,
      mimeType: definition.mimeType,
      name: definition.name,
      parentFolderId: meetingFolderId,
    });
    const verified = await verifyMeetingArchiveFile({
      expectedContent: content,
      expectedFileName: definition.name,
      expectedMimeType: definition.mimeType,
      expectedParentFolderId: meetingFolderId,
      expectedSha256,
      fileId: uploaded.id,
    });
    uploads.push({
      externalId: verified.id,
      kind: definition.kind,
      mimeType: definition.mimeType,
      name: definition.name,
      parentFolderId: meetingFolderId,
      sha256: expectedSha256,
      sizeBytes: content.byteLength,
      url:
        verified.webViewLink ??
        (verified.id
          ? `https://drive.google.com/file/d/${verified.id}/view`
          : undefined),
    });
  }

  return {
    files: uploads,
    folderId: meetingFolderId,
    folderUrl: `https://drive.google.com/drive/folders/${meetingFolderId}`,
  };
}

async function findStandardSubfolder(
  parentFolderId: string,
  name: string,
  authorizeMutation?: MeetingArchiveMutationAuthorizer,
) {
  const files = await listDriveFolderFiles(parentFolderId, {
    maxResults: 1000,
  });
  const folder = files.find(
    (file) => file.mimeType === FOLDER_MIME_TYPE && file.name === name,
  );
  if (!folder?.id) {
    return ensureDriveChildFolder(parentFolderId, name, {
      beforeMutation: authorizeMutation,
    });
  }
  return folder.id;
}

async function verifyMeetingArchiveFile({
  expectedContent,
  expectedFileName,
  expectedMimeType,
  expectedParentFolderId,
  expectedSha256,
  fileId,
}: {
  expectedContent: Buffer;
  expectedFileName: string;
  expectedMimeType: string;
  expectedParentFolderId: string;
  expectedSha256: string;
  fileId: string;
}) {
  const metadata = await getDriveFileMetadata(fileId);
  if (
    metadata.id !== fileId ||
    metadata.name !== expectedFileName ||
    metadata.mimeType !== expectedMimeType ||
    metadata.trashed ||
    !metadata.parents?.includes(expectedParentFolderId)
  ) {
    throw new Error(
      `Le fichier Drive ${expectedFileName} ne correspond pas à la destination attendue.`,
    );
  }
  if (
    metadata.size &&
    Number.isSafeInteger(Number(metadata.size)) &&
    Number(metadata.size) !== expectedContent.byteLength
  ) {
    throw new Error(
      `Le fichier Drive ${expectedFileName} existe avec un contenu différent.`,
    );
  }
  const downloaded = Buffer.from(
    await downloadDriveFile(fileId, { mimeType: expectedMimeType }),
  );
  if (
    downloaded.byteLength !== expectedContent.byteLength ||
    sha256(downloaded) !== expectedSha256 ||
    !downloaded.equals(expectedContent)
  ) {
    throw new Error(
      `Le fichier Drive ${expectedFileName} existe avec un contenu différent.`,
    );
  }
  return metadata;
}

function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
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
