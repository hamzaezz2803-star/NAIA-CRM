import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateMayaPitchDraft } from "./generator";
import {
  findLatestGenericDeck,
  indexMayaDeck,
  listMayaDeckFiles,
} from "./pptx";
import { buildMayaDeckPlan } from "./planning";
import { createLocalMayaPitchStorageAdapter } from "./storage";
import { createMayaPitchDeckFixture } from "./test-fixtures";

describe("Maya pitch draft generator", () => {
  let sourceRoot: string;
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "maya-generator-"));
    sourceRoot = await mkdtemp(path.join(os.tmpdir(), "maya-source-"));
    await createMayaPitchDeckFixture(sourceRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
    await rm(sourceRoot, { force: true, recursive: true });
  });

  it("generates an editable PPTX draft and manifest", async () => {
    const decks = await listMayaDeckFiles(sourceRoot);
    const genericFile = findLatestGenericDeck(decks)!;
    const genericDeck = await indexMayaDeck(genericFile.filePath);
    const plan = buildMayaDeckPlan({
      brief: {
        clientName: "HPS",
        clientType: "single-company",
        crmContext: "Paiements, switch monétique, LLM local avec Mistral.",
        missingQuestions: [],
        status: "ready",
        websiteUrl: "https://www.hps-worldwide.com/",
      },
      genericDeck,
      learningEvents: [],
    });

    const result = await generateMayaPitchDraft({
      date: new Date("2026-07-08T00:00:00.000Z"),
      genericDeckFilePath: genericFile.filePath,
      plan,
      storage: createLocalMayaPitchStorageAdapter(tempRoot),
    });

    expect(result.draft.fileName).toBe(
      "20260708_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
    );
    expect((await stat(result.draft.filePath)).size).toBeGreaterThan(1_000);
    expect(result.manifestPath).toBe(
      path.join(tempRoot, "HPS", "Pitch", "maya-generation-manifest.json"),
    );

    const manifest = JSON.parse(
      await readFile(result.manifestPath, "utf8"),
    ) as {
      draftFileName: string;
      plan: { diagnosticOutline: string[] };
    };

    expect(manifest.draftFileName).toBe(result.draft.fileName);
    expect(manifest.plan.diagnosticOutline.length).toBeGreaterThan(0);

    const draftDeck = await indexMayaDeck(result.draft.filePath);
    expect(draftDeck.slides.length).toBeLessThan(genericDeck.slides.length);
    expect(draftDeck.slides.map((slide) => slide.text).join(" ")).toContain(
      "Preliminary Diagnostic - HPS",
    );
    expect(draftDeck.slides.map((slide) => slide.text).join(" ")).toContain(
      "Layer RAG",
    );
  });

  it("uses model-proposed use cases when the deck plan provides them", async () => {
    const decks = await listMayaDeckFiles(sourceRoot);
    const genericFile = findLatestGenericDeck(decks)!;
    const genericDeck = await indexMayaDeck(genericFile.filePath);
    const plan = buildMayaDeckPlan({
      brief: {
        clientName: "HPS",
        clientType: "single-company",
        crmContext: "Paiements, switch monétique, LLM local avec Mistral.",
        missingQuestions: [],
        status: "ready",
      },
      genericDeck,
      learningEvents: [],
    });

    const result = await generateMayaPitchDraft({
      date: new Date("2026-07-08T00:00:00.000Z"),
      genericDeckFilePath: genericFile.filePath,
      plan: {
        ...plan,
        useCaseBullets: [
          "OpenAI use case spécifique: agent conformité paiements HPS.",
        ],
      },
      storage: createLocalMayaPitchStorageAdapter(tempRoot),
    });

    const draftDeck = await indexMayaDeck(result.draft.filePath);
    expect(draftDeck.slides.map((slide) => slide.text).join(" ")).toContain(
      "agent conformité paiements HPS",
    );
  });
});
