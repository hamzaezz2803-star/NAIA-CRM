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
            from: "Client & Partner <client@example.com>",
            id: "mail-1",
            subject: "Prochaine étape",
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
    expect(serialized).toContain(
      "ne prétend pas qu’un mail lu est sans réponse",
    );
  });

  it("neutralizes Slack mentions and markup from provider data", () => {
    expect(cleanSlackText("<!channel> @here & urgent")).toBe(
      "&lt;!channel&gt; @​here &amp; urgent",
    );
  });
});
