import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMayaPitchDeckFixture } from "../test-fixtures";
import {
  findLatestGenericDeck,
  indexMayaDeck,
  listMayaDeckFiles,
} from "./indexer";

describe("Maya PPTX indexer", () => {
  let sourceRoot: string;

  beforeEach(async () => {
    sourceRoot = await mkdtemp(path.join(os.tmpdir(), "maya-indexer-"));
    await createMayaPitchDeckFixture(sourceRoot);
  });

  afterEach(async () => {
    await rm(sourceRoot, { force: true, recursive: true });
  });

  it("lists the pitch generator deck library", async () => {
    const decks = await listMayaDeckFiles(sourceRoot);

    expect(decks.map((deck) => deck.fileName).sort()).toEqual(
      [
        "20260609_Qarizmi_Introduction_Service as a software_Econosol.pptx",
        "20260611_Qarizmi_Introduction_Service as a software_ODM.pptx",
        "20260701_Qarizmi_Introduction_Service as a software_SPE portfolio.pptx",
        "20260706_Qarizmi_Introduction_Service as a software_Permis a point.pptx",
        "20260707_Qarizmi_Introduction_Service as a software_AKWA.pptx",
        "Qarizmi_Introduction_Service as a software_Generic.pptx",
      ].sort(),
    );
  });

  it("identifies and indexes the latest generic deck", async () => {
    const decks = await listMayaDeckFiles(sourceRoot);
    const generic = findLatestGenericDeck(decks);

    expect(generic?.fileName).toBe(
      "Qarizmi_Introduction_Service as a software_Generic.pptx",
    );

    const indexed = await indexMayaDeck(generic!.filePath);

    expect(indexed.kind).toBe("generic");
    expect(indexed.slides).toHaveLength(44);
    expect(indexed.slides[0]).toMatchObject({
      section: "presentation",
      slideNumber: 1,
    });
    expect(indexed.slides[15]).toMatchObject({
      section: "credentials",
      slideNumber: 16,
    });
    expect(indexed.slides[43]).toMatchObject({
      section: "closing",
      slideNumber: 44,
    });
    expect(indexed.residueWarnings).not.toContain(
      "Generic deck still contains client residue: SPE",
    );
  });

  it("extracts client diagnostic slides", async () => {
    const decks = await listMayaDeckFiles(sourceRoot);
    const akwa = decks.find((deck) => deck.fileName.includes("AKWA"));
    const indexed = await indexMayaDeck(akwa!.filePath);

    expect(indexed.kind).toBe("example");
    expect(
      indexed.slides.some(
        (slide) =>
          slide.section === "diagnostic" &&
          slide.text.includes("premier groupe marocain piloté par la donnée"),
      ),
    ).toBe(true);
  });
});
