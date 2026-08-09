import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateMayaPitchDraft } from "./generator";
import { findLatestGenericDeck, listMayaDeckFiles } from "./pptx";
import { createLocalMayaPitchStorageAdapter } from "./storage";
import { createMayaPitchDeckFixture } from "./test-fixtures";
import { hashMayaPptx } from "./template";

describe("Maya faithful pitch clone", () => {
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

  it("copies the source PPTX byte-for-byte and changes only the file name", async () => {
    const decks = await listMayaDeckFiles(sourceRoot);
    const source = findLatestGenericDeck(decks)!;
    const sourceContent = await readFile(source.filePath);

    const result = await generateMayaPitchDraft({
      clientName: "HPS",
      date: new Date("2026-08-09T00:00:00.000Z"),
      expectedSourceSha256: hashMayaPptx(sourceContent),
      family: "pitch",
      sourceDeckFilePath: source.filePath,
      storage: createLocalMayaPitchStorageAdapter(tempRoot),
    });

    expect(result.draft.fileName).toBe(
      "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
    );
    expect(result.draft.filePath).toBe(
      path.join(tempRoot, "HPS", "01_Pitch", result.draft.fileName),
    );
    expect(await readFile(result.draft.filePath)).toEqual(sourceContent);
    expect(result.sourceSha256).toBe(result.targetSha256);
  });

  it("blocks a source deck with client residue before writing a draft", async () => {
    const decks = await listMayaDeckFiles(sourceRoot);
    const source = decks.find((deck) => deck.fileName.includes("AKWA"))!;
    const sourceContent = await readFile(source.filePath);

    await expect(
      generateMayaPitchDraft({
        clientName: "HPS",
        expectedSourceSha256: hashMayaPptx(sourceContent),
        family: "pitch",
        sourceDeckFilePath: source.filePath,
        storage: createLocalMayaPitchStorageAdapter(tempRoot),
      }),
    ).rejects.toThrow("résidus client interdits");
  });

  it("keeps commercial proposals behind manual review", async () => {
    await expect(
      generateMayaPitchDraft({
        clientName: "HPS",
        expectedSourceSha256: "a".repeat(64),
        family: "commercial-proposal",
        sourceDeckFilePath: "/not/read.pptx",
        storage: createLocalMayaPitchStorageAdapter(tempRoot),
      }),
    ).rejects.toThrow("validation manuelle");
  });

  it("blocks a changed template revision before writing a draft", async () => {
    const decks = await listMayaDeckFiles(sourceRoot);
    const source = findLatestGenericDeck(decks)!;

    await expect(
      generateMayaPitchDraft({
        clientName: "HPS",
        expectedSourceSha256: "0".repeat(64),
        family: "pitch",
        sourceDeckFilePath: source.filePath,
        storage: createLocalMayaPitchStorageAdapter(tempRoot),
      }),
    ).rejects.toThrow("SHA-256 audité");
  });
});
