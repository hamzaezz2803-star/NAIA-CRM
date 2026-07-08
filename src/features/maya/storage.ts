import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type MayaStoredDraft = {
  fileName: string;
  filePath: string;
  fileUrl?: string;
};

export type MayaPitchStorageAdapter = {
  writeDraft(input: {
    clientName: string;
    content: Buffer;
    fileName: string;
  }): Promise<MayaStoredDraft>;
};

export function sanitizeMayaClientName(clientName: string) {
  return clientName
    .trim()
    .replace(/[/:*?"<>|]+/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+/g, " - ")
    .slice(0, 120);
}

export function buildMayaDraftFileName({
  clientName,
  date,
}: {
  clientName: string;
  date: Date;
}) {
  const yyyymmdd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");

  return `${yyyymmdd}_Qarizmi_Introduction_Service as a software_${sanitizeMayaClientName(
    clientName,
  )}_vDraft.pptx`;
}

export function isNabilFinalPitchFileName(fileName: string) {
  return /_vF\.pptx$/i.test(fileName);
}

export function createLocalMayaPitchStorageAdapter(
  rootPath: string,
): MayaPitchStorageAdapter {
  return {
    async writeDraft({ clientName, content, fileName }) {
      const pitchFolder = path.join(
        rootPath,
        sanitizeMayaClientName(clientName),
        "Pitch",
      );
      await mkdir(pitchFolder, { recursive: true });
      const filePath = path.join(pitchFolder, fileName);
      await writeFile(filePath, content);
      return {
        fileName,
        filePath,
      };
    },
  };
}
