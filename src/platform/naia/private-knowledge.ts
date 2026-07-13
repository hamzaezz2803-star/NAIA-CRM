import "server-only";

import { rm } from "node:fs/promises";
import path from "node:path";

import type {
  MayaExtractedSlide,
  MayaIndexedDeck,
} from "@/features/maya/contracts";
import {
  downloadMayaDriveDeckToTemp,
  hasMayaDriveFolderConfig,
  listMayaDriveDeckFiles,
} from "@/features/maya/drive";
import { canUseMayaPitchGeneratorEmail } from "@/features/maya/access-policy";
import { indexMayaDeck } from "@/features/maya/pptx";

const KNOWLEDGE_LOAD_TIMEOUT_MS = 5_000;
const MAX_SNIPPETS = 4;
const MAX_SNIPPET_CHARACTERS = 1_600;
const MAX_TOTAL_CHARACTERS = 5_200;

type KnowledgeActor = {
  email: string;
  name: string;
  role: "owner" | "admin" | "member" | "viewer";
};

export type NaiaPrivateKnowledgeSnippet = {
  section: string;
  slideNumber: number;
  text: string;
};

export type NaiaPrivateKnowledgeContext = {
  actorProfile?: string;
  snippets: NaiaPrivateKnowledgeSnippet[];
  sourceFileName: string;
  sourceModifiedAt: string;
};

type CachedDeck = {
  cacheKey: string;
  deck: MayaIndexedDeck;
};

let cachedDeck: CachedDeck | null = null;
let inFlightDeck: {
  cacheKey: string;
  promise: Promise<MayaIndexedDeck>;
} | null = null;

/**
 * Reads the latest generic deck from the cofounders-only Drive and returns a
 * bounded, query-relevant context. The source deck stays in Drive: nothing
 * from it is persisted in Git, Supabase, logs, or conversation history.
 */
export async function loadNaiaPrivateKnowledge({
  actor,
  allowPersonalData,
  command,
}: {
  actor?: KnowledgeActor;
  allowPersonalData: boolean;
  command: string;
}): Promise<NaiaPrivateKnowledgeContext | undefined> {
  if (
    !actor ||
    !allowPersonalData ||
    actor.role !== "owner" ||
    !canUseMayaPitchGeneratorEmail(actor.email) ||
    !hasMayaDriveFolderConfig()
  ) {
    return undefined;
  }

  try {
    return await withDeadline(
      loadKnowledgeFromLatestDeck(actor, command),
      KNOWLEDGE_LOAD_TIMEOUT_MS,
    );
  } catch {
    // Knowledge enriches answers but must never block NAIA's core CRM,
    // Calendar, Gmail, or approval flows when Drive is slow or unavailable.
    return undefined;
  }
}

export function buildNaiaPrivateKnowledgeContext({
  actor,
  command,
  deck,
  sourceModifiedAt = deck.modifiedAt,
}: {
  actor: KnowledgeActor;
  command: string;
  deck: MayaIndexedDeck;
  sourceModifiedAt?: Date;
}): NaiaPrivateKnowledgeContext {
  return {
    actorProfile: shouldIncludeActorProfile(command)
      ? findActorProfile(deck.slides, actor)
      : undefined,
    snippets: selectRelevantSnippets(deck.slides, command),
    sourceFileName: deck.fileName,
    sourceModifiedAt: sourceModifiedAt.toISOString(),
  };
}

function shouldIncludeActorProfile(command: string) {
  const normalized = normalize(command);
  return [
    "qui suis je",
    "que sais tu sur moi",
    "qu est ce que tu sais sur moi",
    "mon parcours",
    "mon profil",
    "my background",
    "my profile",
    "what do you know about me",
    "who am i",
  ].some((phrase) => normalized.includes(phrase));
}

async function loadKnowledgeFromLatestDeck(
  actor: KnowledgeActor,
  command: string,
) {
  const decks = await listMayaDriveDeckFiles({
    sourceFolderId: process.env.MAYA_DRIVE_SOURCE_FOLDER_ID!.trim(),
  });
  const genericDeck = decks
    .filter((deck) => deck.kind === "generic")
    .sort(
      (left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime(),
    )[0];

  if (!genericDeck) return undefined;

  const cacheKey = [
    genericDeck.driveFileId,
    genericDeck.modifiedAt.toISOString(),
    genericDeck.sizeBytes,
  ].join(":");
  const indexedDeck = await getIndexedDeck(genericDeck, cacheKey);

  return buildNaiaPrivateKnowledgeContext({
    actor,
    command,
    deck: indexedDeck,
    sourceModifiedAt: genericDeck.modifiedAt,
  });
}

async function getIndexedDeck(
  genericDeck: Awaited<ReturnType<typeof listMayaDriveDeckFiles>>[number],
  cacheKey: string,
) {
  if (cachedDeck?.cacheKey === cacheKey) return cachedDeck.deck;
  if (inFlightDeck?.cacheKey === cacheKey) return inFlightDeck.promise;

  const promise = (async () => {
    const downloaded = await downloadMayaDriveDeckToTemp(genericDeck);
    try {
      return await indexMayaDeck(downloaded.filePath);
    } finally {
      await rm(path.dirname(downloaded.filePath), {
        force: true,
        recursive: true,
      });
    }
  })();

  inFlightDeck = { cacheKey, promise };
  try {
    const deck = await promise;
    cachedDeck = { cacheKey, deck };
    return deck;
  } finally {
    if (inFlightDeck?.cacheKey === cacheKey) inFlightDeck = null;
  }
}

function findActorProfile(slides: MayaExtractedSlide[], actor: KnowledgeActor) {
  const actorTokens = actorIdentityTokens(actor);
  const ranked = slides
    .map((slide) => {
      const slideTokens = new Set(meaningfulTokens(slide.text));
      return {
        score:
          actorTokens.reduce(
            (total, token) => total + (slideTokens.has(token) ? 3 : 0),
            0,
          ) + (normalize(slide.text).includes("co founder") ? 4 : 0),
        slide,
      };
    })
    .sort((left, right) => right.score - left.score);
  const profileSlide = ranked[0];

  if (!profileSlide || profileSlide.score < 7) return undefined;

  return extractActorSegment(profileSlide.slide.text, actor).slice(
    0,
    MAX_SNIPPET_CHARACTERS,
  );
}

function extractActorSegment(text: string, actor: KnowledgeActor) {
  const actorTokens = actorIdentityTokens(actor);
  const actorNamePattern = actor.name
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  const actorMatch = actorNamePattern
    ? new RegExp(actorNamePattern, "iu").exec(text)
    : null;
  const founderPattern =
    /\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){1,4}\s+—\s+Co-\s*founder/gu;
  const founderMatches = Array.from(text.matchAll(founderPattern));
  const tokenMatchedFounder = founderMatches
    .map((match) => ({
      match,
      score: actorTokens.filter((token) => normalize(match[0]).includes(token))
        .length,
    }))
    .sort((left, right) => right.score - left.score)[0];
  const matchedFounder =
    tokenMatchedFounder && tokenMatchedFounder.score > 0
      ? tokenMatchedFounder.match
      : undefined;
  const actorStart = actorMatch?.index ?? matchedFounder?.index;
  if (actorStart === undefined) return "";
  const nextFounder = founderMatches.find(
    (match) => (match.index ?? 0) > actorStart + (actorMatch?.[0].length ?? 0),
  );
  const segment = text.slice(actorStart, nextFounder?.index ?? text.length);

  return cleanSlideText(segment);
}

function actorIdentityTokens(actor: KnowledgeActor) {
  return meaningfulTokens(
    `${actor.name} ${actor.email.split("@")[0] ?? ""}`,
  ).filter((token) => !ACTOR_TOKEN_STOP_WORDS.has(token));
}

function selectRelevantSnippets(
  slides: MayaExtractedSlide[],
  command: string,
): NaiaPrivateKnowledgeSnippet[] {
  const queryTokens = meaningfulTokens(command);
  const ranked = slides
    .filter(
      (slide) =>
        ["presentation", "offre", "credentials"].includes(slide.section) &&
        cleanSlideText(slide.text).length >= 80 &&
        !normalize(slide.text).startsWith("agenda"),
    )
    .map((slide) => ({ ...scoreSlide(slide, queryTokens), slide }))
    .filter(({ matchedQuery }) => matchedQuery)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.slide.slideNumber - right.slide.slideNumber,
    );

  const snippets: NaiaPrivateKnowledgeSnippet[] = [];
  let totalCharacters = 0;
  for (const { slide } of ranked) {
    if (snippets.length >= MAX_SNIPPETS) break;
    const text = cleanSlideText(slide.text).slice(0, MAX_SNIPPET_CHARACTERS);
    if (totalCharacters + text.length > MAX_TOTAL_CHARACTERS) continue;
    snippets.push({
      section: slide.section,
      slideNumber: slide.slideNumber,
      text,
    });
    totalCharacters += text.length;
  }

  return snippets;
}

function scoreSlide(slide: MayaExtractedSlide, queryTokens: string[]) {
  const normalizedText = normalize(slide.text);
  const textTokens = new Set(meaningfulTokens(normalizedText));
  let score = slide.section === "presentation" ? 3 : 1;
  let matchedQuery = false;

  for (const token of queryTokens) {
    if (textTokens.has(token)) {
      matchedQuery = true;
      score += token.length >= 6 ? 8 : 4;
      continue;
    }

    if (
      token.length >= 6 &&
      Array.from(textTokens).some((textToken) =>
        textToken.startsWith(token.slice(0, 6)),
      )
    ) {
      matchedQuery = true;
      score += 7;
    }
  }

  if (normalizedText.includes("qarizmi est nee")) score += 3;
  if (normalizedText.includes("presentation de qarizmi")) score += 3;
  if (normalizedText.includes("offre structuree")) score += 3;
  if (normalizedText.includes("nos profils")) score += 2;

  return { matchedQuery, score };
}

function meaningfulTokens(value: string) {
  return normalize(value)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token),
    );
}

function cleanSlideText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+\d{1,2}$/, "")
    .trim();
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const STOP_WORDS = new Set([
  "avec",
  "dans",
  "des",
  "est",
  "les",
  "mais",
  "ma",
  "mes",
  "mon",
  "moi",
  "nos",
  "notre",
  "nous",
  "our",
  "pour",
  "que",
  "quel",
  "quels",
  "quelle",
  "quelles",
  "qui",
  "sur",
  "the",
  "what",
  "with",
  "you",
  "your",
  "vos",
  "votre",
]);

const ACTOR_TOKEN_STOP_WORDS = new Set([
  "cofounder",
  "correspondance",
  "founder",
  "profil",
  "profile",
  "sans",
]);
