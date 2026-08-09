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
            messages: [{ id: "allowed" }, { id: "forged" }],
          });
        }
        if (url.pathname.endsWith("/messages/allowed")) {
          return Response.json({
            payload: {
              headers: [
                { name: "From", value: "Gemini <gemini-notes@google.com>" },
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
        "https://www.googleapis.com/auth/drive.readonly",
      ],
    };
    const query: Record<string, unknown> = {
      maybeSingle: vi.fn().mockResolvedValue({ data: connection, error: null }),
    };
    for (const method of ["eq", "limit", "order", "select"]) {
      query[method] = vi.fn(() => query);
    }
    const supabase = { from: vi.fn(() => query) };

    const messages = await listGeminiMeetingNoteMessages(
      { maxResults: 10, newerThanDays: 30 },
      {
        organizationId: "organization-1",
        profileId: "profile-1",
        supabase: supabase as never,
      },
    );

    expect(messages).toEqual([
      expect.objectContaining({
        bodyText: body,
        documentText: "Transcript\nAli: le pilote est validé.",
        id: "allowed",
        senderEmail: "gemini-notes@google.com",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
    }
  });
});
