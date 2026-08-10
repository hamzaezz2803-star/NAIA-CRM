import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_MEETING_NOTE_SCOPE,
  GOOGLE_USER_SCOPES,
} from "./google-workspace-scopes";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import {
  createGoogleCalendarReminder,
  googleCalendarIdempotencyId,
  inferGoogleWorkspaceReadCapabilities,
  listGeminiMeetingNoteMessages,
  listGmailThreadMetadata,
} from "./google-workspace";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
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

  it("revalidates the exact connection before creating a reminder", async () => {
    const fetchMock = vi.fn();
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
      scopes: [...GOOGLE_USER_SCOPES],
      status: "connected",
    };
    const { context } = installGoogleContextWithUpdate(connection, {
      revalidatedConnection: null,
    });

    await expect(
      createGoogleCalendarReminder(
        {
          scheduledAt: "2026-08-11T09:30:00Z",
          title: "Daily brief",
        },
        context,
      ),
    ).rejects.toThrow(/authorization changed before use/iu);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Gmail thread metadata reader", () => {
  it("reads bounded metadata with normalized headers using GET only", async () => {
    const query = "in:anywhere newer_than:45d -in:spam -in:trash";
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        const url = requestUrl(input);
        if (url.pathname.endsWith("/users/me/threads")) {
          expect(url.searchParams.get("maxResults")).toBe("50");
          expect(url.searchParams.get("q")).toBe(query);
          expect(url.searchParams.get("fields")).toBe(
            "nextPageToken,threads(id)",
          );
          return Response.json({
            threads: [
              { id: "thread-a" },
              { id: "thread-a" },
              { id: "invalid/thread" },
            ],
          });
        }

        expect(url.pathname).toBe("/gmail/v1/users/me/threads/thread-a");
        expect(url.searchParams.get("format")).toBe("metadata");
        expect(url.searchParams.get("fields")).toContain("payload(headers)");
        expect(url.searchParams.getAll("metadataHeaders")).toEqual(
          expect.arrayContaining([
            "From",
            "Subject",
            "Message-ID",
            "In-Reply-To",
            "Auto-Submitted",
          ]),
        );
        return Response.json({
          historyId: " history-9 ",
          id: "thread-a",
          messages: [
            {
              id: "message-a",
              internalDate: "1786000000000",
              labelIds: ["INBOX", "UNREAD", "UNREAD"],
              payload: {
                headers: [
                  {
                    name: "From",
                    value: " Client <client@example.com> ",
                  },
                  { name: "SUBJECT", value: " Action required " },
                  { name: "subject", value: "Must not override" },
                  {
                    name: "List-Unsubscribe",
                    value: "<https://example.com/unsubscribe>",
                  },
                ],
              },
              snippet: " Latest snippet ",
              threadId: "thread-a",
            },
          ],
          snippet: " Thread snippet ",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext(googleConnection());

    await expect(
      listGmailThreadMetadata({ maxResults: 500, query }, context),
    ).resolves.toEqual([
      {
        historyId: "history-9",
        id: "thread-a",
        messages: [
          {
            headers: {
              from: "Client <client@example.com>",
              "list-unsubscribe": "<https://example.com/unsubscribe>",
              subject: "Action required",
            },
            id: "message-a",
            internalDate: "1786000000000",
            labelIds: ["INBOX", "UNREAD"],
            snippet: "Latest snippet",
            threadId: "thread-a",
          },
        ],
        snippet: "Thread snippet",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses safe defaults and accepts Gmail's empty-list response", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        const url = requestUrl(input);
        expect(url.searchParams.get("maxResults")).toBe("25");
        expect(url.searchParams.get("q")).toBe(
          "in:inbox newer_than:30d -in:spam -in:trash",
        );
        return Response.json({ resultSizeEstimate: 0 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext(googleConnection());

    await expect(listGmailThreadMetadata({}, context)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when any live thread detail has a provider error", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        const url = requestUrl(input);
        if (url.pathname.endsWith("/users/me/threads")) {
          return Response.json({
            threads: [{ id: "valid" }, { id: "unavailable" }],
          });
        }
        if (url.pathname.endsWith("/threads/unavailable")) {
          return new Response("temporary outage", { status: 503 });
        }
        return Response.json({
          id: "valid",
          messages: [
            {
              id: "valid-message",
              labelIds: ["INBOX"],
              payload: { headers: [] },
              threadId: "valid",
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext(googleConnection());

    await expect(listGmailThreadMetadata({}, context)).rejects.toThrow(
      /Gmail/iu,
    );
  });

  it("normalizes oversized content and skips an overlong thread without hiding valid threads", async () => {
    const oversizedHeader = "x".repeat(9_000);
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        const url = requestUrl(input);
        if (url.pathname.endsWith("/users/me/threads")) {
          return Response.json({
            threads: [
              { id: "valid" },
              { id: "oversized-header" },
              { id: "overlong-thread" },
            ],
          });
        }
        if (url.pathname.endsWith("/threads/overlong-thread")) {
          return Response.json({
            id: "overlong-thread",
            messages: Array.from({ length: 201 }, (_, index) => ({
              id: `message-${index}`,
              labelIds: ["INBOX"],
              payload: { headers: [] },
              threadId: "overlong-thread",
            })),
          });
        }
        if (url.pathname.endsWith("/threads/oversized-header")) {
          return Response.json({
            id: "oversized-header",
            messages: [
              {
                id: "oversized-message",
                labelIds: ["INBOX"],
                payload: {
                  headers: [
                    { name: "Subject", value: oversizedHeader },
                    { name: "Cc", value: "" },
                    null,
                  ],
                },
                snippet: oversizedHeader,
                threadId: "oversized-header",
              },
            ],
            snippet: oversizedHeader,
          });
        }
        return Response.json({
          id: "valid",
          messages: [
            {
              id: "valid-message",
              labelIds: ["INBOX"],
              payload: { headers: [] },
              threadId: "valid",
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext(googleConnection());

    const result = await listGmailThreadMetadata({}, context);

    expect(result.map((thread) => thread.id)).toEqual([
      "valid",
      "oversized-header",
    ]);
    const normalized = result.find(
      (thread) => thread.id === "oversized-header",
    );
    expect(normalized?.snippet).toHaveLength(1_000);
    expect(normalized?.messages[0].snippet).toHaveLength(1_000);
    expect(normalized?.messages[0].headers.subject).toHaveLength(8_192);
    expect(normalized?.messages[0].headers.cc).toBeUndefined();
  });

  it("ignores a stale 404 thread id while returning complete live threads", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        const url = requestUrl(input);
        if (url.pathname.endsWith("/users/me/threads")) {
          return Response.json({
            threads: [{ id: "valid" }, { id: "stale" }],
          });
        }
        if (url.pathname.endsWith("/threads/stale")) {
          return new Response("gone", { status: 404 });
        }
        return Response.json({
          id: "valid",
          messages: [
            {
              id: "valid-message",
              labelIds: ["INBOX"],
              payload: { headers: [] },
              threadId: "valid",
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext(googleConnection());

    await expect(listGmailThreadMetadata({}, context)).resolves.toEqual([
      {
        id: "valid",
        messages: [
          {
            headers: {},
            id: "valid-message",
            labelIds: ["INBOX"],
            threadId: "valid",
          },
        ],
      },
    ]);
  });

  it("paginates thread ids within the bounded scan cap", async () => {
    const listTokens: Array<string | null> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        const url = requestUrl(input);
        if (url.pathname.endsWith("/users/me/threads")) {
          const token = url.searchParams.get("pageToken");
          listTokens.push(token);
          return token
            ? Response.json({ threads: [{ id: "thread-second" }] })
            : Response.json({
                nextPageToken: "page-2",
                threads: [{ id: "thread-first" }],
              });
        }

        const threadId = url.pathname.split("/").at(-1) ?? "";
        return Response.json({
          id: threadId,
          messages: [
            {
              id: `message-${threadId}`,
              labelIds: ["INBOX"],
              payload: { headers: [] },
              threadId,
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext(googleConnection());

    await expect(
      listGmailThreadMetadata({ maxResults: 100 }, context),
    ).resolves.toHaveLength(2);
    expect(listTokens).toEqual([null, "page-2"]);
  });

  it("bounds concurrent Gmail thread-detail reads", async () => {
    let activeDetailReads = 0;
    let maximumConcurrentReads = 0;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        const url = requestUrl(input);
        if (url.pathname.endsWith("/users/me/threads")) {
          return Response.json({
            threads: Array.from({ length: 12 }, (_, index) => ({
              id: `thread-${index}`,
            })),
          });
        }

        activeDetailReads += 1;
        maximumConcurrentReads = Math.max(
          maximumConcurrentReads,
          activeDetailReads,
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeDetailReads -= 1;
        const threadId = url.pathname.split("/").at(-1) ?? "";
        return Response.json({
          id: threadId,
          messages: [
            {
              id: `message-${threadId}`,
              labelIds: [],
              payload: { headers: [] },
              threadId,
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext(googleConnection());

    const threads = await listGmailThreadMetadata({}, context);

    expect(threads).toHaveLength(12);
    expect(maximumConcurrentReads).toBe(6);
  });

  it.each(["in:inbox\nfrom:attacker@example.com", "x".repeat(513)])(
    "rejects an unsafe query before resolving credentials: %s",
    async (query) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(listGmailThreadMetadata({ query })).rejects.toThrow(
        "Gmail thread query is invalid.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.createServiceRoleSupabaseClient).not.toHaveBeenCalled();
    },
  );
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
      status: "connected",
    };
    const context = installGoogleContext(connection);

    await expect(listGeminiMeetingNoteMessages({}, context)).rejects.toThrow(
      /must be reconnected.*scope attestation/iu,
    );
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
      scopes: [...GOOGLE_USER_SCOPES, GOOGLE_MEETING_NOTE_SCOPE],
      status: "connected",
    };
    const context = installGoogleContext(connection);

    const batch = await listGeminiMeetingNoteMessages(
      { maxResults: 10, newerThanDays: 30 },
      context,
    );

    expect(batch).toEqual({
      documentCount: 1,
      messages: [
        expect.objectContaining({
          bodyText: body,
          documentText: "Transcript\nAli: le pilote est validé.",
          id: "allowed",
          senderEmail: "gemini-notes@google.com",
        }),
      ],
      nextPageToken: undefined,
      processedBytes:
        Buffer.byteLength(body) +
        Buffer.byteLength("Transcript\nAli: le pilote est validé."),
      scanned: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
    }
  });

  it("keeps the Gmail cursor unchanged when a linked Gemini document export has a transient failure", async () => {
    const body = [
      'Notes de "Projet Atlas"',
      "",
      "Résumé",
      "Le pilote est validé.",
      "https://docs.google.com/document/d/doc-transient/edit",
    ].join("\n");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.pathname.endsWith("/users/me/messages")) {
        return Response.json({
          messages: [{ id: "allowed" }],
          nextPageToken: "must-not-be-committed",
        });
      }
      if (url.pathname.endsWith("/messages/allowed")) {
        return Response.json({
          payload: {
            body: { data: Buffer.from(body).toString("base64url") },
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
      if (url.pathname.endsWith("/files/doc-transient/export")) {
        return new Response("temporary Drive outage", { status: 503 });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext({
      connected_by_profile_id: "profile-1",
      encrypted_token_reference: JSON.stringify({
        access_token: "redacted-test-token",
        expiry_date: Date.now() + 3_600_000,
      }),
      external_account_label: "ali@qarizmi.com",
      id: "connection-1",
      organization_id: "organization-1",
      scopes: [...GOOGLE_USER_SCOPES, GOOGLE_MEETING_NOTE_SCOPE],
      status: "connected",
    });

    await expect(listGeminiMeetingNoteMessages({}, context)).rejects.toThrow(
      "Google Drive request failed (503)",
    );
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
      scopes: [...GOOGLE_USER_SCOPES],
      status: "connected",
    };
    const context = installGoogleContext(connection);

    const batch = await listGeminiMeetingNoteMessages(
      {
        maxResults: 1,
        newerThanDays: 180,
        pageToken: "starting-opaque-cursor",
      },
      context,
    );

    expect(listUrls).toHaveLength(1);
    expect(listUrls[0].searchParams.get("pageToken")).toBe(
      "starting-opaque-cursor",
    );
    expect(batch.nextPageToken).toBe("next-opaque-cursor");
    expect(batch.scanned).toBe(1);
    expect(batch.messages).toHaveLength(1);
  });

  it("caps each Gmail page at 25 messages even when a caller asks for more", async () => {
    const listUrls: URL[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      listUrls.push(url);
      return Response.json({ messages: [], nextPageToken: "next-page" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext({
      connected_by_profile_id: "profile-1",
      encrypted_token_reference: JSON.stringify({
        access_token: "redacted-test-token",
        expiry_date: Date.now() + 3_600_000,
      }),
      external_account_label: "ali@qarizmi.com",
      id: "connection-1",
      organization_id: "organization-1",
      scopes: [...GOOGLE_USER_SCOPES],
      status: "connected",
    });

    const batch = await listGeminiMeetingNoteMessages(
      { maxResults: 200 },
      context,
    );

    expect(listUrls).toHaveLength(1);
    expect(listUrls[0].searchParams.get("maxResults")).toBe("25");
    expect(batch).toMatchObject({
      documentCount: 0,
      nextPageToken: "next-page",
      processedBytes: 0,
      scanned: 0,
    });
  });

  it("fails before advancing the cursor when the cumulative byte budget is exhausted", async () => {
    const body = `Notes de "Projet Atlas"\n\n${"x".repeat(200)}`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.pathname.endsWith("/users/me/messages")) {
        return Response.json({
          messages: [{ id: "oversized" }],
          nextPageToken: "must-not-be-committed",
        });
      }
      return Response.json({
        payload: {
          body: { data: Buffer.from(body).toString("base64url") },
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
    });
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext({
      connected_by_profile_id: "profile-1",
      encrypted_token_reference: JSON.stringify({
        access_token: "redacted-test-token",
        expiry_date: Date.now() + 3_600_000,
      }),
      external_account_label: "ali@qarizmi.com",
      id: "connection-1",
      organization_id: "organization-1",
      scopes: [...GOOGLE_USER_SCOPES],
      status: "connected",
    });

    await expect(
      listGeminiMeetingNoteMessages({ maxBytes: 64 }, context),
    ).rejects.toThrow("limite cumulée");
  });

  it("fails the whole page when one Gmail detail read is transiently unavailable", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.pathname.endsWith("/users/me/messages")) {
        return Response.json({
          messages: [{ id: "temporarily-unavailable" }],
          nextPageToken: "must-not-be-committed",
        });
      }
      return new Response("temporary Gmail outage", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const context = installGoogleContext({
      connected_by_profile_id: "profile-1",
      encrypted_token_reference: JSON.stringify({
        access_token: "redacted-test-token",
        expiry_date: Date.now() + 3_600_000,
      }),
      external_account_label: "ali@qarizmi.com",
      id: "connection-1",
      organization_id: "organization-1",
      scopes: [...GOOGLE_USER_SCOPES],
      status: "connected",
    });

    await expect(listGeminiMeetingNoteMessages({}, context)).rejects.toThrow(
      "Gmail request failed (503)",
    );
  });

  it("quarantines a broad refreshed token before any Gmail request", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: "refreshed-token", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          aud: "client-id",
          scope: [
            ...GOOGLE_USER_SCOPES,
            "https://www.googleapis.com/auth/gmail.send",
          ].join(" "),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const connection = {
      connected_by_profile_id: "profile-1",
      encrypted_token_reference: JSON.stringify({
        access_token: "expired-token",
        expiry_date: Date.now() - 1,
        refresh_token: "refresh-token",
      }),
      external_account_label: "ali@qarizmi.com",
      id: "connection-1",
      organization_id: "organization-1",
      scopes: [...GOOGLE_USER_SCOPES],
      status: "connected",
    };
    const { context, update } = installGoogleContextWithUpdate(connection);

    await expect(listGeminiMeetingNoteMessages({}, context)).rejects.toThrow(
      /scope changed.*reconnection/iu,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith("https://gmail.googleapis.com/"),
      ),
    ).toBe(false);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        server_review_reason: "scope-attestation-failed",
        status: "needs-review",
      }),
    );
  });
});

function requestUrl(input: string | URL | Request) {
  return new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  );
}

function googleConnection() {
  return {
    connected_by_profile_id: "profile-1",
    encrypted_token_reference: JSON.stringify({
      access_token: "redacted-test-token",
      expiry_date: Date.now() + 3_600_000,
    }),
    external_account_label: "ali@qarizmi.com",
    id: "connection-1",
    organization_id: "organization-1",
    scopes: [...GOOGLE_USER_SCOPES],
    status: "connected",
  };
}

function installGoogleContext(connection: Record<string, unknown>) {
  return installGoogleContextWithUpdate(connection).context;
}

function installGoogleContextWithUpdate(
  connection: Record<string, unknown>,
  options: { revalidatedConnection?: Record<string, unknown> | null } = {},
) {
  const membershipQuery = chain({
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        organization_id: "organization-1",
        profile_id: "profile-1",
        role: "owner",
      },
      error: null,
    }),
  });
  const sessionClient = {
    from: vi.fn((table: string) => {
      if (table === "organization_memberships") return membershipQuery;
      throw new Error(`Unexpected session table: ${table}`);
    }),
  };

  const updateResult = chain({
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        connected_by_profile_id: "profile-1",
        id: connection.id,
        organization_id: "organization-1",
        provider: "google",
        status: "needs-review",
      },
      error: null,
    }),
  });
  const update = vi.fn(() => updateResult);
  const revalidatedConnection = Object.hasOwn(options, "revalidatedConnection")
    ? options.revalidatedConnection
    : { ...connection, provider: "google" };
  const connectionQuery = chain({
    maybeSingle: vi
      .fn()
      .mockResolvedValueOnce({ data: connection, error: null })
      .mockResolvedValue({ data: revalidatedConnection, error: null }),
    update,
  });
  const serviceClient = {
    from: vi.fn((table: string) => {
      if (table === "integration_connections") return connectionQuery;
      throw new Error(`Unexpected service table: ${table}`);
    }),
  };
  mocks.createServiceRoleSupabaseClient.mockReturnValue(serviceClient);

  return {
    context: {
      organizationId: "organization-1",
      profileId: "profile-1",
      supabase: sessionClient as never,
    },
    update,
  };
}

function chain(initial: Record<string, ReturnType<typeof vi.fn>>) {
  const query: Record<string, ReturnType<typeof vi.fn>> = { ...initial };
  for (const method of ["eq", "limit", "order", "select"]) {
    query[method] = vi.fn(() => query);
  }
  return query;
}
