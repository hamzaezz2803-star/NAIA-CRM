import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform/integrations/google-workspace", () => ({
  listGmailThreadMetadata: vi.fn(async () => []),
  listGoogleCalendarEvents: vi.fn(async () => []),
}));

import {
  buildDailyBriefMessage,
  cleanSlackText,
  getDailyBriefRecipients,
  isDailyBriefDispatchWindow,
  loadDailyBriefData,
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
            nextAction: "Préparer le meeting",
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

  it("excludes completed lead actions and deduplicates projected tasks", () => {
    const message = buildDailyBriefMessage({
      data: data({
        leads: [
          {
            id: "lead-done",
            leadDate: "2026-08-08T12:00:00.000Z",
            nextAction: "Action déjà terminée",
            nextActionState: "done",
            status: "to-follow-up",
            topic: "Lead terminé",
          },
          {
            id: "lead-projected",
            leadDate: "2026-08-08T12:00:00.000Z",
            nextAction: "Relancer le client",
            nextActionState: "pending",
            status: "to-follow-up",
            topic: "Lead projeté",
          },
        ],
        tasks: [
          {
            dueAt: "2026-08-08T12:00:00.000Z",
            id: "task-projected",
            leadId: "lead-projected",
            status: "todo",
            taskKind: "lead-next-action",
            title: "Relancer le client",
          },
        ],
      }),
      displayName: "Ali",
      now: new Date("2026-08-10T08:30:00.000Z"),
      timeZone: TIME_ZONE,
    });

    const serialized = JSON.stringify(message.blocks);
    expect(serialized).not.toContain("Lead terminé");
    expect(serialized).not.toContain("Lead projeté");
    expect(serialized.match(/Relancer le client/g)).toHaveLength(1);
  });

  it("ignores terminal and actionless CRM leads while preserving manual tasks", () => {
    const message = buildDailyBriefMessage({
      data: data({
        leads: [
          {
            id: "lead-won",
            leadDate: "2026-08-08T12:00:00.000Z",
            nextAction: "Ne plus relancer ce client gagné",
            status: "won",
            topic: "Client gagné",
          },
          {
            id: "lead-dead-end",
            leadDate: "2026-08-08T12:00:00.000Z",
            nextAction: "Ne plus relancer ce lead perdu",
            status: "dead-end",
            topic: "Lead perdu",
          },
          {
            id: "lead-without-action",
            leadDate: "2026-08-08T12:00:00.000Z",
            status: "to-follow-up",
            topic: "Lead sans action",
          },
          {
            id: "meeting-without-action",
            leadDate: "2026-08-12T12:00:00.000Z",
            nextAction: "   ",
            status: "meeting-booked",
            topic: "Meeting sans action",
          },
          {
            id: "meeting-with-action",
            leadDate: "2026-08-12T12:00:00.000Z",
            nextAction: "Préparer la démonstration",
            status: "meeting-booked",
            topic: "Meeting à préparer",
          },
        ],
        tasks: [
          {
            dueAt: "2026-08-08T12:00:00.000Z",
            id: "closed-projection",
            leadId: "lead-won",
            leadStatus: "won",
            status: "todo",
            taskKind: "lead-next-action",
            title: "Projection du lead gagné",
          },
          {
            dueAt: "2026-08-08T12:00:00.000Z",
            id: "closed-manual-task",
            leadId: "lead-won",
            leadStatus: "won",
            status: "todo",
            taskKind: "manual",
            title: "Tâche manuelle à conserver",
          },
        ],
      }),
      displayName: "Ali",
      now: new Date("2026-08-10T08:30:00.000Z"),
      timeZone: TIME_ZONE,
    });

    const serialized = JSON.stringify(message.blocks);
    expect(serialized).not.toContain("Client gagné");
    expect(serialized).not.toContain("Lead perdu");
    expect(serialized).not.toContain("Lead sans action");
    expect(serialized).not.toContain("Projection du lead gagné");
    expect(serialized).toContain("Tâche manuelle à conserver");
    expect(serialized).toContain("1 lead(s) en meeting booked");
  });

  it("uses the CRM lead date before the legacy next-action date", () => {
    const message = buildDailyBriefMessage({
      data: data({
        leads: [
          {
            id: "lead-date-priority",
            leadDate: "2026-08-10T16:00:00+01:00",
            nextAction: "Relancer avec la bonne échéance",
            nextActionDate: "2026-08-08T12:00:00.000Z",
            status: "to-follow-up",
            topic: "Lead avec deux dates",
          },
        ],
      }),
      displayName: "Ali",
      now: new Date("2026-08-10T08:30:00.000Z"),
      timeZone: TIME_ZONE,
    });

    const blocks = message.blocks as Array<{ text?: { text?: string } }>;
    expect(blocks[2]?.text?.text).not.toContain("Lead avec deux dates");
    expect(blocks[3]?.text?.text).toContain("Lead avec deux dates");
  });

  it("loads the canonical lead deadline and drops only terminal projections", async () => {
    const queries = new Map<
      string,
      { selected?: string; statusValues?: readonly unknown[] }
    >();
    const rows = {
      crm_leads: [
        {
          company: null,
          contact: null,
          id: "active-lead",
          lead_date: "2026-08-12T16:00:00+01:00",
          next_action: "Préparer le rendez-vous",
          next_action_date: "2026-08-01T12:00:00.000Z",
          next_action_state: "pending",
          status: "meeting-booked",
          topic: "Lead actif",
        },
      ],
      crm_tasks: [
        {
          due_date: "2026-08-08T12:00:00.000Z",
          id: "terminal-projection",
          lead: { status: "won" },
          lead_id: "won-lead",
          status: "todo",
          task_kind: "lead-next-action",
          title: "Projection à écarter",
        },
        {
          due_date: "2026-08-08T12:00:00.000Z",
          id: "terminal-manual",
          lead: { status: "won" },
          lead_id: "won-lead",
          status: "todo",
          task_kind: "manual",
          title: "Tâche manuelle à garder",
        },
      ],
    };
    const supabase = {
      from: vi.fn((table: keyof typeof rows) => {
        const query = queries.get(table) ?? {};
        queries.set(table, query);
        const builder = {
          eq: () => builder,
          in: (column: string, values: readonly unknown[]) => {
            if (column === "status") query.statusValues = values;
            return builder;
          },
          is: () => builder,
          limit: () => builder,
          order: () => builder,
          select: (columns: string) => {
            query.selected = columns;
            return builder;
          },
          then: <TResult1 = unknown, TResult2 = never>(
            onfulfilled?:
              ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?:
              ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) =>
            Promise.resolve({ data: rows[table], error: null }).then(
              onfulfilled,
              onrejected,
            ),
        };
        return builder;
      }),
    };

    const loaded = await loadDailyBriefData({
      now: new Date("2026-08-10T08:30:00.000Z"),
      supabase: supabase as never,
      user: {
        email: "ali@qarizmi.com",
        fullName: "Ali",
        organizationId: "org-1",
        profileId: "profile-1",
        role: "owner",
      },
    });

    expect(loaded.leads[0]?.nextActionDate).toBe("2026-08-12T16:00:00+01:00");
    expect(loaded.tasks.map((task) => task.id)).toEqual(["terminal-manual"]);
    expect(queries.get("crm_tasks")?.selected).toContain(
      "lead:lead_id(status)",
    );
    expect(queries.get("crm_leads")?.statusValues).not.toContain("won");
    expect(queries.get("crm_leads")?.statusValues).not.toContain("dead-end");
  });
});
