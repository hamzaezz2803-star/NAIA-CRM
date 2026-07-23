import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import {
  deleteAllNotifications,
  deleteNotification,
  getNotifications,
  markNotificationAsRead,
} from "./actions";
import {
  buildCrmReminderNotificationId,
  parseCrmReminderNotificationId,
} from "./reminder-keys";

type QueryOperation = "delete" | "insert" | "select" | "update";

type QueryState = {
  filters: { column: string; value: unknown }[];
  table: string;
  operation: QueryOperation;
  payload?: unknown;
};

type QueryResponder = (state: QueryState) => unknown;

type FakeQueryBuilder = {
  delete: () => FakeQueryBuilder;
  eq: (column: string, value: unknown) => FakeQueryBuilder;
  insert: (payload: unknown) => FakeQueryBuilder;
  limit: () => FakeQueryBuilder;
  not: () => FakeQueryBuilder;
  order: () => FakeQueryBuilder;
  select: () => FakeQueryBuilder;
  single: () => Promise<unknown>;
  then: (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  update: (payload: unknown) => FakeQueryBuilder;
};

function createFakeSupabase(respond: QueryResponder) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    from(table: string) {
      const state: QueryState = { filters: [], operation: "select", table };
      const builder: FakeQueryBuilder = {
        delete() {
          state.operation = "delete";
          return builder;
        },
        eq(column, value) {
          state.filters.push({ column, value });
          return builder;
        },
        insert(payload: unknown) {
          state.operation = "insert";
          state.payload = payload;
          return builder;
        },
        limit() {
          return builder;
        },
        not() {
          return builder;
        },
        order() {
          return builder;
        },
        select() {
          state.operation = "select";
          return builder;
        },
        single: async () => respond(state),
        then(
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(respond(state)).then(resolve, reject);
        },
        update(payload: unknown) {
          state.operation = "update";
          state.payload = payload;
          return builder;
        },
      };

      return builder;
    },
  };
}

function membershipResponse(state: QueryState) {
  if (
    state.table === "organization_memberships" &&
    state.operation === "select"
  ) {
    return { data: { organization_id: "org-1" }, error: null };
  }

  return null;
}

describe("buildCrmReminderNotificationId", () => {
  it("construit une clé composite avec la date au format YYYY-MM-DD", () => {
    const id = buildCrmReminderNotificationId(
      "lead-123",
      "2026-07-22T10:00:00Z",
    );
    expect(id).toBe("lead-reminder-lead-123:2026-07-22");
  });

  it("gère une date courte sans horodatage", () => {
    const id = buildCrmReminderNotificationId("lead-456", "2026-07-20");
    expect(id).toBe("lead-reminder-lead-456:2026-07-20");
  });

  it("gère une date vide", () => {
    const id = buildCrmReminderNotificationId("lead-789", "");
    expect(id).toBe("lead-reminder-lead-789");
  });
});

describe("parseCrmReminderNotificationId", () => {
  it("extrait le leadId, la dueDate et le compositeKey d'un identifiant composite", () => {
    const parsed = parseCrmReminderNotificationId(
      "lead-reminder-lead-123:2026-07-22",
    );
    expect(parsed.leadId).toBe("lead-123");
    expect(parsed.dueDate).toBe("2026-07-22");
    expect(parsed.compositeKey).toBe("lead-123:2026-07-22");
  });

  it("gère un identifiant sans date (format legacy)", () => {
    const parsed = parseCrmReminderNotificationId("lead-reminder-lead-123");
    expect(parsed.leadId).toBe("lead-123");
    expect(parsed.dueDate).toBeUndefined();
    expect(parsed.compositeKey).toBe("lead-123");
  });

  it("permet de préserver la date initiale même si la date du lead change en base", () => {
    // Si un rappel a été généré pour le 2026-07-20
    const originalNotificationId = buildCrmReminderNotificationId(
      "lead-abc",
      "2026-07-20",
    );
    expect(originalNotificationId).toBe("lead-reminder-lead-abc:2026-07-20");

    // Quand l'utilisateur clique sur "supprimer", le parse conserve la date d'origine (2026-07-20)
    // même si entre-temps le lead a été mis à jour pour le 2026-07-25.
    const { compositeKey } = parseCrmReminderNotificationId(
      originalNotificationId,
    );
    expect(compositeKey).toBe("lead-abc:2026-07-20");
  });
});

describe("deleteAllNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aborts without deleting notifications when CRM reminders cannot be loaded", async () => {
    const operations: QueryState[] = [];
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase((state) => {
        operations.push({ ...state });
        const membership = membershipResponse(state);
        if (membership) return membership;

        if (state.table === "crm_leads" && state.operation === "select") {
          return { data: null, error: { message: "CRM unavailable" } };
        }

        return { data: null, error: null };
      }),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(deleteAllNotifications()).resolves.toBe(false);
    expect(
      operations.some(
        (state) =>
          state.table === "notifications" && state.operation === "delete",
      ),
    ).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "Database error loading CRM reminders before deleting notifications:",
      { message: "CRM unavailable" },
    );

    consoleError.mockRestore();
  });

  it("aborts without deleting notifications when reminder tombstones cannot be saved", async () => {
    const operations: QueryState[] = [];
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase((state) => {
        operations.push({ ...state });
        const membership = membershipResponse(state);
        if (membership) return membership;

        if (state.table === "crm_leads" && state.operation === "select") {
          return {
            data: [
              {
                id: "lead-1",
                lead_date: "2000-01-01",
                next_action_date: null,
                topic: "Lead test",
              },
            ],
            error: null,
          };
        }

        if (state.table === "notifications" && state.operation === "insert") {
          return { data: null, error: { message: "Insert failed" } };
        }

        return { data: null, error: null };
      }),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(deleteAllNotifications()).resolves.toBe(false);
    expect(
      operations.some(
        (state) =>
          state.table === "notifications" && state.operation === "delete",
      ),
    ).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "Database error preserving CRM reminder dismissals:",
      { message: "Insert failed" },
    );

    consoleError.mockRestore();
  });

  it("persists reminder tombstones before deleting ordinary notifications", async () => {
    const operations: QueryState[] = [];
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase((state) => {
        operations.push({
          ...state,
          payload: state.payload,
        });
        const membership = membershipResponse(state);
        if (membership) return membership;

        if (state.table === "crm_leads" && state.operation === "select") {
          return {
            data: [
              {
                id: "lead-1",
                lead_date: "2000-01-01",
                next_action_date: null,
                topic: "Lead test",
              },
            ],
            error: null,
          };
        }

        return { data: null, error: null };
      }),
    );

    await expect(deleteAllNotifications()).resolves.toBe(true);

    const notificationOperations = operations.filter(
      (state) => state.table === "notifications",
    );
    expect(notificationOperations.map((state) => state.operation)).toEqual([
      "insert",
      "delete",
    ]);
    expect(notificationOperations[0]?.payload).toEqual([
      expect.objectContaining({
        description: "lead-1:2000-01-01",
        title: "lead-reminder-dismissed",
      }),
    ]);
  });
});

describe("CRM reminder persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
  });

  it("hides only the dismissed due date and exposes a rescheduled reminder", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase((state) => {
        const membership = membershipResponse(state);
        if (membership) return membership;

        if (state.table === "notifications" && state.operation === "select") {
          return {
            data: [
              {
                created_at: "2026-07-20T12:00:00.000Z",
                description: "lead-1:2026-07-20",
                id: "marker-dismissed",
                is_read: true,
                link_url: null,
                title: "lead-reminder-dismissed",
                type: "system",
              },
            ],
            error: null,
          };
        }

        if (state.table === "crm_leads" && state.operation === "select") {
          return {
            data: [
              {
                id: "lead-1",
                lead_date: "2026-07-23T09:00:00.000Z",
                next_action: "Relancer après le nouveau rendez-vous",
                next_action_date: null,
                topic: "HPS",
              },
            ],
            error: null,
          };
        }

        return { data: null, error: null };
      }),
    );

    await expect(getNotifications()).resolves.toEqual([
      expect.objectContaining({
        id: "lead-reminder-lead-1:2026-07-23",
        is_read: false,
        title: "Rappel Lead : HPS",
      }),
    ]);
  });

  it("restores the read state only for the exact lead and due date", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase((state) => {
        const membership = membershipResponse(state);
        if (membership) return membership;

        if (state.table === "notifications" && state.operation === "select") {
          return {
            data: [
              {
                created_at: "2026-07-23T12:00:00.000Z",
                description: "lead-1:2026-07-23",
                id: "marker-read",
                is_read: true,
                link_url: null,
                title: "lead-reminder-read",
                type: "system",
              },
            ],
            error: null,
          };
        }

        if (state.table === "crm_leads" && state.operation === "select") {
          return {
            data: [
              {
                id: "lead-1",
                lead_date: "2026-07-23T09:00:00.000Z",
                next_action: "Relancer",
                next_action_date: null,
                topic: "HPS",
              },
              {
                id: "lead-2",
                lead_date: "2026-07-23T10:00:00.000Z",
                next_action: "Préparer la proposition",
                next_action_date: null,
                topic: "OCP",
              },
            ],
            error: null,
          };
        }

        return { data: null, error: null };
      }),
    );

    const notifications = await getNotifications();

    expect(
      notifications.find(
        (notification) => notification.id === "lead-reminder-lead-1:2026-07-23",
      )?.is_read,
    ).toBe(true);
    expect(
      notifications.find(
        (notification) => notification.id === "lead-reminder-lead-2:2026-07-23",
      )?.is_read,
    ).toBe(false);
  });

  it.each([
    ["read", markNotificationAsRead, "lead-reminder-read"],
    ["dismissed", deleteNotification, "lead-reminder-dismissed"],
  ])(
    "stores the exact composite key when a reminder is marked %s",
    async (_stateLabel, action, markerTitle) => {
      const operations: QueryState[] = [];
      mocks.createServerSupabaseClient.mockResolvedValue(
        createFakeSupabase((state) => {
          operations.push({
            ...state,
            filters: [...state.filters],
          });
          const membership = membershipResponse(state);
          if (membership) return membership;

          return { data: null, error: null };
        }),
      );

      await expect(action("lead-reminder-lead-1:2026-07-23")).resolves.toBe(
        true,
      );

      expect(
        operations.find(
          (state) =>
            state.table === "notifications" && state.operation === "insert",
        )?.payload,
      ).toEqual(
        expect.objectContaining({
          description: "lead-1:2026-07-23",
          profile_id: "user-1",
          title: markerTitle,
        }),
      );
    },
  );
});
