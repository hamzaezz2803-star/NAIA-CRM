"use server";

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { revalidatePath } from "next/cache";

import type { MayaTemplateFamily, MayaTemplateSource } from "./contracts";
import {
  getMayaCrmLeadContext,
  listMayaCrmLeadContexts,
  resolveMayaCrmDriveFolderUrl,
  type MayaCrmLeadContext,
} from "./crm";
import {
  downloadMayaDriveDeckToTemp,
  findMayaDriveArtifacts,
  getMayaApprovedTemplateFileId,
  getMayaClientsRootFolderId,
  getMayaDriveTemplateFile,
  hasMayaClientDriveConfig,
  inspectMayaDriveDestination,
  uploadMayaDriveDraft,
} from "./drive";
import { generateMayaPitchDraft } from "./generator";
import {
  requireMayaPitchGenerationAccess,
  requireMayaPitchGeneratorAccess,
} from "./access";
import {
  buildMayaDraftFileName,
  createLocalMayaPitchStorageAdapter,
} from "./storage";

export type MayaPitchQueueItem = {
  clientName: string;
  contactName?: string;
  destinationError?: string;
  destinationFolderUrl?: string;
  draftFileName?: string;
  draftFilePath?: string;
  finalFileName?: string;
  leadId: string;
  leadStatus: string;
  status: "blocked" | "ready" | "draft-ready" | "final-uploaded";
};

export type MayaPitchQueueResult =
  | {
      authorized: false;
      reason: string;
    }
  | {
      authorized: true;
      items: MayaPitchQueueItem[];
      sourceWarnings: string[];
      templates: MayaTemplateSource[];
    };

export type MayaPitchDraftFormState = {
  draftFileName?: string;
  draftFilePath?: string;
  leadId?: string;
  message?: string;
  sourceFileName?: string;
  status: "idle" | "success" | "error";
};

export type MayaPitchGenerationConfirmation = {
  confirmed: boolean;
  family: MayaTemplateFamily;
};

export async function fetchMayaPitchQueueAction(): Promise<MayaPitchQueueResult> {
  let access: Awaited<ReturnType<typeof requireMayaPitchGeneratorAccess>>;
  try {
    access = await requireMayaPitchGeneratorAccess();
  } catch (error) {
    return {
      authorized: false,
      reason: readErrorMessage(
        error,
        "Maya pitch generator access is restricted.",
      ),
    };
  }

  const [templates, leadResult] = await Promise.all([
    loadMayaTemplateSources(),
    listMayaCrmLeadContexts({ organizationId: access.organizationId })
      .then((leads) => ({ leads, warning: null }))
      .catch((error: unknown) => ({
        leads: [] as MayaCrmLeadContext[],
        warning: readErrorMessage(error, "Maya could not read CRM leads."),
      })),
  ]);
  const sourceWarnings = templates
    .flatMap((template) => (template.warning ? [template.warning] : []))
    .concat(leadResult.warning ? [leadResult.warning] : []);

  const items = await Promise.all(
    leadResult.leads.map(async (lead) =>
      buildMayaPitchQueueItem(lead, sourceWarnings),
    ),
  );

  return {
    authorized: true,
    items,
    sourceWarnings,
    templates,
  };
}

export async function generateMayaPitchDraftFormAction(
  _previousState: MayaPitchDraftFormState,
  formData: FormData,
): Promise<MayaPitchDraftFormState> {
  const leadId = readFormText(formData, "leadId") ?? "";
  const family = readTemplateFamily(formData.get("family"));
  if (!family) {
    return {
      leadId,
      message: "Famille de document invalide.",
      status: "error",
    };
  }

  const result = await generateMayaPitchDraftForLeadAction(leadId, {
    confirmed: formData.get("confirmTemplateCopy") === "on",
    family,
  });
  revalidatePath("/proposals");

  if (!result.success) {
    return {
      leadId,
      message: result.error ?? "Maya n'a pas pu copier le draft PPTX.",
      status: "error",
    };
  }

  return {
    draftFileName: result.draftFileName,
    draftFilePath: result.draftFilePath,
    leadId,
    message: result.reusedExistingDraft
      ? `Le draft existe déjà dans 01_Pitch; aucun doublon n'a été créé: ${result.draftFileName}`
      : `Copie PPTX fidèle déposée dans le Drive privé Qarizmi: ${result.draftFileName}`,
    sourceFileName: result.sourceFileName,
    status: "success",
  };
}

export async function generateMayaPitchDraftForLeadAction(
  leadId: string,
  confirmation: MayaPitchGenerationConfirmation = {
    confirmed: false,
    family: "pitch",
  },
) {
  const access = await requireMayaPitchGenerationAccess();
  if (!confirmation.confirmed) {
    return {
      error:
        "Confirme explicitement la copie du modèle et son dépôt dans 01_Pitch.",
      success: false as const,
    };
  }
  if (confirmation.family === "commercial-proposal") {
    return {
      error:
        "La proposition commerciale reste en validation manuelle; aucun fichier n'a été copié.",
      success: false as const,
    };
  }
  if (!hasMayaClientDriveConfig()) {
    return {
      error:
        "Le Drive privé Maya n'est pas entièrement configuré; aucun fichier n'a été créé localement.",
      success: false as const,
    };
  }

  let sourceTempRoot: string | null = null;
  let outputTempRoot: string | null = null;

  try {
    const clientsRootFolderId = getMayaClientsRootFolderId();
    const [lead, sourceTemplate] = await Promise.all([
      getMayaCrmLeadContext({
        leadId,
        organizationId: access.organizationId,
      }),
      getMayaDriveTemplateFile({ family: confirmation.family }),
    ]);
    const clientFolderUrl = resolveMayaCrmDriveFolderUrl(lead);
    const destination = await inspectMayaDriveDestination({
      clientFolderUrl,
      expectedRootFolderId: clientsRootFolderId,
    });
    const generationDate = new Date();
    const expectedFileName = buildMayaDraftFileName({
      clientName: lead.clientName,
      date: generationDate,
    });
    const existing = destination.files.find(
      (file) => file.name === expectedFileName,
    );
    if (existing) {
      return {
        draftFileName: expectedFileName,
        draftFilePath:
          existing.webViewLink ??
          `https://drive.google.com/file/d/${existing.id}/view`,
        reusedExistingDraft: true,
        sourceFileName: sourceTemplate.fileName,
        success: true as const,
      };
    }

    const downloadedTemplate =
      await downloadMayaDriveDeckToTemp(sourceTemplate);
    sourceTempRoot = path.dirname(downloadedTemplate.filePath);
    outputTempRoot = await mkdtemp(
      path.join(os.tmpdir(), "maya-faithful-output-"),
    );
    const result = await generateMayaPitchDraft({
      clientName: lead.clientName,
      date: generationDate,
      family: confirmation.family,
      sourceDeckFilePath: downloadedTemplate.filePath,
      storage: createLocalMayaPitchStorageAdapter(outputTempRoot),
    });
    if (result.sourceSha256 !== result.targetSha256) {
      return {
        error: "La vérification de fidélité binaire a échoué.",
        success: false as const,
      };
    }

    // Revalidate immediately before the external write: the folder may have
    // moved or another request may have created today's draft while the source
    // was being scanned.
    const uploadDestination = await inspectMayaDriveDestination({
      clientFolderUrl,
      expectedRootFolderId: clientsRootFolderId,
    });
    if (uploadDestination.pitchFolderId !== destination.pitchFolderId) {
      return {
        error:
          "La destination 01_Pitch a changé pendant la préparation; l'upload est bloqué.",
        success: false as const,
      };
    }
    const concurrentDraft = uploadDestination.files.find(
      (file) => file.name === result.draft.fileName,
    );
    if (concurrentDraft) {
      return {
        draftFileName: result.draft.fileName,
        draftFilePath:
          concurrentDraft.webViewLink ??
          `https://drive.google.com/file/d/${concurrentDraft.id}/view`,
        reusedExistingDraft: true,
        sourceFileName: sourceTemplate.fileName,
        success: true as const,
      };
    }

    const upload = await uploadMayaDriveDraft({
      draftFileName: result.draft.fileName,
      draftFilePath: result.draft.filePath,
      pitchFolderId: uploadDestination.pitchFolderId,
    });

    return {
      draftFileName: upload.draftFileName,
      draftFilePath: upload.draftFilePath,
      reusedExistingDraft: false,
      sourceFileName: sourceTemplate.fileName,
      success: true as const,
    };
  } catch (error) {
    return {
      error: readErrorMessage(error, "Maya n'a pas pu copier le pitch."),
      success: false as const,
    };
  } finally {
    await Promise.all([
      cleanupMayaTempRoot(sourceTempRoot, "maya-drive-deck-"),
      cleanupMayaTempRoot(outputTempRoot, "maya-faithful-output-"),
    ]);
  }
}

async function buildMayaPitchQueueItem(
  lead: MayaCrmLeadContext,
  warnings: string[],
): Promise<MayaPitchQueueItem> {
  try {
    if (!hasMayaClientDriveConfig()) {
      throw new Error("Le Drive privé Maya n'est pas configuré.");
    }
    const driveFolderUrl = resolveMayaCrmDriveFolderUrl(lead);
    const artifacts = await findMayaDriveArtifacts({
      clientFolderUrl: driveFolderUrl,
      expectedRootFolderId: getMayaClientsRootFolderId(),
    });

    return {
      clientName: lead.clientName,
      contactName: lead.contactName,
      destinationFolderUrl: artifacts.destination.pitchFolderUrl,
      draftFileName: artifacts.draft?.fileName,
      draftFilePath: artifacts.draft?.filePath,
      finalFileName: artifacts.final?.fileName,
      leadId: lead.leadId,
      leadStatus: lead.leadStatus,
      status: artifacts.final
        ? "final-uploaded"
        : artifacts.draft
          ? "draft-ready"
          : "ready",
    };
  } catch (error) {
    const destinationError = readErrorMessage(
      error,
      "Destination Drive non vérifiable.",
    );
    warnings.push(`${lead.clientName}: ${destinationError}`);
    return {
      clientName: lead.clientName,
      contactName: lead.contactName,
      destinationError,
      leadId: lead.leadId,
      leadStatus: lead.leadStatus,
      status: "blocked",
    };
  }
}

async function loadMayaTemplateSources(): Promise<MayaTemplateSource[]> {
  if (!hasMayaClientDriveConfig()) {
    return [
      unavailableTemplate(
        "pitch",
        "Le Drive privé Maya n'est pas entièrement configuré.",
      ),
      manualProposalTemplate(),
    ];
  }

  const pitch = await loadMayaTemplateSource("pitch");
  const proposal = getMayaApprovedTemplateFileId("commercial-proposal")
    ? await loadMayaTemplateSource("commercial-proposal")
    : manualProposalTemplate();

  return [pitch, proposal];
}

async function loadMayaTemplateSource(
  family: MayaTemplateFamily,
): Promise<MayaTemplateSource> {
  try {
    const file = await getMayaDriveTemplateFile({ family });
    return {
      availability: family === "pitch" ? "ready" : "manual-review",
      driveFileId: file.driveFileId,
      family,
      fileName: file.fileName,
      modifiedAt: file.modifiedAt.toISOString(),
      sizeBytes: file.sizeBytes,
      sourceLabel: `Google Drive · ${file.driveFileId}`,
      warning:
        family === "commercial-proposal"
          ? "Les propositions commerciales restent bloquées pour revue manuelle."
          : undefined,
      webViewLink: file.webViewLink,
    };
  } catch (error) {
    return unavailableTemplate(
      family,
      readErrorMessage(error, "Modèle Drive indisponible."),
    );
  }
}

function unavailableTemplate(
  family: MayaTemplateFamily,
  warning: string,
): MayaTemplateSource {
  return {
    availability: "unavailable",
    family,
    sourceLabel: "Google Drive",
    warning,
  };
}

function manualProposalTemplate(): MayaTemplateSource {
  return {
    availability: "manual-review",
    family: "commercial-proposal",
    sourceLabel: "Validation manuelle",
    warning:
      "La famille proposition commerciale n'effectue aucune copie automatique en V1.",
  };
}

async function cleanupMayaTempRoot(
  tempRoot: string | null,
  expectedPrefix: string,
) {
  if (!tempRoot) return;
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTempDir = path.resolve(os.tmpdir());
  if (
    resolvedRoot.startsWith(`${resolvedTempDir}${path.sep}`) &&
    path.basename(resolvedRoot).startsWith(expectedPrefix)
  ) {
    await rm(resolvedRoot, { force: true, recursive: true });
  }
}

function readTemplateFamily(value: FormDataEntryValue | null) {
  return value === "pitch" || value === "commercial-proposal" ? value : null;
}

function readFormText(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
