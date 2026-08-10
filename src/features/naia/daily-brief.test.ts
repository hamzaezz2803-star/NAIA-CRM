import { describe, expect, it } from "vitest";

import {
  buildDailyBriefMessage,
  cleanSlackText,
  getDailyBriefRecipients,
  isDailyBriefDispatchWindow,
  type DailyBriefData,
} from "./daily-brief";

const TIME_ZONE = "Africa/Casablanca";

function data(overrides: Partial<DailyBriefData> = {}): DailyBriefData {
  return {
    calendarEvents: [],
    gmailCandidates: [],
    leads: [],
    tasks: [],
    warnings: [],
    ...overrides,
  };
}

describe("NAIA daily briefing", () => {
  it("dispatches only around 09:30 in Morocco", () => {
    expect(
      isDailyBriefDispatchWindow(
        new Date("2026-08-10T08:30:00.000Z"),
        TIME_ZONE,
      ),
    ).toBe(true);
    expect(
      isDailyBriefDispatchWindow(
        new Date("2026-08-10T09:30:00.000Z"),
        TIME_ZONE,
      ),
    ).toBe(false);
  });

  it("dispatches at 09:30 UTC during Morocco's UTC+0 Ramadan offset", () => {
    expect(
      isDailyBriefDispatchWindow(
        new Date("2026-03-10T09:30:00.000Z"),
        TIME_ZONE,
      ),
    ).toBe(true);
    expect(
      isDailyBriefDispatchWindow(
        new Date("2026-03-10T08:30:00.000Z"),
        TIME_ZONE,
      ),
    ).toBe(false);
  });

  it("deduplicates configured recipients", () => {
    expect(
      getDailyBriefRecipients(
        "Ali@qarizmi.com, nabil@qarizmi.com,ali@qarizmi.com",
      ),
    ).toEqual(["ali@qarizmi.com", "nabil@qarizmi.com"]);
  });

  it("builds urgent, daily, weekly and cautious email sections", () => {
    const message = buildDailyBriefMessage({
      data: data({
        calendarEvents: [
          {
            id: "event-1",
            start: "2026-08-10T10:00:00+01:00",
            title: "Meeting TGCC #3",
          },
        ],
        gmailCandidates: [
          {
            date: "2026-08-10T07:00:00.000Z",
            from: "Client & Partner <client@example.com>",
            messageId: "mail-1",
            priority: "important",
            reasons: ["crm-contact", "read-without-reply"],
            score: 62,
            senderEmail: "client@example.com",
            subject: "Prochaine étape",
            threadId: "thread-1",
            unread: false,
          },
        ],
        leads: [
          {
            id: "lead-1",
            nextAction: "Envoyer le devis",
            nextActionDate: "2026-08-09",
            status: "to-follow-up",
            topic: "Atlas Telecom",
          },
        ],
        tasks: [
          {
            dueAt: "2026-08-08T12:00:00.000Z",
            id: "task-1",
            status: "todo",
            title: "Préparer le pitch",
          },
        ],
      }),
      displayName: "Ali EL ABBASSY",
      now: new Date("2026-08-10T08:30:00.000Z"),
      timeZone: TIME_ZONE,
    });

    const serialized = JSON.stringify(message.blocks);
    expect(serialized).toContain("Préparer le pitch");
    expect(serialized).toContain("Atlas Telecom");
    expect(serialized).toContain("Meeting TGCC #3");
    expect(serialized).toContain("Prochaine étape");
    expect(serialized).toContain("Client &amp; Partner");
    expect(serialized).not.toContain("&amp;amp;");
    expect(serialized).toContain("lu sans réponse");
    expect(serialized).toContain("GitHub/Dependabot");
  });

  it("neutralizes Slack mentions and markup from provider data", () => {
    expect(cleanSlackText("<!channel> @here & urgent")).toBe(
      "&lt;!channel&gt; @​here &amp; urgent",
    );
  });

  it("counts a timezone-aware meeting on the inclusive week-end date", () => {
    const message = buildDailyBriefMessage({
      data: data({
        leads: [
          {
            id: "lead-week-end",
            leadDate: "2026-08-17T17:00:00+01:00",
            status: "meeting-booked",
            topic: "Meeting de fin de semaine",
          },
        ],
      }),
      displayName: "Ali",
      now: new Date("2026-08-10T08:30:00.000Z"),
      timeZone: TIME_ZONE,
    });

    expect(JSON.stringify(message.blocks)).toContain(
      "1 lead(s) en meeting booked",
    );
  });

  it("does not claim zero Calendar or Gmail items when those sources are unavailable", () => {
    const message = buildDailyBriefMessage({
      data: data({
        warnings: ["calendar_unavailable", "gmail_unavailable"],
      }),
      displayName: "Ali",
      now: new Date("2026-08-10T08:30:00.000Z"),
      timeZone: TIME_ZONE,
    });

    const serialized = JSON.stringify(message.blocks);
    expect(serialized).toContain("agenda non vérifié");
    expect(serialized).toContain("événements du jour non vérifiés");
    expect(serialized).toContain("n'ont pas été vérifiés");
    expect(serialized).toContain("Google Calendar");
    expect(serialized).toContain("Gmail");
    expect(serialized).not.toContain("0 événement(s) Calendar");
    expect(serialized).not.toContain(
      "Aucun échange humain récent ne semble attendre une réponse",
    );
  });
});
