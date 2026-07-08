import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLIENT_DRIVE_SUBFOLDERS,
  downloadDriveFile,
  ensureClientDriveFolder,
  getClientsRootFolderId,
  getPitchSourceFolderId,
  isDriveServiceConfigured,
} from "./google-drive-service";

// Valid unused 512-bit RSA test key: real signing without a real credential.
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEAva1mB5jArz/CvIVw
KTKcIH2cRTn4xEfqvhU9vNNr5DBQC1y0BALYYbeCbjY1qBLautzArqXCsB6IWpP7
S3B0YQIDAQABAkA0FVYRK/wCzVr9SEWLKHFHmGIv2yCgh8k7yhkNXqrmz5UPnHIC
YU8QGGoK/EQwlWnJmc3tqCcqcw+jjNlVYJUBAiEA344g6PMsHtQzHXLidHV46NA6
26nDXTL5XBBAQ2yjqIECIQDZQOEP1BUM/cCoW+GTIUKQNo7YbQ+3+FZ1tTA1BLdd
4QIgV1cQZfCyeaK7ORb3IVBGVpqLd7DXKFwyKPPUvSvZuwECIQCyaSHnDMEDU9yr
S8y3JXXYQIfBqPCTfZ64u1nvhWXPYQIgcDN9cLDcNBjstinAmNo6/aA1qkjXPjjq
IB50BR2Sw6c=
-----END PRIVATE KEY-----`;

const SERVICE_ACCOUNT_KEY = JSON.stringify({
  client_email: "naia-drive@qarizmi-os.iam.gserviceaccount.com",
  private_key: TEST_PRIVATE_KEY,
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("google-drive-service", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", SERVICE_ACCOUNT_KEY);
    vi.stubEnv("MAYA_DRIVE_OUTPUT_FOLDER_ID", "clients-folder-id");
    vi.stubEnv("MAYA_DRIVE_SOURCE_FOLDER_ID", "pitch-library-id");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the Maya folder ids from the environment", () => {
    expect(getClientsRootFolderId()).toBe("clients-folder-id");
    expect(getPitchSourceFolderId()).toBe("pitch-library-id");
    expect(isDriveServiceConfigured()).toBe(true);
  });

  it("is not configured without a service account key", () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "");

    expect(isDriveServiceConfigured()).toBe(false);
  });

  it("reuses an existing client folder without creating a duplicate", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith("https://oauth2.googleapis.com/token")) {
          return jsonResponse({ access_token: "sa-token", expires_in: 3600 });
        }
        return jsonResponse({ files: [{ id: "existing-folder" }] });
      });

    const folder = await ensureClientDriveFolder("Total Energies");

    expect(folder).toEqual({
      created: false,
      folderId: "existing-folder",
      folderUrl: "https://drive.google.com/drive/folders/existing-folder",
    });

    const driveCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("googleapis.com/drive"),
    );

    // Lookups only (client folder + subfolder repairs), never a create.
    expect(driveCalls.some(([, init]) => init?.method === "POST")).toBe(false);
    for (const [input] of driveCalls) {
      expect(String(input)).toContain("supportsAllDrives=true");
      expect(String(input)).toContain("includeItemsFromAllDrives=true");
    }
  });

  it("creates the client folder and the standard subfolders when missing", async () => {
    const createdFolders: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "sa-token", expires_in: 3600 });
      }
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { name: string };
        createdFolders.push(body.name);
        return jsonResponse({ id: `folder-${createdFolders.length}` });
      }
      return jsonResponse({ files: [] });
    });

    const folder = await ensureClientDriveFolder("Nouvelle Boite");

    expect(folder.created).toBe(true);
    expect(folder.folderId).toBe("folder-1");
    expect(createdFolders).toEqual([
      "Nouvelle Boite",
      ...CLIENT_DRIVE_SUBFOLDERS,
    ]);
  });

  it("escapes quotes in client names inside Drive queries", async () => {
    const searchQueries: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "sa-token", expires_in: 3600 });
      }
      if (init?.method === "POST") {
        return jsonResponse({ id: "folder-x" });
      }
      searchQueries.push(new URL(url).searchParams.get("q") ?? "");
      return jsonResponse({ files: [{ id: "found" }] });
    });

    await ensureClientDriveFolder("L'Oréal");

    expect(searchQueries[0]).toContain("name = 'L\\'Oréal'");
  });

  it("downloads binary files with alt=media", async () => {
    const downloadUrls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "sa-token", expires_in: 3600 });
      }
      if (url.includes("fields=mimeType")) {
        return jsonResponse({
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        });
      }
      downloadUrls.push(url);
      return new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 });
    });

    const content = await downloadDriveFile("pptx-file-id");

    expect(new Uint8Array(content)).toEqual(new Uint8Array([80, 75, 3, 4]));
    expect(downloadUrls).toHaveLength(1);
    expect(downloadUrls[0]).toContain("alt=media");
    expect(downloadUrls[0]).toContain("supportsAllDrives=true");
    expect(downloadUrls[0]).not.toContain("/export");
  });

  it("exports Google Slides files to pptx instead of alt=media", async () => {
    const downloadUrls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "sa-token", expires_in: 3600 });
      }
      if (url.includes("fields=mimeType")) {
        return jsonResponse({
          mimeType: "application/vnd.google-apps.presentation",
        });
      }
      downloadUrls.push(url);
      return new Response(new Uint8Array([80, 75]), { status: 200 });
    });

    const content = await downloadDriveFile("slides-file-id");

    expect(new Uint8Array(content)).toEqual(new Uint8Array([80, 75]));
    expect(downloadUrls).toHaveLength(1);
    expect(downloadUrls[0]).toContain("/files/slides-file-id/export");
    expect(downloadUrls[0]).toContain(
      "mimeType=application%2Fvnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(downloadUrls[0]).toContain("supportsAllDrives=true");
    expect(downloadUrls[0]).not.toContain("alt=media");
  });

  it("turns 403 cannotDownloadFile into an actionable message", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "sa-token", expires_in: 3600 });
      }
      if (url.includes("fields=mimeType")) {
        return jsonResponse({
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        });
      }
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            errors: [
              {
                reason: "cannotDownloadFile",
                message: "This file cannot be downloaded by the user.",
              },
            ],
          },
        }),
        { status: 403 },
      );
    });

    await expect(downloadDriveFile("restricted-file-id")).rejects.toThrow(
      "Le service account ne peut pas télécharger ce fichier : passe-le en Éditeur sur le dossier, ou désactive la restriction de téléchargement pour les lecteurs du Drive partagé, ou stocke le deck en .pptx natif.",
    );
  });

  it("turns export size overflows into a native-pptx suggestion", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "sa-token", expires_in: 3600 });
      }
      if (url.includes("fields=mimeType")) {
        return jsonResponse({
          mimeType: "application/vnd.google-apps.presentation",
        });
      }
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            errors: [{ reason: "exportSizeLimitExceeded" }],
          },
        }),
        { status: 403 },
      );
    });

    await expect(downloadDriveFile("huge-slides-id")).rejects.toThrow(
      "L'export Google Drive est plafonné à 10 Mo",
    );
  });
});
