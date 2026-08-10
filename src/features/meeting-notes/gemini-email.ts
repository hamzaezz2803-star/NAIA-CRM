import type { GmailMeetingNoteMessage } from "@/platform/integrations/google-workspace";

export type ParsedGeminiMeetingNote = {
  documentFileId?: string;
  documentText?: string;
  documentUrl?: string;
  externalMessageId: string;
  externalThreadId?: string;
  notesMarkdown: string;
  occurredAt?: string;
  recordingUrl?: string;
  senderEmail: string;
  title: string;
};

export type GeminiMeetingMatchCandidate = {
  id: string;
  startsAt?: string;
  title: string;
};

const GOOGLE_DOC_PATTERN =
  /https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)(?:\/[^\s)\]<>]*)?/gu;
const GOOGLE_RECORDING_PATTERN =
  /https:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+(?:\/[^\s)\]<>]*)?/gu;

export function parseGeminiMeetingNoteMessage(
  message: GmailMeetingNoteMessage,
): ParsedGeminiMeetingNote | undefined {
  const title = extractMeetingTitle(message.subject ?? "", message.bodyText);
  const notesMarkdown = extractMeetingNotes(message.bodyText);
  if (!title || !notesMarkdown) return undefined;

  const documentUrl = firstUrl(message.bodyText, GOOGLE_DOC_PATTERN);
  const recordingUrl = firstUrl(message.bodyText, GOOGLE_RECORDING_PATTERN);
  const occurredAt = parseMessageDate(message.date);

  return {
    documentFileId: documentUrl?.match(/\/document\/d\/([a-zA-Z0-9_-]+)/u)?.[1],
    documentUrl,
    documentText: message.documentText?.trim().slice(0, 1_500_000) || undefined,
    externalMessageId: message.id,
    externalThreadId: message.threadId,
    notesMarkdown,
    occurredAt,
    recordingUrl,
    senderEmail: message.senderEmail,
    title,
  };
}

export function matchGeminiNoteToMeeting(
  note: Pick<ParsedGeminiMeetingNote, "occurredAt" | "title">,
  meetings: GeminiMeetingMatchCandidate[],
) {
  const ranked = meetings
    .map((meeting) => ({ meeting, score: scoreMeetingMatch(note, meeting) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.score < 30) return undefined;
  if (runnerUp && best.score - runnerUp.score < 8) return undefined;
  return best.meeting.id;
}

function scoreMeetingMatch(
  note: Pick<ParsedGeminiMeetingNote, "occurredAt" | "title">,
  meeting: GeminiMeetingMatchCandidate,
) {
  const noteTitle = normalizeMatchText(note.title);
  const meetingTitle = normalizeMatchText(meeting.title);
  const noteTokens = meaningfulTokens(noteTitle);
  const meetingTokens = new Set(meaningfulTokens(meetingTitle));
  const sharedTokens = noteTokens.filter((token) => meetingTokens.has(token));
  const overlap = noteTokens.length
    ? sharedTokens.length / noteTokens.length
    : 0;
  const exact = noteTitle.length >= 4 && noteTitle === meetingTitle;
  const contained =
    noteTitle.length >= 8 &&
    meetingTitle.length >= 8 &&
    (noteTitle.includes(meetingTitle) || meetingTitle.includes(noteTitle));

  let score = exact
    ? 60
    : contained
      ? 42
      : overlap >= 0.75
        ? 34
        : overlap >= 0.5
          ? 20
          : 0;
  const noteTime = note.occurredAt
    ? new Date(note.occurredAt).getTime()
    : Number.NaN;
  const meetingTime = meeting.startsAt
    ? new Date(meeting.startsAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(noteTime) || !Number.isFinite(meetingTime)) return 0;
  const hours = Math.abs(noteTime - meetingTime) / 3_600_000;
  if (hours <= 8) score += 20;
  else if (hours <= 30) score += 12;
  else if (hours <= 72) score += 4;
  else score = 0;

  return score;
}

function extractMeetingTitle(subject: string, body: string) {
  const bodyFirstLine = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  const bodyTitle = bodyFirstLine?.match(
    /^(?:notes\s+(?:de|from))\s+["“”«]?(.+?)["“”»]?$/iu,
  )?.[1];
  if (bodyTitle) return cleanTitle(bodyTitle);

  const quoted = subject.match(/["“«](.+?)["”»]/u)?.[1];
  if (quoted) return cleanTitle(quoted);

  return cleanTitle(
    subject
      .replace(/^notes\s*:\s*/iu, "")
      .replace(
        /\s+(?:\d{1,2}\s+\p{L}+\s+\d{4}|[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})$/u,
        "",
      ),
  );
}

function extractMeetingNotes(body: string) {
  const normalized = body
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const section = normalized.match(/(?:^|\n)(Résumé|Summary)\s*\n/iu);
  const start = section?.index ?? 0;
  const endMarkers = [
    /\nLa section ["“]Étapes suivantes/iu,
    /\nWas the ["“]Next steps/iu,
    /\nGoogle LLC,/iu,
    /\nVous avez reçu cet e-mail/iu,
    /\nYou received this email/iu,
  ];
  let value = normalized.slice(start).trim();
  for (const marker of endMarkers) {
    const match = value.match(marker);
    if (match?.index !== undefined) value = value.slice(0, match.index).trim();
  }

  return value
    .replace(GOOGLE_DOC_PATTERN, "")
    .replace(GOOGLE_RECORDING_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 250_000);
}

function firstUrl(value: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  const result = pattern.exec(value)?.[0];
  pattern.lastIndex = 0;
  if (!result) return undefined;
  try {
    const url = new URL(result);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function parseMessageDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function cleanTitle(value: string) {
  return value
    .replace(/^["“”«»]+|["“”«»]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function normalizeMatchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string) {
  return value
    .split(" ")
    .filter((token) => token.length >= 3 && !MATCH_STOP_WORDS.has(token));
}

const MATCH_STOP_WORDS = new Set([
  "avec",
  "meeting",
  "meet",
  "qarizmi",
  "reunion",
  "the",
  "with",
]);
