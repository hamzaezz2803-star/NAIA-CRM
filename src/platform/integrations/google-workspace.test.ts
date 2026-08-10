import { afterEach, describe, expect, it, vi } from "vitest";

import {
  googleCalendarIdempotencyId,
  inferGoogleWorkspaceReadCapabilities,
  listGeminiMeetingNoteMessages,
} from "./google-workspace";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Workspace read capabilities", () => {
  it("recognizes the configured read scopes", () => {
    expect(
      inferGoogleWorkspaceReadCapabilities([
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/gmail.readonly",
      ]),
    ).toEqual({ calendar: true, gmail: true });
  });

  it("does not treat send-only and freebusy scopes as read access", () => {
    expect(
      inferGoogleWorkspaceReadCapabilities([
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/gmail.send",
      ]),
    ).toEqual({ calendar: false, gmail: false });
  });
});

describe("Google Calendar idempotency", () => {
  it("derives a stable Google-compatible event id", () => {
    const first = googleCalendarIdempotencyId("meeting-action-123");
    const second = googleCalendarIdempotencyId("meeting-action-123");

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-v]{5,1024}$/);
  });
});

describe("Gemini meeting-note mailbox isolation", () => {
  it.each([
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ])("refuses a connected legacy credential with scope %s", async (scope) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const connection = {
      connected_by_profile_id: "profile-1",
      encrypted_token_reference: JSON.stringify({
        access_token: "legacy-test-token",
        expiry_date: Date.now() + 3_600_000,
      }),
      external_account_label: "ali@qarizmi.com",
      id: "connection-legacy",
      organization_id: "organization-1",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly", scope],
    };
    const query: Record<string, unknown> = {
      maybeSingle: vi.fn().mockResolvedValue({ data: connection, error: null }),
    };
    for (const method of ["eq", "limit", "order", "select"]) {
      query[method] = vi.fn(() => query);
    }
    const supabase = { from: vi.fn(() => query) };

    await expect(
      listGeminiMeetingNoteMessages(
        {},
        {
          organizationId: "organization-1",
          profileId: "profile-1",
          supabase: supabase as never,
        },
      ),
    ).rejects.toThrow(/must be reconnected.*too broad/iu);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads only exact Google senders and exports only the linked Google Doc", async () => {
    const body = [
      'Notes de "Projet Atlas"',
      "",
      "Résumé",
      "Le pilote est validé.",
      "https://docs.google.com/document/d/doc-123/edit?usp=meet",
    ].join("\n");
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method && init.method !== "GET") {
          throw new Error(`Unexpected Gmail mutation: ${init.method}`);
        }
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        );
        if (url.pathname.endsWith("/users/me/messages")) {
          return Response.json({
            messages: [
              { id: "allowed" },
              { id: "spoofed-exact-from" },
              { id: "forged" },
            ],
          });
        }
        if (url.pathname.endsWith("/messages/allowed")) {
          return Response.json({
            payload: {
              headers: [
                { name: "From", value: "Gemini <gemini-notes@google.com>" },
                {
                  name: "Authentication-Results",
                  value:
                    "mx.google.com; dkim=pass header.i=@google.com header.s=20230601; dmarc=pass header.from=google.com",
                },
                { name: "Subject", value: 'Notes : "Projet Atlas"' },
                { name: "Date", value: "Thu, 6 Aug 2026 15:15:23 +0000" },
              ],
              mimeType: "multipart/alternative",
              parts: [
                {
                  body: { data: Buffer.from(body).toString("base64url") },
                  mimeType: "text/plain",
                },
              ],
            },
            threadId: "thread-allowed",
          });
        }
        if (url.pathname.endsWith("/messages/spoofed-exact-from")) {
          return Response.json({
            payload: {
              headers: [
                { name: "From", value: "Gemini <gemini-notes@google.com>" },
                {
                  name: "Authentication-Results",
                  value:
                    "mx.google.com; dkim=pass header.i=@attacker.example; dmarc=fail header.from=google.com",
                },
                { name: "Subject", value: 'Notes : "Projet Atlas"' },
                // A later sender-controlled result must never override the
                // first result added by Gmail.
                {
                  name: "Authentication-Results",
                  value: "mx.google.com; dkim=pass header.i=@google.com",
                },
              ],
              mimeType: "text/plain",
              body: { data: Buffer.from(body).toString("base64url") },
            },
          });
        }
        if (url.pathname.endsWith("/messages/forged")) {
          return Response.json({
            payload: {
              headers: [
                { name: "From", value: "Gemini <attacker@example.com>" },
                { name: "Subject", value: 'Notes : "Projet Atlas"' },
              ],
              mimeType: "text/plain",
              body: { data: Buffer.from(body).toString("base64url") },
            },
          });
        }
        if (url.pathname.endsWith("/files/doc-123/export")) {
          return new Response("Transcript\nAli: le pilote est validé.", {
            headers: { "content-length": "42" },
          });
        }
        throw new Error(`Unexpected Google request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const connection = {
      connected_by_profile_id: "profile-1",
      encrypted_token_reference: JSON.stringify({
        access_token: "redacted-test-token",
        expiry_date: Date.now() + 3_600_000,
      }),
      external_account_label: "ali@qarizmi.com",
      id: "connection-1",
      organization_id: "organization-1",
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.meet.readonly",
      ],
    };
    const query: Record<string, unknown> = {
      maybeSingle: vi.fn().mockResolvedValue({ data: connection, error: null }),
    };
    for (const method of ["eq", "limit", "order", "select"]) {
      query[method] = vi.fn(() => query);
    }
    const supabase = { from: vi.fn(() => query) };

    const batch = await listGeminiMeetingNoteMessages(
      { maxResults: 10, newerThanDays: 30 },
      {
        organizationId: "organization-1",
        profileId: "profile-1",
        supabase: supabase as never,
      },
    );

    expect(batch).toEqual({
      messages: [
        expect.objectContaining({
          bodyText: body,
          documentText: "Transcript\nAli: le pilote est validé.",
          id: "allowed",
          senderEmail: "gemini-notes@google.com",
        }),
      ],
      nextPageToken: undefined,
      scanned: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
    }
  });

  it("continues from an opaque Gmail cursor and returns the next cursor", async () => {
    const listUrls: URL[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.pathname.endsWith("/users/me/messages")) {
        listUrls.push(url);
        return Response.json({
          messages: [{ id: "page-message" }],
          nextPageToken: "next-opaque-cursor",
        });
      }
      if (url.pathname.endsWith("/messages/page-message")) {
        return Response.json({
          payload: {
            body: {
              data: Buffer.from(
                'Notes de "Projet Atlas"\n\nRésumé\nDécision.',
              ).toString("base64url"),
            },
            headers: [
              { name: "From", value: "Gemini <gemini-notes@google.com>" },
              {
                name: "Authentication-Results",
                value:
                  "mx.google.com; dkim=pass header.i=@google.com; dmarc=pass header.from=google.com",
              },
              { name: "Subject", value: 'Notes : "Projet Atlas"' },
            ],
            mimeType: "text/plain",
          },
        });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const connection = {
      connected_by_profile_id: "profile-1",
      encrypted_token_reference: JSON.stringify({
        access_token: "redacted-test-token",
        expiry_date: Date.now() + 3_600_000,
      }),
      external_account_label: "ali@qarizmi.com",
      id: "connection-1",
      organization_id: "organization-1",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    };
    const query: Record<string, unknown> = {
      maybeSingle: vi.fn().mockResolvedValue({ data: connection, error: null }),
    };
    for (const method of ["eq", "limit", "order", "select"]) {
      query[method] = vi.fn(() => query);
    }
    const supabase = { from: vi.fn(() => query) };

    const batch = await listGeminiMeetingNoteMessages(
      {
        maxResults: 1,
        newerThanDays: 180,
        pageToken: "starting-opaque-cursor",
      },
      {
        organizationId: "organization-1",
        profileId: "profile-1",
        supabase: supabase as never,
      },
    );

    expect(listUrls).toHaveLength(1);
    expect(listUrls[0].searchParams.get("pageToken")).toBe(
      "starting-opaque-cursor",
    );
    expect(batch.nextPageToken).toBe("next-opaque-cursor");
    expect(batch.scanned).toBe(1);
    expect(batch.messages).toHaveLength(1);
  });
});
