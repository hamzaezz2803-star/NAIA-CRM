import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadMayaDriveDeckToTemp: vi.fn(),
  hasMayaDriveFolderConfig: vi.fn(),
  indexMayaDeck: vi.fn(),
  listMayaDriveDeckFiles: vi.fn(),
}));

vi.mock("@/features/maya/drive", () => ({
  downloadMayaDriveDeckToTemp: mocks.downloadMayaDriveDeckToTemp,
  hasMayaDriveFolderConfig: mocks.hasMayaDriveFolderConfig,
  listMayaDriveDeckFiles: mocks.listMayaDriveDeckFiles,
}));

vi.mock("@/features/maya/pptx", () => ({
  indexMayaDeck: mocks.indexMayaDeck,
}));

import { loadNaiaPrivateKnowledge } from "./private-knowledge";

describe("NAIA private knowledge Drive loader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("stays private and refreshes its cache when the Drive deck changes", async () => {
    vi.stubEnv("MAYA_DRIVE_SOURCE_FOLDER_ID", "pitch-library-id");
    mocks.hasMayaDriveFolderConfig.mockReturnValue(true);
    let modifiedAt = new Date("2026-07-13T10:00:00.000Z");
    mocks.listMayaDriveDeckFiles.mockImplementation(async () => [
      {
        driveFileId: "generic-drive-file",
        fileName: "Qarizmi_Generic.pptx",
        filePath: "gdrive:generic-drive-file",
        kind: "generic",
        modifiedAt,
        sizeBytes: 5_000_000,
      },
    ]);
    mocks.downloadMayaDriveDeckToTemp.mockImplementation(async () => ({
      driveFileId: "generic-drive-file",
      fileName: "Qarizmi_Generic.pptx",
      filePath: `/tmp/naia-private-knowledge-${modifiedAt.getTime()}/generic.pptx`,
      kind: "generic",
      modifiedAt,
      sizeBytes: 5_000_000,
    }));
    mocks.indexMayaDeck.mockImplementation(async (filePath: string) => ({
      fileName: "Qarizmi_Generic.pptx",
      filePath,
      kind: "generic",
      modifiedAt,
      residueWarnings: [],
      sizeBytes: 5_000_000,
      slides: [
        {
          section: "presentation",
          slideNumber: 5,
          sourceHash: "founders",
          text: "Ali El Abbassy — Co- founder, Head of Technology. Nabil Jamal Eddine — Co- founder, Head of Strategy.",
          title: "Nos profils",
        },
      ],
    }));
    const actor = {
      email: "ali@qarizmi.com",
      name: "Ali El Abbassy",
      role: "owner" as const,
    };

    const shared = await loadNaiaPrivateKnowledge({
      actor,
      allowPersonalData: false,
      command: "Que sais-tu sur Qarizmi ?",
    });
    expect(shared).toBeUndefined();
    expect(mocks.listMayaDriveDeckFiles).not.toHaveBeenCalled();

    const nonCofounder = await loadNaiaPrivateKnowledge({
      actor: { ...actor, email: "hamza@qarizmi.com" },
      allowPersonalData: true,
      command: "Que sais-tu sur Qarizmi ?",
    });
    const nonOwner = await loadNaiaPrivateKnowledge({
      actor: { ...actor, role: "member" },
      allowPersonalData: true,
      command: "Que sais-tu sur Qarizmi ?",
    });
    expect(nonCofounder).toBeUndefined();
    expect(nonOwner).toBeUndefined();
    expect(mocks.listMayaDriveDeckFiles).not.toHaveBeenCalled();

    const first = await loadNaiaPrivateKnowledge({
      actor,
      allowPersonalData: true,
      command: "Que sais-tu sur moi ?",
    });
    const second = await loadNaiaPrivateKnowledge({
      actor,
      allowPersonalData: true,
      command: "Que sais-tu sur moi ?",
    });
    expect(first?.actorProfile).toContain("Head of Technology");
    expect(second?.sourceModifiedAt).toBe("2026-07-13T10:00:00.000Z");
    expect(mocks.downloadMayaDriveDeckToTemp).toHaveBeenCalledTimes(1);
    expect(mocks.indexMayaDeck).toHaveBeenCalledTimes(1);

    modifiedAt = new Date("2026-07-14T08:00:00.000Z");
    const refreshed = await loadNaiaPrivateKnowledge({
      actor,
      allowPersonalData: true,
      command: "Que sais-tu sur moi ?",
    });
    expect(refreshed?.sourceModifiedAt).toBe("2026-07-14T08:00:00.000Z");
    expect(mocks.downloadMayaDriveDeckToTemp).toHaveBeenCalledTimes(2);
    expect(mocks.indexMayaDeck).toHaveBeenCalledTimes(2);
  });
});
