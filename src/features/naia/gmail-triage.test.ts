import { describe, expect, it } from "vitest";

import type {
  GmailThreadMessageMetadata,
  GmailThreadMetadata,
} from "@/platform/integrations/google-workspace";

import { triageGmailThreads } from "./gmail-triage";

const NOW = new Date("2026-08-10T09:00:00.000Z");

describe("Gmail contextual triage", () => {
  it.each([
    "vercel[bot] <notifications@github.com>",
    "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>",
    "Service <no-reply@example.com>",
    "Alerts <alerts@example.com>",
    "GitHub user <12345+user@users.noreply.github.com>",
  ])("excludes automated sender %s", (from) => {
    const results = triageGmailThreads({
      accountEmail: "ali@qarizmi.com",
      crmLeads: [],
      now: NOW,
      threads: [thread("automated", [incoming({ from })])],
    });

    expect(results).toEqual([]);
  });

  it("excludes mailing lists and auto-submitted messages", () => {
    const listMessage = incoming({
      from: "Founder <founder@startup.com>",
      headers: { "list-id": "community.startup.com", precedence: "list" },
    });
    const automated = incoming({
      from: "Founder <founder@startup.com>",
      headers: { "auto-submitted": "auto-generated" },
    });

    expect(
      triageGmailThreads({
        crmLeads: [],
        now: NOW,
        threads: [thread("list", [listMessage]), thread("auto", [automated])],
      }),
    ).toEqual([]);
  });

  it("keeps a read client email with no later reply and explains the priority", () => {
    const results = triageGmailThreads({
      accountEmail: "ali@qarizmi.com",
      crmLeads: [
        {
          companyName: "TGCC",
          contactEmail: "client@tgcc.ma",
          id: "lead-tgcc",
          nextAction: "Valider le prochain atelier",
          nextActionDate: "2026-08-09",
          nextActionState: "pending",
          status: "meeting-booked",
          topic: "TGCC — SOCLE",
        },
      ],
      now: NOW,
      threads: [
        thread("client", [
          incoming({
            from: "Client TGCC <client@tgcc.ma>",
            internalDate: "1786266000000",
            labelIds: ["INBOX", "IMPORTANT"],
            subject: "Pouvez-vous valider la prochaine étape ?",
            to: "Ali <ali@qarizmi.com>",
          }),
        ]),
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      priority: "urgent",
      senderEmail: "client@tgcc.ma",
      unread: false,
    });
    expect(results[0].reasons).toEqual(
      expect.arrayContaining([
        "read-without-reply",
        "crm-contact",
        "action-requested",
        "overdue-crm-action",
      ]),
    );
  });

  it("does not score a completed CRM action as overdue", () => {
    const [result] = triageGmailThreads({
      accountEmail: "ali@qarizmi.com",
      crmLeads: [
        {
          contactEmail: "client@tgcc.ma",
          id: "lead-tgcc",
          nextAction: "Action terminée",
          nextActionDate: "2026-08-09",
          nextActionState: "done",
          status: "meeting-booked",
          topic: "TGCC",
        },
      ],
      now: NOW,
      threads: [
        thread("client-done", [
          incoming({
            from: "Client TGCC <client@tgcc.ma>",
            internalDate: "1786266000000",
            labelIds: ["INBOX", "IMPORTANT"],
            subject: "Prochaine étape",
            to: "Ali <ali@qarizmi.com>",
          }),
        ]),
      ],
    });

    expect(result.reasons).not.toContain("overdue-crm-action");
  });

  it("compares timestamped CRM deadlines on the Casablanca calendar date", () => {
    const now = new Date("2026-08-09T23:30:00.000Z");
    const [result] = triageGmailThreads({
      accountEmail: "ali@qarizmi.com",
      crmLeads: [
        {
          contactEmail: "client@tgcc.ma",
          id: "lead-casablanca-date",
          nextAction: "Relancer aujourd'hui au Maroc",
          nextActionDate: "2026-08-09T23:15:00.000Z",
          nextActionState: "pending",
          status: "to-follow-up",
          topic: "Échéance Casablanca",
        },
      ],
      now,
      threads: [
        thread("casablanca-date", [
          incoming({
            from: "Client TGCC <client@tgcc.ma>",
            internalDate: new Date("2026-08-09T22:00:00.000Z")
              .getTime()
              .toString(),
          }),
        ]),
      ],
    });

    expect(result.reasons).toContain("overdue-crm-action");
  });

  it("drops a conversation when a sent message follows the latest inbound", () => {
    const results = triageGmailThreads({
      crmLeads: [],
      now: NOW,
      threads: [
        thread("answered", [
          incoming({ internalDate: "1786262400000" }),
          sent({ internalDate: "1786266000000" }),
        ]),
      ],
    });

    expect(results).toEqual([]);
  });

  it("keeps a new inbound reply that follows an older sent message", () => {
    const results = triageGmailThreads({
      crmLeads: [],
      now: NOW,
      threads: [
        thread("new-reply", [
          sent({ internalDate: "1786258800000" }),
          incoming({
            internalDate: "1786266000000",
            labelIds: ["INBOX", "UNREAD"],
            subject: "Re: Proposition — une question",
          }),
        ]),
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ unread: true });
  });

  it("ignores a later draft without treating the conversation as answered", () => {
    const results = triageGmailThreads({
      accountEmail: "ali@qarizmi.com",
      crmLeads: [],
      now: NOW,
      threads: [
        thread("drafted", [
          incoming({
            from: "Client <client@example.com>",
            internalDate: "1786262400000",
            subject: "Peux-tu confirmer la prochaine étape ?",
          }),
          {
            headers: {
              from: "Ali <ali@qarizmi.com>",
              subject: "Re: Peux-tu confirmer la prochaine étape ?",
              to: "Client <client@example.com>",
            },
            id: "draft-1",
            internalDate: "1786266000000",
            labelIds: ["DRAFT"],
            snippet: "Réponse en cours",
          },
        ]),
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].messageId).not.toBe("draft-1");
    expect(results[0].senderEmail).toBe("client@example.com");
  });

  it("does not mark an unknown first-contact sender as high priority from wording alone", () => {
    const results = triageGmailThreads({
      accountEmail: "ali@qarizmi.com",
      crmLeads: [],
      now: NOW,
      threads: [
        thread("unknown-urgent", [
          incoming({
            from: "Unknown <unknown@example.com>",
            internalDate: "1786000000000",
            labelIds: ["INBOX"],
            subject: "URGENT: action required today — can you confirm?",
          }),
        ]),
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeLessThan(70);
    expect(results[0].priority).toBe("important");
  });

  it("ranks a CRM contact above a generic external sender", () => {
    const results = triageGmailThreads({
      crmLeads: [
        {
          contactEmail: "known@client.ma",
          id: "lead-known",
          status: "contacted",
          topic: "Known client",
        },
      ],
      now: NOW,
      threads: [
        thread("generic", [incoming({ from: "Person <person@example.com>" })]),
        thread("known", [incoming({ from: "Known <known@client.ma>" })]),
      ],
    });

    expect(results.map((item) => item.threadId)).toEqual(["known", "generic"]);
    expect(results[0].reasons).toContain("crm-contact");
  });

  it("deduplicates repeated invitation threads from the same sender and subject", () => {
    const results = triageGmailThreads({
      crmLeads: [],
      now: NOW,
      threads: [
        thread("older", [
          incoming({
            from: "Wissal <wissal@oracle.com>",
            internalDate: "1786258800000",
            subject: "Oracle: AI & Data management Q/A",
          }),
        ]),
        thread("newer", [
          incoming({
            from: "Wissal <wissal@oracle.com>",
            internalDate: "1786266000000",
            subject: "Re: Oracle: AI & Data management Q/A",
          }),
        ]),
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].threadId).toBe("newer");
  });

  it("fails closed when the sender metadata is malformed", () => {
    const results = triageGmailThreads({
      crmLeads: [],
      now: NOW,
      threads: [thread("broken", [incoming({ from: "Unknown sender" })])],
    });

    expect(results).toEqual([]);
  });
});

function thread(
  id: string,
  messages: GmailThreadMessageMetadata[],
): GmailThreadMetadata {
  return { id, messages };
}

function incoming({
  from = "Client <client@example.com>",
  headers = {},
  internalDate = "1786266000000",
  labelIds = ["INBOX", "UNREAD"],
  subject = "Prochaine étape",
  to = "Ali <ali@qarizmi.com>",
}: {
  from?: string;
  headers?: Record<string, string>;
  internalDate?: string;
  labelIds?: string[];
  subject?: string;
  to?: string;
} = {}): GmailThreadMessageMetadata {
  return {
    headers: {
      date: new Date(Number(internalDate)).toUTCString(),
      from,
      subject,
      to,
      ...headers,
    },
    id: `message-${internalDate}-${from}`,
    internalDate,
    labelIds,
    snippet: subject,
  };
}

function sent({
  internalDate,
}: {
  internalDate: string;
}): GmailThreadMessageMetadata {
  return {
    headers: {
      date: new Date(Number(internalDate)).toUTCString(),
      from: "Ali <ali@qarizmi.com>",
      subject: "Re: Prochaine étape",
      to: "Client <client@example.com>",
    },
    id: `sent-${internalDate}`,
    internalDate,
    labelIds: ["SENT"],
  };
}
