import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

import type {
  MayaDeckFile,
  MayaDeckKind,
  MayaExtractedSlide,
  MayaIndexedDeck,
  MayaSlideSection,
} from "../contracts";

const parser = new XMLParser({
  ignoreAttributes: false,
  processEntities: true,
});

const knownClientResidues = [
  "AKWA",
  "Econosol",
  "ODM",
  "SPE portfolio",
  "PermisAPoints",
  "Permis a point",
  "Permis à points",
];

export async function listMayaDeckFiles(
  folderPath: string,
): Promise<MayaDeckFile[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const decks = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".pptx"))
      .map(async (entry) => {
        const filePath = path.join(folderPath, entry.name);
        const stats = await stat(filePath);

        return {
          fileName: entry.name,
          filePath,
          kind: inferDeckKind(entry.name),
          modifiedAt: stats.mtime,
          sizeBytes: stats.size,
        } satisfies MayaDeckFile;
      }),
  );

  return decks.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export function findLatestGenericDeck(decks: MayaDeckFile[]) {
  return (
    decks
      .filter((deck) => deck.kind === "generic")
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())[0] ??
    null
  );
}

export async function indexMayaDeck(
  filePath: string,
): Promise<MayaIndexedDeck> {
  const file = await readFile(filePath);
  const zip = unzipSync(new Uint8Array(file));
  const fileName = path.basename(filePath);
  const stats = await stat(filePath);
  const kind = inferDeckKind(fileName);
  const slidePaths = Object.keys(zip)
    .filter((entryPath) => /^ppt\/slides\/slide\d+\.xml$/.test(entryPath))
    .sort((a, b) => slideNumberFromPath(a) - slideNumberFromPath(b));

  const slides = slidePaths.map((slidePath) => {
    const slideNumber = slideNumberFromPath(slidePath);
    const text = extractTextFromXml(new TextDecoder().decode(zip[slidePath]));
    const title = inferSlideTitle(text);
    const section = classifyMayaSlideSection({
      deckKind: kind,
      slideNumber,
      text,
    });

    return {
      section,
      slideNumber,
      sourceHash: hashText(text),
      text,
      title,
    } satisfies MayaExtractedSlide;
  });

  return {
    fileName,
    filePath,
    kind,
    modifiedAt: stats.mtime,
    residueWarnings:
      kind === "generic" ? findGenericResidueWarnings(slides) : [],
    sizeBytes: stats.size,
    slides,
  };
}

export function classifyMayaSlideSection({
  deckKind,
  slideNumber,
  text,
}: {
  deckKind: MayaDeckKind;
  slideNumber: number;
  text: string;
}): MayaSlideSection {
  const normalized = normalize(text);

  if (
    normalized.includes("next steps") ||
    normalized.includes("session de questions")
  ) {
    return "closing";
  }

  if (normalized.includes("annexe") || normalized.includes("appendix")) {
    return "appendix";
  }

  if (
    normalized.includes("credentials") ||
    normalized.includes("case study") ||
    normalized.includes("healthcare") ||
    normalized.includes("financial services") ||
    normalized.includes("industrials")
  ) {
    return "credentials";
  }

  if (deckKind === "generic") {
    if (slideNumber <= 9) return "presentation";
    if (slideNumber <= 14) return "offre";
    if (slideNumber <= 43) return "credentials";
    return "unknown";
  }

  if (slideNumber <= 9) return "presentation";
  if (slideNumber <= 14) return "offre";
  if (slideNumber <= 20) return "credentials";

  return "diagnostic";
}

function inferDeckKind(fileName: string): MayaDeckKind {
  const normalized = fileName.toLocaleLowerCase("fr-FR");
  if (normalized.includes("generic")) return "generic";
  if (/_vf\.pptx$/i.test(fileName)) return "nabil_final";
  if (normalized.includes("vdraft")) return "maya_draft";
  return "example";
}

function extractTextFromXml(xml: string) {
  const parsed = parser.parse(xml);
  const values: string[] = [];
  collectTextNodes(parsed, values);
  return values.join(" ").replace(/\s+/g, " ").trim();
}

function collectTextNodes(value: unknown, values: string[]) {
  if (typeof value === "string" || typeof value === "number") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTextNodes(item, values));
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if ((key === "a:t" || key === "t") && typeof child === "string") {
      values.push(child.trim());
      continue;
    }
    collectTextNodes(child, values);
  }
}

function slideNumberFromPath(slidePath: string) {
  const match = slidePath.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function inferSlideTitle(text: string) {
  return (
    text
      .split(/\s{2,}|\|/)[0]
      ?.trim()
      .slice(0, 180) || "Sans titre"
  );
}

function findGenericResidueWarnings(slides: MayaExtractedSlide[]) {
  const haystack = normalize(slides.map((slide) => slide.text).join(" "));
  return knownClientResidues
    .filter((clientName) => containsNormalizedToken(haystack, clientName))
    .map(
      (clientName) =>
        `Generic deck still contains client residue: ${clientName}`,
    );
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function normalize(text: string) {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ")
    .trim();
}

function containsNormalizedToken(
  normalizedHaystack: string,
  rawNeedle: string,
) {
  const needle = normalize(rawNeedle);
  if (!needle) return false;
  return new RegExp(`(^|\\W)${escapeRegExp(needle)}($|\\W)`, "i").test(
    normalizedHaystack,
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
