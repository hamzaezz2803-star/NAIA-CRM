import { readFile } from "node:fs/promises";

import type { MayaTemplateFamily } from "./contracts";
import {
  buildMayaDraftFileName,
  type MayaPitchStorageAdapter,
  type MayaStoredDraft,
} from "./storage";
import { assertMayaPptxSafeForClone, hashMayaPptx } from "./template";

export type MayaPitchDraftResult = {
  draft: MayaStoredDraft;
  family: MayaTemplateFamily;
  sourceSha256: string;
  targetSha256: string;
};

/**
 * V1 deliberately clones the approved pitch template without touching its
 * OOXML package. Personalization is restricted to the output file name; deck
 * content remains Nabil's exact source format.
 */
export async function generateMayaPitchDraft({
  clientName,
  date = new Date(),
  family,
  forbiddenTokens,
  sourceDeckFilePath,
  storage,
}: {
  clientName: string;
  date?: Date;
  family: MayaTemplateFamily;
  forbiddenTokens?: readonly string[];
  sourceDeckFilePath: string;
  storage: MayaPitchStorageAdapter;
}): Promise<MayaPitchDraftResult> {
  if (family === "commercial-proposal") {
    throw new Error(
      "La famille proposition commerciale reste en validation manuelle : aucun deck n'a été copié.",
    );
  }

  const sourceContent = await readFile(sourceDeckFilePath);
  assertMayaPptxSafeForClone(sourceContent, { forbiddenTokens });

  const draftFileName = buildMayaDraftFileName({ clientName, date });
  const draft = await storage.writeDraft({
    clientName,
    content: sourceContent,
    fileName: draftFileName,
  });
  const writtenContent = await readFile(draft.filePath);

  if (!sourceContent.equals(writtenContent)) {
    throw new Error(
      "La copie locale du PPTX n'est pas identique au modèle source ; l'upload est bloqué.",
    );
  }

  return {
    draft,
    family,
    sourceSha256: hashMayaPptx(sourceContent),
    targetSha256: hashMayaPptx(writtenContent),
  };
}
