import { createHash } from "node:crypto";

import { strFromU8, unzipSync } from "fflate";

import type { MayaDeckFile, MayaTemplateFamily } from "./contracts";

const OOXML_TEXT_PART = /(?:\.xml|\.rels)$/i;
const PITCH_FILE_NAME =
  /qarizmi[_\s-]*introduction[_\s-]*service as a software/i;
const COMMERCIAL_PROPOSAL_FILE_NAME =
  /(?:proposition[_\s-]*commerciale|commercial[_\s-]*proposal)/i;
const NON_TEMPLATE_FILE_NAME = /(?:_old|_vdraft|_vf\.pptx$|generic)/i;

export const DEFAULT_MAYA_FORBIDDEN_CLIENT_TOKENS = [
  "TGCC",
  "Orange",
  "AKWA",
  "Econosol",
  "ODM",
  "SPE portfolio",
  "SPE Capital",
  "PermisAPoints",
  "Permis a point",
  "Permis à points",
  "JLL",
] as const;

export type MayaTemplateCandidate = MayaDeckFile & {
  driveFileId?: string;
  mimeType?: string;
  webViewLink?: string;
};

export type MayaPptxResidueFinding = {
  parts: string[];
  token: string;
};

export function classifyMayaTemplateFamily(
  fileName: string,
): MayaTemplateFamily | null {
  if (COMMERCIAL_PROPOSAL_FILE_NAME.test(fileName)) {
    return "commercial-proposal";
  }
  if (PITCH_FILE_NAME.test(fileName)) return "pitch";
  return null;
}

export function selectLatestMayaTemplateCandidate({
  approvedDriveFileId,
  candidates,
  family,
}: {
  approvedDriveFileId?: string;
  candidates: MayaTemplateCandidate[];
  family: MayaTemplateFamily;
}) {
  const eligible = candidates.filter((candidate) => {
    if (approvedDriveFileId && candidate.driveFileId !== approvedDriveFileId) {
      return false;
    }

    return (
      classifyMayaTemplateFamily(candidate.fileName) === family &&
      !NON_TEMPLATE_FILE_NAME.test(
        `${candidate.filePath}/${candidate.fileName}`,
      )
    );
  });

  return (
    eligible.sort(
      (left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime(),
    )[0] ?? null
  );
}

export function scanMayaPptxResidues(
  content: Buffer,
  {
    forbiddenTokens = DEFAULT_MAYA_FORBIDDEN_CLIENT_TOKENS,
  }: {
    forbiddenTokens?: readonly string[];
  } = {},
): MayaPptxResidueFinding[] {
  const zip = readPptxZip(content);
  const partsByToken = new Map<string, Set<string>>();

  for (const [partName, partContent] of Object.entries(zip)) {
    for (const token of forbiddenTokens) {
      if (containsNormalizedToken(normalizeSearchText(partName), token)) {
        addResiduePart(partsByToken, token, partName);
      }
    }

    if (partName !== "[Content_Types].xml" && !OOXML_TEXT_PART.test(partName)) {
      continue;
    }

    const xml = strFromU8(partContent);
    const searchableVariants = buildSearchableXmlVariants(xml);

    for (const token of forbiddenTokens) {
      if (
        searchableVariants.some((variant) =>
          containsNormalizedToken(variant, token),
        )
      ) {
        addResiduePart(partsByToken, token, partName);
      }
    }
  }

  return [...partsByToken.entries()]
    .map(([token, parts]) => ({
      parts: [...parts].sort(),
      token,
    }))
    .sort((left, right) => left.token.localeCompare(right.token, "fr"));
}

function addResiduePart(
  partsByToken: Map<string, Set<string>>,
  token: string,
  partName: string,
) {
  const parts = partsByToken.get(token) ?? new Set<string>();
  parts.add(partName);
  partsByToken.set(token, parts);
}

export function assertMayaPptxSafeForClone(
  content: Buffer,
  options: { forbiddenTokens?: readonly string[] } = {},
) {
  const findings = scanMayaPptxResidues(content, options);
  if (!findings.length) return;

  const summary = findings
    .map(
      (finding) =>
        `${finding.token} (${finding.parts.slice(0, 3).join(", ")}${
          finding.parts.length > 3 ? ", …" : ""
        })`,
    )
    .join("; ");

  throw new Error(
    `Le modèle PPTX contient des résidus client interdits : ${summary}. La copie est bloquée pour validation manuelle.`,
  );
}

export function hashMayaPptx(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function readPptxZip(content: Buffer) {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(new Uint8Array(content));
  } catch {
    throw new Error("Le fichier source n'est pas un PPTX OOXML valide.");
  }

  if (!zip["[Content_Types].xml"] || !zip["ppt/presentation.xml"]) {
    throw new Error(
      "Le fichier source ne contient pas une présentation PPTX complète.",
    );
  }

  return zip;
}

function buildSearchableXmlVariants(xml: string) {
  return [
    normalizeSearchText(xml),
    normalizeSearchText(xml.replace(/<[^>]+>/g, " ")),
    normalizeSearchText(xml.replace(/<[^>]+>/g, "")),
  ];
}

function containsNormalizedToken(haystack: string, rawNeedle: string) {
  const needle = normalizeSearchText(rawNeedle);
  if (!needle) return false;

  const tokenPattern = escapeRegExp(needle);
  const boundaryPattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${tokenPattern}($|[^\\p{L}\\p{N}])`,
    "u",
  );
  if (boundaryPattern.test(haystack)) return true;

  const compactHaystack = haystack.replace(/\s+/g, "");
  const compactNeedle = needle.replace(/\s+/g, "");
  return compactNeedle.length >= 4 && compactHaystack.includes(compactNeedle);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
