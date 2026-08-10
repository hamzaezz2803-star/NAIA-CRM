import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildMayaDraftFileName,
  createLocalMayaPitchStorageAdapter,
  isNabilFinalPitchFileName,
  sanitizeMayaClientName,
} from "./storage";

describe("Maya pitch storage", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "maya-storage-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  it("sanitizes client names without making them ugly", () => {
    expect(sanitizeMayaClientName("HPS")).toBe("HPS");
    expect(sanitizeMayaClientName("AKWA Group / Afriquia")).toBe(
      "AKWA Group - Afriquia",
    );
  });

  it("builds draft and final names", () => {
    expect(
      buildMayaDraftFileName({
        clientName: "HPS",
        date: new Date("2026-07-08T00:00:00.000Z"),
      }),
    ).toBe(
      "20260708_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
    );

    expect(
      isNabilFinalPitchFileName(
        "20260708_Qarizmi_Introduction_Service as a software_HPS_vF.pptx",
      ),
    ).toBe(true);
    expect(isNabilFinalPitchFileName("HPS_vDraft.pptx")).toBe(false);
  });

  it("creates client 01_Pitch folders and writes a draft", async () => {
    const adapter = createLocalMayaPitchStorageAdapter(tempRoot);
    const result = await adapter.writeDraft({
      clientName: "HPS",
      content: Buffer.from("pptx-binary"),
      fileName: "draft.pptx",
    });

    expect(result.filePath).toBe(
      path.join(tempRoot, "HPS", "01_Pitch", "draft.pptx"),
    );
    expect(await readFile(result.filePath, "utf8")).toBe("pptx-binary");
    await expect(
      stat(path.join(tempRoot, "HPS", "01_Pitch")),
    ).resolves.toBeTruthy();
  });
});
