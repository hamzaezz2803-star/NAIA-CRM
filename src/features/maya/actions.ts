"use server";

import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { revalidatePath } from "next/cache";

import { fetchLeadsAction } from "@/features/crm/actions";

import {
  type MayaBrief,
  DEFAULT_MAYA_OUTPUT_ROOT,
  DEFAULT_MAYA_SOURCE_FOLDER,
  type MayaDeckPlan,
} from "./contracts";
import { generateMayaPitchDraft } from "./generator";
import {
  findLatestGenericDeck,
  indexMayaDeck,
  listMayaDeckFiles,
} from "./pptx";
import { enhanceMayaDeckPlanWithOpenAI } from "./openai-planner";
import {
  buildMayaDeckPlan,
  buildMayaPitchBriefFromLead,
  buildMissingMayaPitchQuestions,
} from "./planning";
import {
  requireMayaPitchGenerationAccess,
  requireMayaPitchGeneratorAccess,
} from "./access";
import {
  downloadMayaDriveDeckToTemp,
  findMayaDriveDraftForClient,
  findMayaDriveFinalForClient,
  getMayaDriveConfigFromEnv,
  hasMayaDriveFolderConfig,
  listMayaDriveDeckFiles,
  uploadMayaDriveDraftArtifacts,
} from "./drive";
import {
  buildMayaDraftFileName,
  createLocalMayaPitchStorageAdapter,
  isNabilFinalPitchFileName,
  sanitizeMayaClientName,
} from "./storage";

export type MayaPitchQueueItem = {
  clientName: string;
  contactName?: string;
  contextDefaults: {
    contactName?: string;
    contactRole?: string;
    industry?: string;
    meetingObjective?: string;
    websiteUrl?: string;
  };
  draftFileName?: string;
  draftFilePath?: string;
  finalFileName?: string;
  leadId: string;
  leadStatus: string;
  missingQuestions: string[];
  plan?: MayaDeckPlan;
  status: "needs-context" | "ready" | "draft-ready" | "final-uploaded";
};

export type MayaPitchQueueResult =
  | {
      authorized: false;
      reason: string;
    }
  | {
      authorized: true;
      genericDeckFileName?: string;
      items: MayaPitchQueueItem[];
      sourceFolder: string;
      sourceWarnings: string[];
    };

export type MayaPitchDraftFormState = {
  draftFileName?: string;
  draftFilePath?: string;
  leadId?: string;
  manifestPath?: string;
  message?: string;
  status: "idle" | "success" | "error";
};

type MayaPitchDraftContextInput = {
  contactName?: string;
  contactRole?: string;
  extraContext?: string;
  generateAnyway?: boolean;
  industry?: string;
  meetingObjective?: string;
  requireCompleteContext?: boolean;
  websiteUrl?: string;
};

export async function fetchMayaPitchQueueAction(): Promise<MayaPitchQueueResult> {
  try {
    await requireMayaPitchGeneratorAccess();
  } catch (error) {
    return {
      authorized: false,
      reason:
        error instanceof Error
          ? error.message
          : "Maya pitch generator access is restricted.",
    };
  }

  const leads = await fetchLeadsAction();
  const library = await loadMayaPitchLibrary();

  try {
    const meetingBookedLeads = leads.filter(
      (lead) => lead.status === "meeting-booked",
    );
    const lookupWarnings: string[] = [];
    const items = await Promise.all(
      meetingBookedLeads.map(async (lead) => {
        const brief = buildMayaPitchBriefFromLead(lead);
        const plan = library.genericDeck
          ? buildMayaDeckPlan({
              brief,
              genericDeck: library.genericDeck,
              learningEvents: [],
            })
          : undefined;
        const draft = await findDraftForClient(brief.clientName).catch(
          (error: unknown) => {
            lookupWarnings.push(
              buildMayaDriveLookupWarning("drafts", brief.clientName, error),
            );
            return null;
          },
        );
        const final = await findFinalForClient(brief.clientName).catch(
          (error: unknown) => {
            lookupWarnings.push(
              buildMayaDriveLookupWarning(
                "versions finales",
                brief.clientName,
                error,
              ),
            );
            return null;
          },
        );

        return {
          clientName: brief.clientName,
          contactName: brief.contactName,
          contextDefaults: {
            contactName: brief.contactName,
            contactRole: brief.contactRole,
            industry: brief.industry,
            meetingObjective: brief.meetingObjective,
            websiteUrl: brief.websiteUrl,
          },
          draftFileName: draft?.fileName,
          draftFilePath: draft?.filePath,
          finalFileName: final?.fileName,
          leadId: lead.id,
          leadStatus: lead.status,
          missingQuestions: brief.missingQuestions,
          plan,
          status: final
            ? "final-uploaded"
            : draft
              ? "draft-ready"
              : brief.missingQuestions.length
                ? "needs-context"
                : "ready",
        } satisfies MayaPitchQueueItem;
      }),
    );

    return {
      authorized: true,
      genericDeckFileName: library.genericDeck?.fileName,
      items,
      sourceFolder: getMayaSourceLabel(),
      sourceWarnings: [
        ...(library.genericDeck?.residueWarnings ?? library.warnings),
        ...lookupWarnings,
      ],
    };
  } finally {
    await cleanupMayaPitchLibrary(library);
  }
}

export async function generateMayaPitchDraftFormAction(
  _previousState: MayaPitchDraftFormState,
  formData: FormData,
): Promise<MayaPitchDraftFormState> {
  const leadId = readFormText(formData, "leadId") ?? "";
  const result = await generateMayaPitchDraftForLeadAction(leadId, {
    ...readMayaDraftContextInput(formData),
    requireCompleteContext: true,
  });
  revalidatePath("/proposals");

  if (!result.success) {
    return {
      leadId,
      message: result.error ?? "Maya n'a pas pu générer le draft PPTX.",
      status: "error",
    };
  }

  return {
    draftFileName: result.draftFileName,
    draftFilePath: result.draftFilePath,
    leadId,
    manifestPath: result.manifestPath,
    message: `Draft PPTX généré dans le Drive privé Qarizmi: ${result.draftFileName}`,
    status: "success",
  };
}

export async function generateMayaPitchDraftForLeadAction(
  leadId: string,
  context: MayaPitchDraftContextInput = {},
) {
  // Generation only starts from an explicit human click (never on a lead
  // status change) and is locked server-side to owner roles.
  await requireMayaPitchGenerationAccess();

  const leads = await fetchLeadsAction();
  const lead = leads.find((candidate) => candidate.id === leadId);
  if (!lead) {
    return { error: "Lead not found", success: false };
  }

  const brief = applyMayaPitchContextOverrides(
    buildMayaPitchBriefFromLead(lead),
    context,
  );

  if (
    context.requireCompleteContext &&
    brief.missingQuestions.length &&
    !context.generateAnyway
  ) {
    return {
      error:
        "Complète les questions de contexte ou coche l'option pour générer un draft provisoire.",
      success: false,
    };
  }

  const library = await loadMayaPitchLibrary();
  let tempOutputRoot: string | null = null;

  try {
    if (!library.genericDeckFile || !library.genericDeck) {
      // Surface the pitch library failure (e.g. an actionable Drive download
      // error) instead of a misleading "not found".
      return {
        error: library.warnings[0] ?? "Generic pitch deck not found",
        success: false,
      };
    }

    const basePlan = buildMayaDeckPlan({
      brief,
      genericDeck: library.genericDeck,
      learningEvents: [],
    });
    const planned = await enhanceMayaDeckPlanWithOpenAI({
      basePlan,
      genericDeck: library.genericDeck,
      learningEvents: [],
    });
    const plan = planned.warning
      ? {
          ...planned.plan,
          residueWarnings: [...planned.plan.residueWarnings, planned.warning],
        }
      : planned.plan;
    tempOutputRoot = hasMayaDriveFolderConfig()
      ? await mkdtemp(path.join(os.tmpdir(), "maya-drive-output-"))
      : null;
    const result = await generateMayaPitchDraft({
      genericDeckFilePath: library.genericDeckFile.filePath,
      plan,
      storage: createLocalMayaPitchStorageAdapter(
        tempOutputRoot ?? getMayaOutputRoot(),
      ),
    });

    if (hasMayaDriveFolderConfig()) {
      const upload = await uploadMayaDriveDraftArtifacts({
        clientName: brief.clientName,
        draftFileName: result.draft.fileName,
        draftFilePath: result.draft.filePath,
        manifestPath: result.manifestPath,
      });

      return {
        draftFileName: upload.draftFileName,
        draftFilePath: upload.draftFilePath,
        manifestPath: upload.manifestPath,
        success: true,
      };
    }

    return {
      draftFileName: result.draft.fileName,
      draftFilePath: result.draft.filePath,
      manifestPath: result.manifestPath,
      success: true,
    };
  } finally {
    if (tempOutputRoot) {
      await rm(tempOutputRoot, { force: true, recursive: true });
    }
    await cleanupMayaPitchLibrary(library);
  }
}

async function loadMayaPitchLibrary() {
  const cleanupPaths: string[] = [];

  try {
    if (hasMayaDriveFolderConfig()) {
      const driveConfig = getMayaDriveConfigFromEnv();
      const driveDeckFiles = await listMayaDriveDeckFiles({
        sourceFolderId: driveConfig.sourceFolderId,
      });
      const genericDriveDeckFile = findLatestGenericDeck(driveDeckFiles) as
        (typeof driveDeckFiles)[number] | null;
      const genericDeckFile = genericDriveDeckFile
        ? await downloadMayaDriveDeckToTemp(genericDriveDeckFile)
        : null;
      if (genericDeckFile) {
        cleanupPaths.push(path.dirname(genericDeckFile.filePath));
      }
      const genericDeck = genericDeckFile
        ? await indexMayaDeck(genericDeckFile.filePath)
        : null;

      return {
        cleanupPaths,
        deckFiles: driveDeckFiles,
        genericDeck,
        genericDeckFile,
        warnings: genericDeck ? genericDeck.residueWarnings : [],
      };
    }

    const deckFiles = await listMayaDeckFiles(getMayaSourceFolder());
    const genericDeckFile = findLatestGenericDeck(deckFiles);
    const genericDeck = genericDeckFile
      ? await indexMayaDeck(genericDeckFile.filePath)
      : null;

    return {
      cleanupPaths,
      deckFiles,
      genericDeck,
      genericDeckFile,
      warnings: genericDeck ? genericDeck.residueWarnings : [],
    };
  } catch (error) {
    await cleanupMayaTempPaths(cleanupPaths);

    return {
      cleanupPaths: [],
      deckFiles: [],
      genericDeck: null,
      genericDeckFile: null,
      warnings: [
        error instanceof Error
          ? error.message
          : "Maya could not read the pitch source folder.",
      ],
    };
  }
}

async function cleanupMayaPitchLibrary({
  cleanupPaths,
}: {
  cleanupPaths?: string[];
}) {
  await cleanupMayaTempPaths(cleanupPaths ?? []);
}

async function cleanupMayaTempPaths(cleanupPaths: string[]) {
  await Promise.all(
    cleanupPaths
      .filter(isMayaDriveTempRoot)
      .map((cleanupPath) => rm(cleanupPath, { force: true, recursive: true })),
  );
}

function isMayaDriveTempRoot(cleanupPath: string) {
  const resolvedPath = path.resolve(cleanupPath);
  const resolvedTempDir = path.resolve(os.tmpdir());

  return (
    resolvedPath.startsWith(`${resolvedTempDir}${path.sep}`) &&
    path.basename(resolvedPath).startsWith("maya-drive-deck-")
  );
}

async function findDraftForClient(clientName: string) {
  if (hasMayaDriveFolderConfig()) {
    return findMayaDriveDraftForClient({
      clientName,
    });
  }

  return findLocalDraftForClient(clientName);
}

function buildMayaDriveLookupWarning(
  kind: "drafts" | "versions finales",
  clientName: string,
  error: unknown,
) {
  const message =
    error instanceof Error ? error.message : "erreur Google Drive inconnue";

  return `Maya n'a pas pu vérifier les ${kind} existants pour ${clientName}: ${message}`;
}

function applyMayaPitchContextOverrides(
  brief: MayaBrief,
  context: MayaPitchDraftContextInput,
): MayaBrief {
  const extraContext = normalizeFormText(context.extraContext);
  const crmContext = extraContext
    ? [brief.crmContext, `Contexte ajouté pour Maya: ${extraContext}`]
        .filter(Boolean)
        .join("\n")
    : brief.crmContext;

  const enrichedBrief: MayaBrief = {
    ...brief,
    contactName: normalizeFormText(context.contactName) ?? brief.contactName,
    contactRole: normalizeFormText(context.contactRole) ?? brief.contactRole,
    crmContext,
    industry: normalizeFormText(context.industry) ?? brief.industry,
    meetingObjective:
      normalizeFormText(context.meetingObjective) ?? brief.meetingObjective,
    websiteUrl: normalizeFormText(context.websiteUrl) ?? brief.websiteUrl,
  };
  const missingQuestions = buildMissingMayaPitchQuestions(enrichedBrief);

  return {
    ...enrichedBrief,
    missingQuestions,
    status: missingQuestions.length ? "needs-context" : "ready",
  };
}

function readMayaDraftContextInput(
  formData: FormData,
): MayaPitchDraftContextInput {
  return {
    contactName: readFormText(formData, "contactName"),
    contactRole: readFormText(formData, "contactRole"),
    extraContext: readFormText(formData, "extraContext"),
    generateAnyway: formData.get("generateAnyway") === "on",
    industry: readFormText(formData, "industry"),
    meetingObjective: readFormText(formData, "meetingObjective"),
    websiteUrl: readFormText(formData, "websiteUrl"),
  };
}

function readFormText(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? normalizeFormText(value) : undefined;
}

function normalizeFormText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function findFinalForClient(clientName: string) {
  if (hasMayaDriveFolderConfig()) {
    return findMayaDriveFinalForClient({
      clientName,
    });
  }

  return findLocalFinalForClient(clientName);
}

async function findLocalDraftForClient(clientName: string) {
  const fileName = buildMayaDraftFileName({
    clientName,
    date: new Date(),
  });
  const filePath = path.join(
    getMayaOutputRoot(),
    sanitizeMayaClientName(clientName),
    "Pitch",
    fileName,
  );

  return (await fileExists(filePath)) ? { fileName, filePath } : null;
}

async function findLocalFinalForClient(clientName: string) {
  const folderPath = path.join(
    getMayaOutputRoot(),
    sanitizeMayaClientName(clientName),
    "Pitch",
  );
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(folderPath);
    const fileName = files.find(isNabilFinalPitchFileName);
    return fileName
      ? { fileName, filePath: path.join(folderPath, fileName) }
      : null;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function getMayaSourceFolder() {
  return process.env.MAYA_PITCH_SOURCE_FOLDER ?? DEFAULT_MAYA_SOURCE_FOLDER;
}

function getMayaSourceLabel() {
  if (hasMayaDriveFolderConfig()) {
    return `Google Drive folder ${getMayaDriveConfigFromEnv().sourceFolderId}`;
  }

  return getMayaSourceFolder();
}

function getMayaOutputRoot() {
  return process.env.MAYA_PITCH_OUTPUT_ROOT ?? DEFAULT_MAYA_OUTPUT_ROOT;
}
