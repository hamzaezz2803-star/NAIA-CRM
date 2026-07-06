import { Buffer } from "node:buffer";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

type GoogleTokenReference = {
  access_token?: string;
  expiry_date?: number;
  refresh_token?: string;
};

type GoogleConnectionRow = {
  encrypted_token_reference: string | null;
  external_account_label: string | null;
  id: string;
  organization_id: string;
  scopes: string[] | null;
};

export type GoogleCalendarEventSummary = {
  end?: string;
  htmlLink?: string;
  id: string;
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

export async function listGoogleCalendarEvents({
  calendarId = "primary",
  daysAhead = 7,
  maxResults = 10,
}: {
  calendarId?: string;
  daysAhead?: number;
  maxResults?: number;
} = {}): Promise<GoogleCalendarEventSummary[]> {
  const connection = await getGoogleWorkspaceConnection();
  const accessToken = await getGoogleAccessToken(connection);
  const timeMin = new Date();
  const timeMax = new Date(
    timeMin.getTime() + Math.max(daysAhead, 1) * 24 * 60 * 60 * 1000,
  );
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
      end?: { date?: string; dateTime?: string };
      htmlLink?: string;
      id?: string;
      start?: { date?: string; dateTime?: string };
      summary?: string;
    }>;
  };

  return (payload.items ?? []).map((event) => ({
    end: event.end?.dateTime ?? event.end?.date,
    htmlLink: event.htmlLink,
    id: event.id ?? crypto.randomUUID(),
    start: event.start?.dateTime ?? event.start?.date,
    title: event.summary ?? "Evenement sans titre",
  }));
}

export async function listGmailMessages({
  maxResults = 10,
  query,
  unreadOnly = false,
}: {
  maxResults?: number;
  query?: string;
  unreadOnly?: boolean;
} = {}): Promise<GmailMessageSummary[]> {
  const connection = await getGoogleWorkspaceConnection();
  const accessToken = await getGoogleAccessToken(connection);
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

export async function sendGmailDraft({
  body,
  subject,
  to,
}: {
  body: string;
  subject: string;
  to: string;
}) {
  const connection = await getGoogleWorkspaceConnection();
  const accessToken = await getGoogleAccessToken(connection);
  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const raw = Buffer.from(mime).toString("base64url");
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      body: JSON.stringify({ raw }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(await providerError("Gmail", response));
  }

  return (await response.json()) as { id?: string; threadId?: string };
}

async function getGoogleWorkspaceConnection(): Promise<GoogleConnectionRow> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw new Error("Google Workspace requires an authenticated session.");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error("Google Workspace requires an authenticated session.");
  }

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership?.organization_id) {
    throw new Error("Google Workspace requires an organization membership.");
  }

  const { data, error } = await supabase
    .from("integration_connections")
    .select(
      "id,organization_id,external_account_label,scopes,encrypted_token_reference",
    )
    .eq("organization_id", membership.organization_id)
    .eq("provider", "google")
    .eq("status", "connected")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Google Workspace is not connected.");
  }

  return data as GoogleConnectionRow;
}

async function getGoogleAccessToken(connection: GoogleConnectionRow) {
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

  const updatedReference: GoogleTokenReference = {
    access_token: refreshed.access_token,
    expiry_date: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
    refresh_token: refreshed.refresh_token ?? tokenReference.refresh_token,
  };

  const supabase = await createServerSupabaseClient();
  await supabase
    ?.from("integration_connections")
    .update({
      encrypted_token_reference: JSON.stringify(updatedReference),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return refreshed.access_token;
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
  const text = await response.text();
  return `${provider} request failed (${response.status}): ${text.slice(0, 500)}`;
}
