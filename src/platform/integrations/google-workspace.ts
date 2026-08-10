import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  resolveGoogleCredentialActor,
  type GoogleCredentialActor,
  type GoogleWorkspaceContext,
} from "./google-credential-boundary";
import { attestGoogleAccessToken } from "./google-token-attestation";
import {
  attestGoogleScopes,
  canReadGoogleMeetingDocuments,
  GOOGLE_MEETING_NOTE_SCOPE,
  googleScopeSetsEqual,
} from "./google-workspace-scopes";

export type { GoogleWorkspaceContext } from "./google-credential-boundary";

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

// Optional execution context for trusted server-side bridges (for example the
// Slack bridge) that already resolved the acting user. When provided, it
// short-circuits the cookie-session resolution while keeping the same
// per-user connection lookup: actions always run on the acting user's own
// Google account.
type GoogleTokenReference = {
  access_token?: string;
  expiry_date?: number;
  refresh_token?: string;
};

type GoogleConnectionRow = {
  connected_by_profile_id?: string | null;
  encrypted_token_reference: string | null;
  external_account_label: string | null;
  id: string;
  organization_id: string;
  scopes: string[] | null;
  status: string;
};

type ResolvedGoogleConnection = GoogleConnectionRow & {
  actor: GoogleCredentialActor;
};

export type GoogleCalendarEventSummary = {
  attachments?: Array<{
    fileId?: string;
    fileUrl?: string;
    mimeType?: string;
    title?: string;
  }>;
  attendees?: Array<{
    displayName?: string;
    email?: string;
    responseStatus?: string;
    self?: boolean;
  }>;
  conferenceUrl?: string;
  end?: string;
  htmlLink?: string;
  id: string;
  location?: string;
  organizer?: { displayName?: string; email?: string; self?: boolean };
  start?: string;
  title: string;
};

export type GmailMessageSummary = {
  date?: string;
  from?: string;
  id: string;
  snippet?: string;
  subject?: string;
  threadId?: string;
};

export type GmailMeetingNoteMessage = GmailMessageSummary & {
  bodyText: string;
  documentText?: string;
  senderEmail: string;
};

export type GmailMeetingNoteBatch = {
  messages: GmailMeetingNoteMessage[];
  nextPageToken?: string;
  scanned: number;
};

export type GoogleCalendarReminderResult = {
  htmlLink?: string;
  id: string;
  start: string;
  title: string;
};

export type GoogleWorkspaceCapabilityStatus = {
  accountLabel?: string;
  calendar: boolean;
  connected: boolean;
  error?: string;
  gmail: boolean;
};

export function inferGoogleWorkspaceReadCapabilities(scopes: string[]) {
  return {
    calendar: scopes.some((scope) =>
      [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
      ].includes(scope),
    ),
    gmail: scopes.some((scope) =>
      [
        "https://mail.google.com/",
        "https://www.googleapis.com/auth/gmail.metadata",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.readonly",
      ].includes(scope),
    ),
  };
}

export async function inspectGoogleWorkspaceCapabilities(
  context?: GoogleWorkspaceContext,
): Promise<GoogleWorkspaceCapabilityStatus> {
  try {
    const connection = await getGoogleWorkspaceConnection(context);
    const scopes = connection.scopes ?? [];
    const { calendar, gmail } = inferGoogleWorkspaceReadCapabilities(scopes);

    // Refreshing or resolving the token verifies that the stored connection
    // is actually usable without exposing the token to the assistant.
    await getGoogleAccessToken(connection);

    return {
      accountLabel: connection.external_account_label ?? undefined,
      calendar,
      connected: true,
      gmail,
    };
  } catch (error) {
    return {
      calendar: false,
      connected: false,
      error:
        error instanceof Error
          ? error.message
          : "Google Workspace connection unavailable.",
      gmail: false,
    };
  }
}

export async function createGoogleCalendarReminder(
  {
    durationMinutes = 15,
    idempotencyKey,
    scheduledAt,
    timeZone = "Africa/Casablanca",
    title,
  }: {
    durationMinutes?: number;
    idempotencyKey?: string;
    scheduledAt: string;
    timeZone?: string;
    title: string;
  },
  context?: GoogleWorkspaceContext,
): Promise<GoogleCalendarReminderResult> {
  const connection = await getGoogleWorkspaceConnection(context);
  const accessToken = await getGoogleAccessToken(connection);
  const start = normalizeReminderDateTime(scheduledAt);
  const end = addMinutesToCalendarDateTime(
    start,
    Math.max(5, Math.min(durationMinutes, 120)),
  );
  const eventId = idempotencyKey
    ? googleCalendarIdempotencyId(idempotencyKey)
    : undefined;
  await revalidateGoogleProviderUse(connection, context);
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      body: JSON.stringify({
        ...(eventId ? { id: eventId } : {}),
        end: { dateTime: end, timeZone },
        reminders: {
          overrides: [{ method: "popup", minutes: 0 }],
          useDefault: false,
        },
        start: { dateTime: start, timeZone },
        summary: title.trim().slice(0, 180) || "Rappel NAIA",
        transparency: "transparent",
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  if (response.status === 409 && eventId) {
    return fetchGoogleCalendarReminderById(eventId, accessToken);
  }
  if (!response.ok) {
    throw new Error(await providerError("Google Calendar", response));
  }

  const payload = (await response.json()) as {
    htmlLink?: string;
    id?: string;
    start?: { dateTime?: string };
    summary?: string;
  };
  return {
    htmlLink: payload.htmlLink,
    id: payload.id ?? crypto.randomUUID(),
    start: payload.start?.dateTime ?? start,
    title: payload.summary ?? title,
  };
}

export function googleCalendarIdempotencyId(key: string) {
  return `naia${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

async function fetchGoogleCalendarReminderById(
  eventId: string,
  accessToken: string,
): Promise<GoogleCalendarReminderResult> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(await providerError("Google Calendar", response));
  }
  const payload = (await response.json()) as {
    htmlLink?: string;
    id?: string;
    start?: { dateTime?: string };
    summary?: string;
  };
  return {
    htmlLink: payload.htmlLink,
    id: payload.id ?? eventId,
    start: payload.start?.dateTime ?? "",
    title: payload.summary ?? "Rappel NAIA",
  };
}

export async function getGoogleWorkspaceAccessToken(
  {
    expectedConnectionId,
    requiredScopes = [],
  }: {
    expectedConnectionId?: string;
    requiredScopes?: string[];
  } = {},
  context?: GoogleWorkspaceContext,
) {
  const connection = await getGoogleWorkspaceConnection(
    context,
    expectedConnectionId,
  );
  const missingScopes = requiredScopes.filter(
    (scope) => !(connection.scopes ?? []).includes(scope),
  );

  if (missingScopes.length > 0) {
    throw new Error(
      `Google Workspace must be reconnected with additional scopes: ${missingScopes.join(", ")}`,
    );
  }

  const accessToken = await getGoogleAccessToken(connection);
  await revalidateGoogleProviderUse(connection, context);
  return accessToken;
}

export async function listGoogleCalendarEvents(
  {
    calendarId = "primary",
    daysAhead = 7,
    maxResults = 10,
    timeMax: requestedTimeMax,
    timeMin: requestedTimeMin,
  }: {
    calendarId?: string;
    daysAhead?: number;
    maxResults?: number;
    timeMax?: string;
    timeMin?: string;
  } = {},
  context?: GoogleWorkspaceContext,
): Promise<GoogleCalendarEventSummary[]> {
  const connection = await getGoogleWorkspaceConnection(context);
  const accessToken = await getGoogleAccessToken(connection);
  await revalidateGoogleProviderUse(connection, context);
  const timeMin = requestedTimeMin
    ? parseCalendarBoundary(requestedTimeMin)
    : new Date();
  const timeMax = requestedTimeMax
    ? parseCalendarBoundary(requestedTimeMax)
    : new Date(
        timeMin.getTime() + Math.max(daysAhead, 1) * 24 * 60 * 60 * 1000,
      );
  if (timeMax <= timeMin) {
    throw new Error("Google Calendar date range is invalid.");
  }
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );

  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await providerError("Google Calendar", response));
  }

  const payload = (await response.json()) as {
    items?: Array<{
      attachments?: Array<{
        fileId?: string;
        fileUrl?: string;
        mimeType?: string;
        title?: string;
      }>;
      attendees?: Array<{
        displayName?: string;
        email?: string;
        responseStatus?: string;
        self?: boolean;
      }>;
      conferenceData?: {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
      };
      end?: { date?: string; dateTime?: string };
      hangoutLink?: string;
      htmlLink?: string;
      id?: string;
      location?: string;
      organizer?: { displayName?: string; email?: string; self?: boolean };
      start?: { date?: string; dateTime?: string };
      summary?: string;
    }>;
  };

  return (payload.items ?? []).map((event) => ({
    attachments: event.attachments,
    attendees: event.attendees,
    conferenceUrl:
      event.hangoutLink ??
      event.conferenceData?.entryPoints?.find(
        (entryPoint) => entryPoint.entryPointType === "video",
      )?.uri,
    end: event.end?.dateTime ?? event.end?.date,
    htmlLink: event.htmlLink,
    id: event.id ?? crypto.randomUUID(),
    location: event.location,
    organizer: event.organizer,
    start: event.start?.dateTime ?? event.start?.date,
    title: event.summary ?? "Evenement sans titre",
  }));
}

function parseCalendarBoundary(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Google Calendar date range is invalid.");
  }
  return date;
}

function normalizeReminderDateTime(value: string) {
  const clean = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return `${clean}T09:00:00`;
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(
      clean,
    )
  ) {
    return clean.length === 16 ? `${clean}:00` : clean;
  }
  throw new Error("Date de rappel invalide.");
}

function addMinutesToCalendarDateTime(value: string, minutes: number) {
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (hasOffset) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new Error("Date de rappel invalide.");
    return new Date(date.getTime() + minutes * 60_000).toISOString();
  }

  const [datePart, timePart = "09:00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second = 0] = timePart.split(":").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 19);
}

export async function listGmailMessages(
  {
    maxResults = 10,
    query,
    unreadOnly = false,
  }: {
    maxResults?: number;
    query?: string;
    unreadOnly?: boolean;
  } = {},
  context?: GoogleWorkspaceContext,
): Promise<GmailMessageSummary[]> {
  const connection = await getGoogleWorkspaceConnection(context);
  const accessToken = await getGoogleAccessToken(connection);
  await revalidateGoogleProviderUse(connection, context);
  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );

  listUrl.searchParams.set("maxResults", String(maxResults));
  listUrl.searchParams.set(
    "q",
    query ?? (unreadOnly ? "is:unread newer_than:14d" : "newer_than:14d"),
  );

  const listResponse = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!listResponse.ok) {
    throw new Error(await providerError("Gmail", listResponse));
  }

  const listPayload = (await listResponse.json()) as {
    messages?: Array<{ id?: string; threadId?: string }>;
  };
  const messages = (listPayload.messages ?? [])
    .filter((message): message is { id: string; threadId?: string } =>
      Boolean(message.id),
    )
    .slice(0, maxResults);

  return Promise.all(
    messages.map(async (message) => {
      const detailUrl = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
      );
      detailUrl.searchParams.set("format", "metadata");
      for (const header of ["From", "Subject", "Date"]) {
        detailUrl.searchParams.append("metadataHeaders", header);
      }

      const detailResponse = await fetch(detailUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!detailResponse.ok) {
        return {
          id: message.id,
          threadId: message.threadId,
        };
      }

      const detailPayload = (await detailResponse.json()) as {
        payload?: { headers?: Array<{ name?: string; value?: string }> };
        snippet?: string;
        threadId?: string;
      };
      const headers = new Map(
        (detailPayload.payload?.headers ?? []).map((header) => [
          header.name?.toLowerCase() ?? "",
          header.value,
        ]),
      );

      return {
        date: headers.get("date"),
        from: headers.get("from"),
        id: message.id,
        snippet: detailPayload.snippet,
        subject: headers.get("subject"),
        threadId: detailPayload.threadId ?? message.threadId,
      };
    }),
  );
}

const GEMINI_MEETING_NOTE_SENDERS = new Set([
  "gemini-notes@google.com",
  "meetings-noreply@google.com",
]);

/**
 * Reads only Google Meet/Gemini meeting-note notifications. The exact sender
 * allowlist and subject filter intentionally live inside this integration so
 * callers cannot turn the feature into an arbitrary mailbox-body reader.
 * Gmail is never modified: no labels, read-state changes, drafts or sends.
 */
export async function listGeminiMeetingNoteMessages(
  {
    maxResults = 100,
    newerThanDays = 120,
    pageToken,
  }: {
    maxResults?: number;
    newerThanDays?: number;
    pageToken?: string;
  } = {},
  context?: GoogleWorkspaceContext,
): Promise<GmailMeetingNoteBatch> {
  const connection = await getGoogleWorkspaceConnection(context);
  const accessToken = await getGoogleAccessToken(connection);
  await revalidateGoogleProviderUse(connection, context);
  const boundedMaxResults = Math.max(1, Math.min(maxResults, 200));
  const boundedDays = Math.max(1, Math.min(newerThanDays, 365));
  const canReadLinkedDocuments = canReadGoogleMeetingDocuments(
    connection.scopes,
  );
  const messages: Array<{ id: string; threadId?: string }> = [];
  let nextPageToken = pageToken?.trim() || undefined;
  do {
    const listUrl = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    listUrl.searchParams.set(
      "maxResults",
      String(Math.min(100, boundedMaxResults - messages.length)),
    );
    listUrl.searchParams.set(
      "q",
      `{from:gemini-notes@google.com from:meetings-noreply@google.com} newer_than:${boundedDays}d -in:spam -in:trash`,
    );
    if (nextPageToken) listUrl.searchParams.set("pageToken", nextPageToken);

    const listResponse = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listResponse.ok) {
      throw new Error(await providerError("Gmail", listResponse));
    }

    const listPayload = (await listResponse.json()) as {
      messages?: Array<{ id?: string; threadId?: string }>;
      nextPageToken?: string;
    };
    messages.push(
      ...(listPayload.messages ?? []).filter(
        (message): message is { id: string; threadId?: string } =>
          Boolean(message.id),
      ),
    );
    nextPageToken = listPayload.nextPageToken;
  } while (nextPageToken && messages.length < boundedMaxResults);

  const boundedMessages = messages.slice(0, boundedMaxResults);

  const detailed = await mapWithConcurrency<
    (typeof messages)[number],
    GmailMeetingNoteMessage | undefined
  >(boundedMessages, 8, async (message) => {
    const detailUrl = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
    );
    detailUrl.searchParams.set("format", "full");
    const detailResponse = await fetch(detailUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!detailResponse.ok) return undefined;

    const detail = (await detailResponse.json()) as GmailFullMessagePayload;
    const rawHeaders = detail.payload?.headers ?? [];
    const headers = new Map(
      rawHeaders.map((header) => [
        header.name?.toLocaleLowerCase("en") ?? "",
        header.value,
      ]),
    );
    const from = headers.get("from") ?? "";
    const senderEmail = extractMailboxAddress(from);
    const subject = headers.get("subject") ?? "";
    if (
      !isAuthenticatedGeminiSender(rawHeaders, senderEmail) ||
      !/^notes\s*:/iu.test(subject.trim())
    ) {
      return undefined;
    }

    const bodyText = extractGmailMessageText(detail.payload).slice(0, 300_000);
    if (!bodyText.trim()) return undefined;
    const documentFileId = bodyText.match(
      /https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/u,
    )?.[1];
    const documentText =
      canReadLinkedDocuments && documentFileId
        ? await downloadGeminiDocumentText(documentFileId, accessToken)
        : undefined;

    return {
      bodyText,
      date: headers.get("date"),
      documentText,
      from,
      id: message.id,
      senderEmail,
      snippet: detail.snippet,
      subject,
      threadId: detail.threadId ?? message.threadId,
    } satisfies GmailMeetingNoteMessage;
  });

  return {
    messages: detailed.filter((message): message is GmailMeetingNoteMessage =>
      Boolean(message),
    ),
    nextPageToken,
    scanned: boundedMessages.length,
  };
}

async function downloadGeminiDocumentText(
  documentFileId: string,
  accessToken: string,
) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentFileId)}/export`,
  );
  url.searchParams.set("mimeType", "text/plain");
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return undefined;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 2_000_000) return undefined;
    return (await response.text()).trim().slice(0, 1_500_000) || undefined;
  } catch {
    return undefined;
  }
}

type GmailFullMessagePayload = {
  payload?: GmailMessagePart;
  snippet?: string;
  threadId?: string;
};

type GmailMessagePart = {
  body?: { data?: string };
  headers?: Array<{ name?: string; value?: string }>;
  mimeType?: string;
  parts?: GmailMessagePart[];
};

function extractGmailMessageText(payload?: GmailMessagePart) {
  if (!payload) return "";
  const plainParts: string[] = [];
  const htmlParts: string[] = [];
  const visit = (part: GmailMessagePart) => {
    const data = part.body?.data;
    if (data && part.mimeType === "text/plain") {
      plainParts.push(decodeGmailBase64Url(data));
    } else if (data && part.mimeType === "text/html") {
      htmlParts.push(decodeGmailBase64Url(data));
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(payload);
  if (plainParts.length) return plainParts.join("\n\n").trim();
  return htmlToPlainText(htmlParts.join("\n")).trim();
}

function decodeGmailBase64Url(value: string) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function htmlToPlainText(value: string) {
  return value
    .replace(/<\s*br\s*\/?\s*>/giu, "\n")
    .replace(/<\/(?:div|p|li|h[1-6])\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function extractMailboxAddress(value: string) {
  const bracketed = value.match(/<([^<>\s]+@[^<>\s]+)>/u)?.[1];
  const bare = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0];
  return (bracketed ?? bare ?? "").trim().toLocaleLowerCase("en");
}

function isAuthenticatedGeminiSender(
  headers: Array<{ name?: string; value?: string }>,
  senderEmail: string,
) {
  if (!GEMINI_MEETING_NOTE_SENDERS.has(senderEmail)) return false;
  // Gmail prepends its own Authentication-Results header before any
  // untrusted header supplied by the sender. Only the first result minted by
  // mx.google.com is authoritative; accepting a later, sender-controlled
  // header would make an exact From address spoofable.
  const authenticationResult = headers
    .filter(
      (header) =>
        header.name?.trim().toLocaleLowerCase("en") ===
        "authentication-results",
    )
    .map((header) => header.value?.replace(/\s+/g, " ").trim() ?? "")
    .find((value) => /^mx\.google\.com\s*;/iu.test(value));

  if (!authenticationResult) return false;
  const authenticationClauses = authenticationResult
    .split(";")
    .map((clause) => clause.trim());
  const alignedDkim = authenticationClauses.some(
    (clause) =>
      /^dkim=pass(?:\s|$)/iu.test(clause) &&
      /header\.(?:d|i)\s*=\s*@?google\.com(?:\s|$)/iu.test(clause),
  );
  const alignedDmarc = authenticationClauses.some(
    (clause) =>
      /^dmarc=pass(?:\s|$)/iu.test(clause) &&
      /header\.from\s*=\s*google\.com(?:\s|$)/iu.test(clause),
  );
  return alignedDkim && alignedDmarc;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function getGoogleWorkspaceConnection(
  context?: GoogleWorkspaceContext,
  expectedConnectionId?: string,
): Promise<ResolvedGoogleConnection> {
  const actor = await resolveGoogleCredentialActor(context);

  // Per-user connection: each member's Calendar/Gmail actions run on their
  // own Google account, never on a colleague's. Token material is selected
  // only with service_role after the exact actor membership was verified.
  let query = actor.credentialClient
    .from("integration_connections")
    .select(
      "id,organization_id,external_account_label,scopes,encrypted_token_reference,connected_by_profile_id,status",
    )
    .eq("organization_id", actor.organizationId)
    .eq("provider", "google")
    .eq("connected_by_profile_id", actor.profileId)
    .eq("status", "connected");
  if (expectedConnectionId) query = query.eq("id", expectedConnectionId);
  const { data, error } = await query
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Google Workspace is not connected for this user.");
  }

  const connection = data as GoogleConnectionRow;
  if (
    connection.organization_id !== actor.organizationId ||
    connection.connected_by_profile_id !== actor.profileId ||
    (expectedConnectionId && connection.id !== expectedConnectionId) ||
    connection.status !== "connected"
  ) {
    throw new Error("Google Workspace connection identity is invalid.");
  }

  const intent = connection.scopes?.includes(GOOGLE_MEETING_NOTE_SCOPE)
    ? "meeting-notes"
    : "user";
  const scopeAttestation = attestGoogleScopes(connection.scopes, intent);
  if (!scopeAttestation.ok) {
    const quarantined = await markGoogleConnectionNeedsReview(
      actor,
      connection,
    );
    if (!quarantined) {
      throw new Error("Google Workspace connection could not be quarantined.");
    }
    throw new Error(
      "Google Workspace must be reconnected because its scope attestation is invalid.",
    );
  }

  return { ...connection, actor };
}

async function revalidateGoogleProviderUse(
  connection: ResolvedGoogleConnection,
  context?: GoogleWorkspaceContext,
) {
  const actor = await resolveGoogleCredentialActor(context);
  if (
    actor.organizationId !== connection.actor.organizationId ||
    actor.profileId !== connection.actor.profileId
  ) {
    throw new Error("Google Workspace actor authorization changed.");
  }
  const { data, error } = await actor.credentialClient
    .from("integration_connections")
    .select("id,organization_id,provider,connected_by_profile_id,status,scopes")
    .eq("id", connection.id)
    .eq("organization_id", actor.organizationId)
    .eq("provider", "google")
    .eq("connected_by_profile_id", actor.profileId)
    .eq("status", "connected")
    .maybeSingle();
  if (
    error ||
    !data ||
    data.id !== connection.id ||
    data.organization_id !== actor.organizationId ||
    data.provider !== "google" ||
    data.connected_by_profile_id !== actor.profileId ||
    data.status !== "connected" ||
    !googleScopeSetsEqual(data.scopes, connection.scopes)
  ) {
    throw new Error("Google Workspace authorization changed before use.");
  }
}

async function getGoogleAccessToken(connection: ResolvedGoogleConnection) {
  const actor = connection.actor;
  const tokenReference = parseTokenReference(
    connection.encrypted_token_reference,
  );

  if (
    tokenReference.access_token &&
    tokenReference.expiry_date &&
    tokenReference.expiry_date > Date.now() + TOKEN_REFRESH_BUFFER_MS
  ) {
    return tokenReference.access_token;
  }

  if (!tokenReference.refresh_token) {
    throw new Error("Google Workspace token needs reconnecting.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are missing on the server.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokenReference.refresh_token,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await providerError("Google OAuth", response));
  }

  const refreshed = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (!refreshed.access_token) {
    throw new Error("Google OAuth refresh did not return an access token.");
  }

  // A refresh token can outlive a consent change. Never persist or use the
  // refreshed access token until Google re-attests the exact stored scope set.
  const intent = connection.scopes?.includes(GOOGLE_MEETING_NOTE_SCOPE)
    ? "meeting-notes"
    : "user";
  const attestation = await attestGoogleAccessToken({
    accessToken: refreshed.access_token,
    expectedScopes: connection.scopes ?? [],
    intent,
  });
  if (!attestation.ok) {
    const quarantined = await markGoogleConnectionNeedsReview(
      actor,
      connection,
    );
    if (!quarantined) {
      throw new Error("Google Workspace connection could not be quarantined.");
    }
    throw new Error(
      "Google Workspace token scope changed and requires reconnection.",
    );
  }

  const updatedReference: GoogleTokenReference = {
    access_token: refreshed.access_token,
    expiry_date: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
    refresh_token: refreshed.refresh_token ?? tokenReference.refresh_token,
  };

  const { data: updated, error: updateError } = await actor.credentialClient
    .from("integration_connections")
    .update({
      encrypted_token_reference: JSON.stringify(updatedReference),
      scopes: attestation.scopes,
      server_review_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .eq("organization_id", actor.organizationId)
    .eq("provider", "google")
    .eq("connected_by_profile_id", actor.profileId)
    .eq("status", "connected")
    .select("id,organization_id,provider,connected_by_profile_id,status")
    .maybeSingle();

  if (
    updateError ||
    !updated ||
    updated.id !== connection.id ||
    updated.organization_id !== actor.organizationId ||
    updated.provider !== "google" ||
    updated.connected_by_profile_id !== actor.profileId ||
    updated.status !== "connected"
  ) {
    throw new Error("Google Workspace refreshed credential was not saved.");
  }

  return refreshed.access_token;
}

async function markGoogleConnectionNeedsReview(
  actor: GoogleCredentialActor,
  connection: GoogleConnectionRow,
) {
  const { data, error } = await actor.credentialClient
    .from("integration_connections")
    .update({
      server_review_reason: "scope-attestation-failed",
      status: "needs-review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .eq("organization_id", actor.organizationId)
    .eq("provider", "google")
    .eq("connected_by_profile_id", actor.profileId)
    .select("id,organization_id,provider,connected_by_profile_id,status")
    .maybeSingle();

  return (
    !error &&
    data?.id === connection.id &&
    data.organization_id === actor.organizationId &&
    data.provider === "google" &&
    data.connected_by_profile_id === actor.profileId &&
    data.status === "needs-review"
  );
}

function parseTokenReference(value: string | null): GoogleTokenReference {
  if (!value) return {};

  try {
    return JSON.parse(value) as GoogleTokenReference;
  } catch {
    return {};
  }
}

async function providerError(provider: string, response: Response) {
  // Provider bodies can echo request details. Never propagate them into app
  // logs or user-visible errors from credential-bearing requests.
  await response.body?.cancel().catch(() => undefined);
  return `${provider} request failed (${response.status}).`;
}
