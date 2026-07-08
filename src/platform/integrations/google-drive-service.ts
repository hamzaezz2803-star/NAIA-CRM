import "server-only";

import { Buffer } from "node:buffer";
import { createSign } from "node:crypto";

// Organization-level Google Drive access through a service account that is a
// member of the cofounders-only shared drive. Personal Calendar/Gmail access
// stays on per-user OAuth tokens (google-workspace.ts); everything that
// touches the client-IP shared drive goes through here so that Google
// enforces the cofounder boundary regardless of which app user triggers the
// action.

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

// Subfolder layout created inside each client folder, as defined by the CRM.
export const CLIENT_DRIVE_SUBFOLDERS = [
  "01_Pitch",
  "02_Meeting Notes",
  "03_Proposal",
  "04_Contract",
  "05_Delivery",
] as const;

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
};

export type DriveFileSummary = {
  id: string;
  mimeType?: string;
  modifiedTime?: string;
  name: string;
  size?: string;
  webViewLink?: string;
};

export type ClientDriveFolder = {
  created: boolean;
  folderId: string;
  folderUrl: string;
};

// Google-native files reject alt=media downloads: they must be exported to an
// Office equivalent instead (Slides -> pptx, Docs -> docx).
const GOOGLE_NATIVE_EXPORT_MIME_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.google-apps.presentation":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

// Collapses concurrent ensureClientDriveFolder calls for the same client
// (e.g. two leads created back-to-back) into one find-or-create.
const inFlightClientFolders = new Map<string, Promise<ClientDriveFolder>>();

export function isDriveServiceConfigured() {
  return Boolean(parseServiceAccountKey() && getClientsRootFolderId());
}

/** Cofounders-drive "clients" folder: client folders and Maya outputs land here. */
export function getClientsRootFolderId() {
  return process.env.MAYA_DRIVE_OUTPUT_FOLDER_ID?.trim() || null;
}

/** Cofounders-drive pitch library folder: templates and best decks Maya reads. */
export function getPitchSourceFolderId() {
  return process.env.MAYA_DRIVE_SOURCE_FOLDER_ID?.trim() || null;
}

export function getDriveFolderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * Finds or creates the per-client folder (named after the client company)
 * under the clients root, along with the standard CRM subfolders when the
 * folder is new.
 */
export async function ensureClientDriveFolder(
  clientName: string,
): Promise<ClientDriveFolder> {
  const rootFolderId = getClientsRootFolderId();
  if (!rootFolderId) {
    throw new Error("MAYA_DRIVE_OUTPUT_FOLDER_ID is not configured.");
  }

  const normalizedName = clientName.trim();
  if (!normalizedName) {
    throw new Error("Client name is required to create a Drive folder.");
  }

  const inFlight = inFlightClientFolders.get(normalizedName);
  if (inFlight) return inFlight;

  const task = (async () => {
    const existing = await findChildFolderByName(rootFolderId, normalizedName);
    const folderId =
      existing ?? (await createDriveFolder(rootFolderId, normalizedName));

    // Idempotent: also repairs client folders whose subfolders were never
    // fully created (partial earlier run, or folder created by hand).
    for (const subfolderName of CLIENT_DRIVE_SUBFOLDERS) {
      if (!(await findChildFolderByName(folderId, subfolderName))) {
        await createDriveFolder(folderId, subfolderName);
      }
    }

    return {
      created: !existing,
      folderId,
      folderUrl: getDriveFolderUrl(folderId),
    };
  })();

  inFlightClientFolders.set(normalizedName, task);
  try {
    return await task;
  } finally {
    inFlightClientFolders.delete(normalizedName);
  }
}

/** Lists files (non-recursive) in a shared-drive folder. Used by Maya to index the pitch library. */
export async function listDriveFolderFiles(
  folderId: string,
  { maxResults = 100 }: { maxResults?: number } = {},
): Promise<DriveFileSummary[]> {
  const url = new URL(DRIVE_FILES_URL);
  url.searchParams.set(
    "q",
    `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`,
  );
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,modifiedTime,size,webViewLink)",
  );
  url.searchParams.set("pageSize", String(Math.min(maxResults, 1000)));
  url.searchParams.set("orderBy", "name");

  const payload = (await driveRequest(url)) as {
    files?: DriveFileSummary[];
  };

  return (payload.files ?? []).filter((file) => Boolean(file.id));
}

/**
 * Downloads a Drive file's binary content. Google-native files are exported
 * to their Office equivalent (Slides -> pptx, Docs -> docx, capped at 10 MB
 * by the Drive API); anything else is downloaded as-is with alt=media.
 */
export async function downloadDriveFile(fileId: string): Promise<ArrayBuffer> {
  const exportMimeType = await findDriveExportMimeType(fileId);
  const url = exportMimeType
    ? new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export`)
    : new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`);
  if (exportMimeType) {
    url.searchParams.set("mimeType", exportMimeType);
  } else {
    url.searchParams.set("alt", "media");
  }
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: await driveAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(await driveDownloadError(response));
  }

  return response.arrayBuffer();
}

/** Export mime type for Google-native files, null when alt=media applies. */
async function findDriveExportMimeType(fileId: string) {
  const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "mimeType");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: await driveAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(await driveError(response));
  }

  const metadata = (await response.json()) as { mimeType?: string };

  return GOOGLE_NATIVE_EXPORT_MIME_TYPES[metadata.mimeType ?? ""] ?? null;
}

/** Maps download failures to actionable messages instead of raw API errors. */
async function driveDownloadError(response: Response) {
  const text = await response.text();

  if (text.includes("exportSizeLimitExceeded")) {
    return "L'export Google Drive est plafonné à 10 Mo et ce fichier dépasse la limite : stocke le deck en .pptx natif dans la bibliothèque pitch plutôt qu'en Google Slides.";
  }

  if (
    text.includes("cannotDownloadFile") ||
    text.includes("fileNotDownloadable")
  ) {
    return "Le service account ne peut pas télécharger ce fichier : passe-le en Éditeur sur le dossier, ou désactive la restriction de téléchargement pour les lecteurs du Drive partagé, ou stocke le deck en .pptx natif.";
  }

  return `Google Drive service request failed (${response.status}): ${text.slice(0, 500)}`;
}

/** Uploads a file into a shared-drive folder. Used by Maya to store generated decks. */
export async function uploadDriveFile({
  content,
  mimeType,
  name,
  parentFolderId,
}: {
  content: ArrayBuffer | Buffer;
  mimeType: string;
  name: string;
  parentFolderId: string;
}): Promise<DriveFileSummary> {
  const metadata = {
    mimeType,
    name,
    parents: [parentFolderId],
  };
  const boundary = `naia-drive-${crypto.randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const response = await fetch(
    `${DRIVE_UPLOAD_URL}&fields=id,name,mimeType,webViewLink`,
    {
      body,
      headers: {
        ...(await driveAuthHeaders()),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(await driveError(response));
  }

  return (await response.json()) as DriveFileSummary;
}

async function findChildFolderByName(parentFolderId: string, name: string) {
  const url = new URL(DRIVE_FILES_URL);
  url.searchParams.set(
    "q",
    [
      `'${escapeDriveQueryValue(parentFolderId)}' in parents`,
      `name = '${escapeDriveQueryValue(name)}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
    ].join(" and "),
  );
  url.searchParams.set("fields", "files(id)");
  // Concurrent creators converge on the earliest-created duplicate.
  url.searchParams.set("orderBy", "createdTime");
  url.searchParams.set("pageSize", "1");

  const payload = (await driveRequest(url)) as {
    files?: Array<{ id?: string }>;
  };

  return payload.files?.[0]?.id ?? null;
}

async function createDriveFolder(parentFolderId: string, name: string) {
  const url = new URL(DRIVE_FILES_URL);
  url.searchParams.set("fields", "id");

  const payload = (await driveRequest(url, {
    body: JSON.stringify({
      mimeType: "application/vnd.google-apps.folder",
      name,
      parents: [parentFolderId],
    }),
    method: "POST",
  })) as { id?: string };

  if (!payload.id) {
    throw new Error("Google Drive did not return a folder id.");
  }

  return payload.id;
}

async function driveRequest(url: URL, init: RequestInit = {}) {
  url.searchParams.set("supportsAllDrives", "true");
  if (init.method === undefined || init.method === "GET") {
    url.searchParams.set("includeItemsFromAllDrives", "true");
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      ...(await driveAuthHeaders()),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await driveError(response));
  }

  return response.json();
}

async function driveAuthHeaders() {
  return { Authorization: `Bearer ${await getServiceAccountAccessToken()}` };
}

async function getServiceAccountAccessToken() {
  if (
    cachedToken &&
    cachedToken.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS
  ) {
    return cachedToken.accessToken;
  }

  const key = parseServiceAccountKey();
  if (!key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not configured.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      aud: TOKEN_URL,
      exp: issuedAt + 3600,
      iat: issuedAt,
      iss: key.client_email,
      scope: DRIVE_SCOPE,
    },
    key.private_key,
  );

  const response = await fetch(TOKEN_URL, {
    body: new URLSearchParams({
      assertion,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await driveError(response));
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error("Google OAuth did not return a service account token.");
  }

  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };

  return cachedToken.accessToken;
}

function signJwt(
  header: Record<string, string>,
  claims: Record<string, string | number>,
  privateKey: string,
) {
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(privateKey);

  return `${unsigned}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value: string | Buffer) {
  return (Buffer.isBuffer(value) ? value : Buffer.from(value)).toString(
    "base64url",
  );
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function parseServiceAccountKey(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) return null;

  const json = raw.startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");

  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccountKey>;
    if (!parsed.client_email || !parsed.private_key) return null;

    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  } catch {
    return null;
  }
}

async function driveError(response: Response) {
  const text = await response.text();
  return `Google Drive service request failed (${response.status}): ${text.slice(0, 500)}`;
}
