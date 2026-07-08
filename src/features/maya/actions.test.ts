import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CrmLeadSummary } from "@/features/crm/contracts";
import type { MayaDeckFile, MayaDeckPlan, MayaIndexedDeck } from "./contracts";

const mocks = vi.hoisted(() => ({
  downloadMayaDriveDeckToTemp: vi.fn(),
  enhanceMayaDeckPlanWithOpenAI: vi.fn(),
  fetchLeadsAction: vi.fn(),
  findLatestGenericDeck: vi.fn(),
  getMayaDriveConfigFromEnv: vi.fn(),
  generateMayaPitchDraft: vi.fn(),
  hasMayaDriveFolderConfig: vi.fn(),
  indexMayaDeck: vi.fn(),
  listMayaDriveDeckFiles: vi.fn(),
  listMayaDeckFiles: vi.fn(),
  requireMayaPitchGenerationAccess: vi.fn(),
  requireMayaPitchGeneratorAccess: vi.fn(),
  uploadMayaDriveDraftArtifacts: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/features/crm/actions", () => ({
  fetchLeadsAction: mocks.fetchLeadsAction,
}));

vi.mock("./access", () => ({
  requireMayaPitchGenerationAccess: mocks.requireMayaPitchGenerationAccess,
  requireMayaPitchGeneratorAccess: mocks.requireMayaPitchGeneratorAccess,
}));

vi.mock("./drive", () => ({
  downloadMayaDriveDeckToTemp: mocks.downloadMayaDriveDeckToTemp,
  findMayaDriveDraftForClient: vi.fn(),
  findMayaDriveFinalForClient: vi.fn(),
  getMayaDriveConfigFromEnv: mocks.getMayaDriveConfigFromEnv,
  hasMayaDriveFolderConfig: mocks.hasMayaDriveFolderConfig,
  listMayaDriveDeckFiles: mocks.listMayaDriveDeckFiles,
  uploadMayaDriveDraftArtifacts: mocks.uploadMayaDriveDraftArtifacts,
}));

vi.mock("./generator", () => ({
  generateMayaPitchDraft: mocks.generateMayaPitchDraft,
}));

vi.mock("./openai-planner", () => ({
  enhanceMayaDeckPlanWithOpenAI: mocks.enhanceMayaDeckPlanWithOpenAI,
}));

vi.mock("./pptx", () => ({
  findLatestGenericDeck: mocks.findLatestGenericDeck,
  indexMayaDeck: mocks.indexMayaDeck,
  listMayaDeckFiles: mocks.listMayaDeckFiles,
}));

import { generateMayaPitchDraftForLeadAction } from "./actions";

describe("Maya actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMayaPitchGenerationAccess.mockResolvedValue(undefined);
    mocks.requireMayaPitchGeneratorAccess.mockResolvedValue(undefined);
    mocks.hasMayaDriveFolderConfig.mockReturnValue(false);
    mocks.getMayaDriveConfigFromEnv.mockReturnValue({
      outputFolderId: "output-folder",
      sourceFolderId: "source-folder",
    });
    mocks.fetchLeadsAction.mockResolvedValue([makeLead()]);
    mocks.listMayaDriveDeckFiles.mockResolvedValue([makeGenericDeckFile()]);
    mocks.listMayaDeckFiles.mockResolvedValue([makeGenericDeckFile()]);
    mocks.findLatestGenericDeck.mockReturnValue(makeGenericDeckFile());
    mocks.downloadMayaDriveDeckToTemp.mockResolvedValue(makeGenericDeckFile());
    mocks.indexMayaDeck.mockResolvedValue(makeGenericDeck());
    mocks.enhanceMayaDeckPlanWithOpenAI.mockImplementation(
      async ({ basePlan }: { basePlan: MayaDeckPlan }) => ({
        plan: {
          ...basePlan,
          planner: {
            generatedAt: "2026-07-08T00:00:00.000Z",
            model: "gpt-test",
            provider: "openai",
            rationale: "HPS needs payment and LLM local use cases.",
          },
          useCaseBullets: ["Agent RAG HPS propulsé par OpenAI."],
        },
        usedOpenAI: true,
      }),
    );
    mocks.generateMayaPitchDraft.mockResolvedValue({
      draft: {
        fileName:
          "20260708_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
        filePath:
          "/tmp/HPS/Pitch/20260708_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      },
      manifestPath: "/tmp/HPS/Pitch/maya-generation-manifest.json",
    });
    mocks.uploadMayaDriveDraftArtifacts.mockResolvedValue({
      draftFileName:
        "20260708_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      draftFilePath: "gdrive:draft",
      manifestPath: "gdrive:manifest",
    });
  });

  it("uses OpenAI to enrich the deck plan before generating a pitch draft", async () => {
    const result = await generateMayaPitchDraftForLeadAction("lead-1");

    expect(result).toMatchObject({
      draftFileName:
        "20260708_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      success: true,
    });
    expect(mocks.enhanceMayaDeckPlanWithOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        genericDeck: expect.objectContaining({
          fileName: "Qarizmi_Generic.pptx",
        }),
        learningEvents: [],
      }),
    );
    expect(mocks.generateMayaPitchDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          planner: expect.objectContaining({ provider: "openai" }),
          useCaseBullets: ["Agent RAG HPS propulsé par OpenAI."],
        }),
      }),
    );
  });

  it("surfaces the actionable Drive download error instead of a generic not-found", async () => {
    mocks.hasMayaDriveFolderConfig.mockReturnValue(true);
    mocks.downloadMayaDriveDeckToTemp.mockRejectedValue(
      new Error(
        "Le service account ne peut pas télécharger ce fichier : passe-le en Éditeur sur le dossier, ou désactive la restriction de téléchargement pour les lecteurs du Drive partagé, ou stocke le deck en .pptx natif.",
      ),
    );

    const result = await generateMayaPitchDraftForLeadAction("lead-1");

    expect(result).toEqual({
      error: expect.stringContaining(
        "Le service account ne peut pas télécharger ce fichier",
      ),
      success: false,
    });
    expect(mocks.enhanceMayaDeckPlanWithOpenAI).not.toHaveBeenCalled();
    expect(mocks.generateMayaPitchDraft).not.toHaveBeenCalled();
  });

  it("refuses to generate anything when the owner-only gate rejects", async () => {
    mocks.requireMayaPitchGenerationAccess.mockRejectedValue(
      new Error("La génération de pitch Maya est réservée au rôle owner."),
    );

    await expect(generateMayaPitchDraftForLeadAction("lead-1")).rejects.toThrow(
      "réservée au rôle owner",
    );
    expect(mocks.enhanceMayaDeckPlanWithOpenAI).not.toHaveBeenCalled();
    expect(mocks.generateMayaPitchDraft).not.toHaveBeenCalled();
    expect(mocks.uploadMayaDriveDraftArtifacts).not.toHaveBeenCalled();
  });

  it("cleans up the temporary Drive deck folder after draft generation", async () => {
    const tempDeckRoot = await mkdtemp(
      path.join(os.tmpdir(), "maya-drive-deck-test-"),
    );
    const downloadedDeck = {
      ...makeGenericDeckFile(),
      filePath: path.join(tempDeckRoot, "Qarizmi_Generic.pptx"),
    };
    await writeFile(downloadedDeck.filePath, "fake pptx");
    mocks.hasMayaDriveFolderConfig.mockReturnValue(true);
    mocks.downloadMayaDriveDeckToTemp.mockResolvedValue(downloadedDeck);

    try {
      await generateMayaPitchDraftForLeadAction("lead-1");

      await expect(stat(tempDeckRoot)).rejects.toThrow();
    } finally {
      await rm(tempDeckRoot, { force: true, recursive: true });
    }
  });
});

function makeLead(): CrmLeadSummary {
  return {
    companyName: "HPS",
    contactName: "Abdeslam El-Alawi",
    createdAt: "2026-07-08T00:00:00.000Z",
    id: "lead-1",
    nextAction: "Préparer le pitch",
    notes: "Paiements, switch monétique, LLM local avec Mistral.",
    organizationId: "org-1",
    status: "meeting-booked",
    topic: "IA on Mistral",
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}

function makeGenericDeckFile(): MayaDeckFile {
  return {
    fileName: "Qarizmi_Generic.pptx",
    filePath: "/tmp/Qarizmi_Generic.pptx",
    kind: "generic",
    modifiedAt: new Date("2026-07-08T00:00:00.000Z"),
    sizeBytes: 1_000_000,
  };
}

function makeGenericDeck(): MayaIndexedDeck {
  return {
    ...makeGenericDeckFile(),
    residueWarnings: [],
    slides: [
      {
        section: "presentation",
        slideNumber: 1,
        sourceHash: "presentation",
        text: "Présentation Qarizmi",
        title: "Présentation",
      },
      {
        section: "credentials",
        slideNumber: 20,
        sourceHash: "finance",
        text: "Financial Services paiement scoring",
        title: "Financial Services",
      },
      {
        section: "closing",
        slideNumber: 44,
        sourceHash: "closing",
        text: "Next steps",
        title: "Next steps",
      },
    ],
  };
}
