import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { deleteAllNotifications } from "./actions";
import {
  buildCrmReminderNotificationId,
  parseCrmReminderNotificationId,
} from "./reminder-keys";

type QueryOperation = "delete" | "insert" | "select";

type QueryState = {
  table: string;
  operation: QueryOperation;
  payload?: unknown;
};

type QueryResponder = (state: QueryState) => unknown;

type FakeQueryBuilder = {
  delete: () => FakeQueryBuilder;
  eq: () => FakeQueryBuilder;
  insert: (payload: unknown) => FakeQueryBuilder;
  limit: () => FakeQueryBuilder;
  not: () => FakeQueryBuilder;
  select: () => FakeQueryBuilder;
  single: () => Promise<unknown>;
  then: (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise<unknown>;
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
      const state: QueryState = { operation: "select", table };
      const builder: FakeQueryBuilder = {
        delete() {
          state.operation = "delete";
          return builder;
        },
        eq() {
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
