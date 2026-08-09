import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimMayaPitchUpload: vi.fn(),
  completeMayaPitchUploadClaim: vi.fn(),
  downloadMayaDriveDeckToTemp: vi.fn(),
  failMayaPitchUploadClaim: vi.fn(),
  findMayaDriveDraftByExactName: vi.fn(),
  findMayaDriveDraftById: vi.fn(),
  findMayaDriveArtifacts: vi.fn(),
  generateMayaDriveFileId: vi.fn(),
  generateMayaPitchDraft: vi.fn(),
  getMayaApprovedTemplateFileId: vi.fn(),
  getMayaCrmLeadContext: vi.fn(),
  getMayaClientsRootFolderId: vi.fn(),
  getMayaDriveTemplateFile: vi.fn(),
  hasMayaClientDriveConfig: vi.fn(),
  inspectMayaDriveDestination: vi.fn(),
  listMayaCrmLeadContexts: vi.fn(),
  renewMayaPitchUploadClaim: vi.fn(),
  requireMayaPitchGenerationAccess: vi.fn(),
  requireMayaPitchGeneratorAccess: vi.fn(),
  resolveMayaCrmDriveFolderUrl: vi.fn(),
  uploadMayaDriveDraft: vi.fn(),
  verifyMayaDrivePptxHash: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("./access", () => ({
  requireMayaPitchGenerationAccess: mocks.requireMayaPitchGenerationAccess,
  requireMayaPitchGeneratorAccess: mocks.requireMayaPitchGeneratorAccess,
}));

vi.mock("./crm", () => ({
  getMayaCrmLeadContext: mocks.getMayaCrmLeadContext,
  listMayaCrmLeadContexts: mocks.listMayaCrmLeadContexts,
  resolveMayaCrmDriveFolderUrl: mocks.resolveMayaCrmDriveFolderUrl,
}));

vi.mock("./drive", () => ({
  downloadMayaDriveDeckToTemp: mocks.downloadMayaDriveDeckToTemp,
  findMayaDriveDraftByExactName: mocks.findMayaDriveDraftByExactName,
  findMayaDriveDraftById: mocks.findMayaDriveDraftById,
  findMayaDriveArtifacts: mocks.findMayaDriveArtifacts,
  generateMayaDriveFileId: mocks.generateMayaDriveFileId,
  getMayaApprovedTemplateFileId: mocks.getMayaApprovedTemplateFileId,
  getMayaClientsRootFolderId: mocks.getMayaClientsRootFolderId,
  getMayaDriveTemplateFile: mocks.getMayaDriveTemplateFile,
  hasMayaClientDriveConfig: mocks.hasMayaClientDriveConfig,
  inspectMayaDriveDestination: mocks.inspectMayaDriveDestination,
  uploadMayaDriveDraft: mocks.uploadMayaDriveDraft,
  verifyMayaDrivePptxHash: mocks.verifyMayaDrivePptxHash,
}));

vi.mock("./generator", () => ({
  generateMayaPitchDraft: mocks.generateMayaPitchDraft,
}));

vi.mock("./upload-claims", () => ({
  claimMayaPitchUpload: mocks.claimMayaPitchUpload,
  completeMayaPitchUploadClaim: mocks.completeMayaPitchUploadClaim,
  failMayaPitchUploadClaim: mocks.failMayaPitchUploadClaim,
  renewMayaPitchUploadClaim: mocks.renewMayaPitchUploadClaim,
}));

import {
  fetchMayaPitchQueueAction,
  generateMayaPitchDraftForLeadAction,
  generateMayaPitchDraftFormAction,
} from "./actions";

describe("Maya faithful-clone actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
    mocks.requireMayaPitchGenerationAccess.mockResolvedValue({
      organizationId: "org-1",
      supabase: {},
    });
    mocks.requireMayaPitchGeneratorAccess.mockResolvedValue({
      organizationId: "org-1",
      supabase: {},
    });
    mocks.hasMayaClientDriveConfig.mockReturnValue(true);
    mocks.getMayaApprovedTemplateFileId.mockReturnValue(null);
    mocks.getMayaClientsRootFolderId.mockReturnValue("clients-root-id");
    mocks.getMayaDriveTemplateFile.mockResolvedValue(makeTemplate());
    mocks.claimMayaPitchUpload.mockResolvedValue({
      action: "execute",
      claimId: "11111111-1111-4111-8111-111111111111",
      leaseToken: "22222222-2222-4222-8222-222222222222",
      reservedDriveFileId: "reserved-draft-id",
    });
    mocks.completeMayaPitchUploadClaim.mockResolvedValue(undefined);
    mocks.failMayaPitchUploadClaim.mockResolvedValue(true);
    mocks.renewMayaPitchUploadClaim.mockResolvedValue(undefined);
    mocks.verifyMayaDrivePptxHash.mockResolvedValue("a".repeat(64));
    mocks.findMayaDriveDraftByExactName.mockResolvedValue(null);
    mocks.findMayaDriveDraftById.mockResolvedValue(null);
    mocks.generateMayaDriveFileId.mockResolvedValue("candidate-draft-id");
    mocks.listMayaCrmLeadContexts.mockResolvedValue([makeLead()]);
    mocks.getMayaCrmLeadContext.mockResolvedValue(makeLead());
    mocks.resolveMayaCrmDriveFolderUrl.mockReturnValue(
      "https://drive.google.com/drive/folders/client-folder-id",
    );
    mocks.inspectMayaDriveDestination.mockResolvedValue(makeDestination());
    mocks.findMayaDriveArtifacts.mockResolvedValue({
      destination: makeDestination(),
      draft: null,
      final: null,
    });
    mocks.downloadMayaDriveDeckToTemp.mockResolvedValue({
      ...makeTemplate(),
      filePath: "/tmp/maya-drive-deck-test/template.pptx",
    });
    mocks.generateMayaPitchDraft.mockResolvedValue({
      draft: {
        fileName:
          "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
        filePath: "/tmp/maya-output/HPS/01_Pitch/draft.pptx",
      },
      family: "pitch",
      sourceSha256: "same-hash",
      targetSha256: "same-hash",
    });
    mocks.uploadMayaDriveDraft.mockResolvedValue({
      driveFileId: "reserved-draft-id",
      draftFileName:
        "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      draftFilePath: "https://drive.google.com/file/d/reserved-draft-id/view",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows the approved source, family, date and validated destination", async () => {
    const result = await fetchMayaPitchQueueAction();

    expect(result).toMatchObject({
      authorized: true,
      items: [
        expect.objectContaining({
          clientName: "HPS",
          destinationFolderUrl:
            "https://drive.google.com/drive/folders/pitch-folder-id",
          status: "ready",
        }),
      ],
      templates: [
        expect.objectContaining({
          availability: "ready",
          family: "pitch",
          fileName: "Qarizmi_Introduction_Service as a software_Teaser.pptx",
          modifiedAt: "2026-08-03T22:14:53.763Z",
        }),
        expect.objectContaining({
          availability: "manual-review",
          family: "commercial-proposal",
        }),
      ],
    });
  });

  it("requires explicit confirmation before any CRM, source or Drive read", async () => {
    const result = await generateMayaPitchDraftForLeadAction("lead-1");

    expect(result).toEqual({
      error:
        "Confirme explicitement la copie du modèle et son dépôt dans 01_Pitch.",
      success: false,
    });
    expect(mocks.getMayaCrmLeadContext).not.toHaveBeenCalled();
    expect(mocks.getMayaDriveTemplateFile).not.toHaveBeenCalled();
    expect(mocks.claimMayaPitchUpload).not.toHaveBeenCalled();
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
  });

  it("keeps commercial proposals gated without reading or writing Drive", async () => {
    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "commercial-proposal",
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("validation manuelle"),
      success: false,
    });
    expect(mocks.getMayaDriveTemplateFile).not.toHaveBeenCalled();
    expect(mocks.claimMayaPitchUpload).not.toHaveBeenCalled();
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
  });

  it("returns an uploaded durable claim without starting another upload", async () => {
    mocks.claimMayaPitchUpload.mockResolvedValue({
      action: "uploaded",
      claimId: "11111111-1111-4111-8111-111111111111",
      driveFileId: "durable-draft-id",
      driveFileUrl: "https://drive.google.com/file/d/durable-draft-id/view",
    });

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toMatchObject({
      draftFilePath: "https://drive.google.com/file/d/durable-draft-id/view",
      reusedExistingDraft: true,
      success: true,
    });
    expect(mocks.downloadMayaDriveDeckToTemp).not.toHaveBeenCalled();
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
    expect(mocks.verifyMayaDrivePptxHash).toHaveBeenCalledWith({
      driveFileId: "durable-draft-id",
      expectedFileName:
        "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      expectedParentFolderId: "pitch-folder-id",
      expectedSha256: "a".repeat(64),
    });
  });

  it("does not upload when another request owns the durable claim", async () => {
    mocks.claimMayaPitchUpload.mockResolvedValue({
      action: "busy",
      claimId: "11111111-1111-4111-8111-111111111111",
    });

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("déjà en cours"),
      success: false,
    });
    expect(mocks.downloadMayaDriveDeckToTemp).not.toHaveBeenCalled();
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
    expect(mocks.failMayaPitchUploadClaim).not.toHaveBeenCalled();
  });

  it("performs a filename-only clone and one upload without AI providers", async () => {
    vi.stubEnv("MAYA_OPENAI_API_KEY", "must-not-be-used");
    vi.stubEnv("GROQ_API_KEY", "must-not-be-used");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toMatchObject({
      draftFileName:
        "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      reusedExistingDraft: false,
      sourceFileName: "Qarizmi_Introduction_Service as a software_Teaser.pptx",
      success: true,
    });
    expect(mocks.generateMayaPitchDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: "HPS",
        expectedSourceSha256: "a".repeat(64),
        family: "pitch",
        sourceDeckFilePath: expect.stringContaining("template.pptx"),
      }),
    );
    expect(mocks.uploadMayaDriveDraft).toHaveBeenCalledTimes(1);
    expect(mocks.renewMayaPitchUploadClaim).toHaveBeenCalledTimes(1);
    expect(
      mocks.renewMayaPitchUploadClaim.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.uploadMayaDriveDraft.mock.invocationCallOrder[0]!);
    expect(mocks.claimMayaPitchUpload).toHaveBeenCalledTimes(1);
    expect(mocks.completeMayaPitchUploadClaim).toHaveBeenCalledWith(
      expect.objectContaining({ driveFileId: "reserved-draft-id" }),
    );
    expect(mocks.uploadMayaDriveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        driveFileId: "reserved-draft-id",
        pitchFolderId: "pitch-folder-id",
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reuses the same-day draft without creating a duplicate", async () => {
    const fileName =
      "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx";
    mocks.findMayaDriveDraftByExactName.mockResolvedValue({
      id: "existing-draft",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      name: fileName,
      parents: ["pitch-folder-id"],
      webViewLink: "https://drive.google.com/file/d/existing-draft/view",
    });

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toMatchObject({
      draftFileName: fileName,
      reusedExistingDraft: true,
      success: true,
    });
    expect(mocks.downloadMayaDriveDeckToTemp).not.toHaveBeenCalled();
    expect(mocks.generateMayaPitchDraft).not.toHaveBeenCalled();
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
    expect(mocks.verifyMayaDrivePptxHash).toHaveBeenCalledWith(
      expect.objectContaining({ driveFileId: "existing-draft" }),
    );
    expect(mocks.completeMayaPitchUploadClaim).toHaveBeenCalledWith(
      expect.objectContaining({ driveFileId: "existing-draft" }),
    );
  });

  it("avoids a duplicate created concurrently while the source is scanned", async () => {
    const fileName =
      "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx";
    mocks.findMayaDriveDraftByExactName
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "concurrent-draft",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        name: fileName,
        parents: ["pitch-folder-id"],
        webViewLink: "https://drive.google.com/file/d/concurrent-draft/view",
      });

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toMatchObject({
      draftFileName: fileName,
      reusedExistingDraft: true,
      success: true,
    });
    expect(mocks.generateMayaPitchDraft).toHaveBeenCalledTimes(1);
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
    expect(mocks.completeMayaPitchUploadClaim).toHaveBeenCalledWith(
      expect.objectContaining({ driveFileId: "concurrent-draft" }),
    );
  });

  it("fails the claim and blocks reuse when an existing draft hash differs", async () => {
    const fileName =
      "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx";
    mocks.findMayaDriveDraftByExactName.mockResolvedValue({
      id: "wrong-draft",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      name: fileName,
      parents: ["pitch-folder-id"],
    });
    mocks.verifyMayaDrivePptxHash.mockRejectedValue(
      new Error(
        "Le contenu du PPTX Drive ne correspond pas au SHA-256 audité.",
      ),
    );

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("SHA-256 audité"),
      success: false,
    });
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
    expect(mocks.failMayaPitchUploadClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });

  it("marks the durable claim failed when generation stops before upload", async () => {
    mocks.generateMayaPitchDraft.mockRejectedValue(
      new Error("Le contenu source a changé."),
    );

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toEqual({
      error: "Le contenu source a changé.",
      success: false,
    });
    expect(mocks.failMayaPitchUploadClaim).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: "Le contenu source a changé." }),
    );
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
  });

  it("reconciles an indeterminate upload by its reserved Drive id", async () => {
    const fileName =
      "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx";
    mocks.findMayaDriveDraftById.mockResolvedValue({
      id: "reserved-draft-id",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      name: fileName,
      parents: ["pitch-folder-id"],
      webViewLink: "https://drive.google.com/file/d/reserved-draft-id/view",
    });

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toMatchObject({
      draftFilePath: "https://drive.google.com/file/d/reserved-draft-id/view",
      reusedExistingDraft: true,
      success: true,
    });
    expect(mocks.findMayaDriveDraftByExactName).not.toHaveBeenCalled();
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
    expect(mocks.completeMayaPitchUploadClaim).toHaveBeenCalledWith(
      expect.objectContaining({ driveFileId: "reserved-draft-id" }),
    );
  });

  it("blocks the upload when the execution lease was reclaimed", async () => {
    mocks.renewMayaPitchUploadClaim.mockRejectedValue(
      new Error(
        "Maya's idempotency lease changed before upload; no Drive file was created.",
      ),
    );

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("lease changed before upload"),
      success: false,
    });
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
    expect(mocks.failMayaPitchUploadClaim).toHaveBeenCalledTimes(1);
  });

  it("blocks an invalid destination before download or upload", async () => {
    mocks.inspectMayaDriveDestination.mockRejectedValue(
      new Error("Le dossier CRM est hors du root Clients autorisé."),
    );

    const result = await generateMayaPitchDraftForLeadAction("lead-1", {
      confirmed: true,
      family: "pitch",
    });

    expect(result).toEqual({
      error: "Le dossier CRM est hors du root Clients autorisé.",
      success: false,
    });
    expect(mocks.downloadMayaDriveDeckToTemp).not.toHaveBeenCalled();
    expect(mocks.claimMayaPitchUpload).not.toHaveBeenCalled();
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
  });

  it("keeps the owner-only authorization boundary", async () => {
    mocks.requireMayaPitchGenerationAccess.mockRejectedValue(
      new Error("La génération de pitch Maya est réservée au rôle owner."),
    );

    await expect(
      generateMayaPitchDraftForLeadAction("lead-1", {
        confirmed: true,
        family: "pitch",
      }),
    ).rejects.toThrow("réservée au rôle owner");
    expect(mocks.claimMayaPitchUpload).not.toHaveBeenCalled();
    expect(mocks.uploadMayaDriveDraft).not.toHaveBeenCalled();
  });

  it("cleans the downloaded source temporary directory", async () => {
    const sourceTempRoot = await mkdtemp(
      path.join(os.tmpdir(), "maya-drive-deck-test-"),
    );
    const filePath = path.join(sourceTempRoot, "template.pptx");
    await writeFile(filePath, "fake pptx");
    mocks.downloadMayaDriveDeckToTemp.mockResolvedValue({
      ...makeTemplate(),
      filePath,
    });

    try {
      await generateMayaPitchDraftForLeadAction("lead-1", {
        confirmed: true,
        family: "pitch",
      });
      await expect(stat(sourceTempRoot)).rejects.toThrow();
    } finally {
      await rm(sourceTempRoot, { force: true, recursive: true });
    }
  });

  it("returns a visible form state only after the confirmation checkbox", async () => {
    const formData = new FormData();
    formData.set("leadId", "lead-1");
    formData.set("family", "pitch");
    formData.set("confirmTemplateCopy", "on");

    await expect(
      generateMayaPitchDraftFormAction({ status: "idle" }, formData),
    ).resolves.toMatchObject({
      draftFilePath: "https://drive.google.com/file/d/reserved-draft-id/view",
      leadId: "lead-1",
      message: expect.stringContaining("Copie PPTX fidèle"),
      sourceFileName: "Qarizmi_Introduction_Service as a software_Teaser.pptx",
      status: "success",
    });
  });
});

function makeLead() {
  return {
    clientName: "HPS",
    companyDriveFolderUrl:
      "https://drive.google.com/drive/folders/client-folder-id",
    companyId: "company-1",
    contactName: "Abdeslam El-Alawi",
    leadId: "lead-1",
    leadStatus: "meeting-booked",
    organizationId: "org-1",
  };
}

function makeTemplate() {
  return {
    driveFileId: "approved-teaser-id",
    expectedSha256: "a".repeat(64),
    fileName: "Qarizmi_Introduction_Service as a software_Teaser.pptx",
    filePath: "gdrive:approved-teaser-id",
    kind: "example" as const,
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    modifiedAt: new Date("2026-08-03T22:14:53.763Z"),
    sizeBytes: 4_933_715,
    webViewLink:
      "https://docs.google.com/presentation/d/approved-teaser-id/edit",
  };
}

function makeDestination() {
  return {
    clientFolderId: "client-folder-id",
    clientFolderName: "HPS",
    files: [],
    pitchFolderId: "pitch-folder-id",
    pitchFolderUrl: "https://drive.google.com/drive/folders/pitch-folder-id",
  };
}
