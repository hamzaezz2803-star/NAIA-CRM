import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown>,
  createServerSupabaseClient: vi.fn(),
  createSystemNotification: vi.fn(),
  ensureClientDriveFolder: vi.fn(),
  extractCrmLeadWithGroq: vi.fn(),
  generateCrmFollowUpWithGroq: vi.fn(),
  getGoogleWorkspaceAccessToken: vi.fn(),
  isDriveServiceConfigured: vi.fn(() => true),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    mocks.afterCallbacks.push(callback);
  },
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

vi.mock("@/platform/notifications/actions", () => ({
  createSystemNotification: mocks.createSystemNotification,
}));

vi.mock("@/platform/integrations/google-drive-service", () => ({
  ensureClientDriveFolder: mocks.ensureClientDriveFolder,
  isDriveServiceConfigured: mocks.isDriveServiceConfigured,
}));

vi.mock("@/platform/integrations/google-workspace", () => ({
  getGoogleWorkspaceAccessToken: mocks.getGoogleWorkspaceAccessToken,
}));

vi.mock("./ai", () => ({
  extractCrmLeadWithGroq: mocks.extractCrmLeadWithGroq,
  generateCrmFollowUpWithGroq: mocks.generateCrmFollowUpWithGroq,
}));

import {
  checkGoogleAuthAction,
  createGoogleDriveFolderAction,
  createLeadAction,
  deleteLeadAction,
  disconnectGoogleAuthAction,
  extractLeadFromNaturalTextAction,
  fetchCompanyDetailAction,
  generateFollowUpDraftAction,
  syncLeadToGoogleCalendarAction,
  updateLeadAction,
  updateLeadStatusAction,
  type CrmActionContext,
} from "./actions";

describe("fetchCompanyDetailAction dummy fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue(null);
    vi.stubEnv("CRM_DUMMY_DATA", "enabled");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the selected demo company with its contacts and leads", async () => {
    const result = await fetchCompanyDetailAction("demo-company-atlas-process");

    expect(result.company?.name).toBe("Atlas Process Industries");
    expect(result.contacts.map(({ name }) => name)).toEqual([
      "Yassine Berrada",
    ]);
    expect(result.leads.map(({ topic }) => topic)).toEqual([
      "Atlas Process Industries - cockpit finance + CRM",
    ]);
  });

  it("keeps unknown demo companies inaccessible", async () => {
    await expect(
      fetchCompanyDetailAction("demo-company-unknown"),
    ).resolves.toEqual({ company: null, contacts: [], leads: [] });
  });
});

type QueryState = {
  table: string;
  op: "delete" | "insert" | "rpc" | "select" | "update";
  columns?: string;
  functionName?: string;
  filters?: Array<[string, unknown]>;
  payload?: unknown;
};

type QueryResponder = (state: QueryState) => unknown;

type FakeQueryBuilder = {
  delete: () => FakeQueryBuilder;
  eq: (column: string, value: unknown) => FakeQueryBuilder;
  insert: (payload: unknown) => FakeQueryBuilder;
  is: (column: string, value: unknown) => FakeQueryBuilder;
  limit: () => FakeQueryBuilder;
  maybeSingle: () => Promise<unknown>;
  order: () => FakeQueryBuilder;
  select: (columns?: string) => FakeQueryBuilder;
  single: () => Promise<unknown>;
  then: (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  update: (payload: unknown) => FakeQueryBuilder;
};

/** Runs the callbacks deferred with next/server after() by the actions. */
async function flushAfterCallbacks() {
  const callbacks = mocks.afterCallbacks.splice(0);
  for (const callback of callbacks) {
    await callback();
  }
}

function createFakeSupabase(respond: QueryResponder) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { email: "ali@qarizmi.com", id: "user-1" } },
        error: null,
      }),
    },
    from(table: string) {
      const state: QueryState = { op: "select", table };
      const builder: FakeQueryBuilder = {
        delete() {
          state.op = "delete";
          return builder;
        },
        eq(column: string, value: unknown) {
          state.filters ??= [];
          state.filters.push([column, value]);
          return builder;
        },
        insert(payload: unknown) {
          state.op = "insert";
          state.payload = payload;
          return builder;
        },
        is(column: string, value: unknown) {
          state.filters ??= [];
          state.filters.push([column, value]);
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle: async () => respond(state),
        order() {
          return builder;
        },
        select(columns?: string) {
          if (state.op === "select") state.columns = columns;
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
          state.op = "update";
          state.payload = payload;
          return builder;
        },
      };
      return builder;
    },
    rpc(functionName: string, payload: unknown) {
      return Promise.resolve(
        respond({
          functionName,
          op: "rpc",
          payload,
          table: "rpc",
        }),
      );
    },
  };
}

function respondForLead({
  companyName,
  accessScope = "organization",
  driveFolderUrl = null,
  previousStatus = "contacted",
  onUpdate,
}: {
  companyName: string | null;
  accessScope?: "cofounders" | "organization";
  driveFolderUrl?: string | null;
  previousStatus?: string;
  onUpdate?: (state: QueryState) => void;
}): QueryResponder {
  return (state) => {
    if (state.op === "rpc" && state.functionName === "update_crm_lead_atomic") {
      return {
        data: {
          access_scope: accessScope,
          company_id: companyName ? "company-1" : null,
          contact_id: null,
          lead_id: "lead-1",
        },
        error: null,
      };
    }
    if (state.op === "update") {
      onUpdate?.(state);
      return { data: [{ id: "lead-1" }], error: null };
    }
    if (state.table === "organization_memberships") {
      return { data: { organization_id: "org-1" }, error: null };
    }
    if (state.table === "crm_leads" && state.op === "select") {
      // The pre-update transition check only reads the status column.
      if (state.columns === "status") {
        return { data: { status: previousStatus }, error: null };
      }
      return {
        data: {
          access_scope: accessScope,
          company: companyName ? { name: companyName } : null,
          company_id: companyName ? "company-1" : null,
          drive_folder_url: driveFolderUrl,
          notes: null,
        },
        error: null,
      };
    }
    if (state.table === "crm_companies" && state.op === "select") {
      return { data: { drive_folder_url: null }, error: null };
    }
    return { data: null, error: null };
  };
}

describe("CRM Google connection scope quarantine", () => {
  it("keeps the legacy disconnect server action fail-closed", async () => {
    await expect(disconnectGoogleAuthAction()).resolves.toEqual({
      error:
        "Déconnexion Google sécurisée requise depuis le flux de révocation.",
      success: false,
    });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  const broadDriveScope = "https://www.googleapis.com/auth/drive.readonly";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports a connected Google account as unavailable when it retains a broad Drive scope", async () => {
    const queries: QueryState[] = [];
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase((state) => {
        queries.push({ ...state });
        if (state.table === "organization_memberships") {
          return {
            data:
              state.columns === "role"
                ? { role: "member" }
                : { organization_id: "org-1" },
            error: null,
          };
        }
        if (state.table === "integration_connections") {
          return {
            data: { scopes: [broadDriveScope], status: "connected" },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    );

    await expect(checkGoogleAuthAction()).resolves.toBe(false);
    expect(queries).toContainEqual(
      expect.objectContaining({
        columns: "status,scopes",
        op: "select",
        table: "integration_connections",
      }),
    );
  });

  it("does not read credentials or call Google when Calendar sync sees a broad Drive scope", async () => {
    const credentialRead = vi.fn(() =>
      JSON.stringify({
        access_token: "legacy-access-token",
        expiry_date: 0,
        refresh_token: "legacy-refresh-token",
      }),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Google must remain unreachable"));
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");

    const connection = {
      id: "google-connection-1",
      scopes: [broadDriveScope],
      status: "connected",
    } as Record<string, unknown>;
    Object.defineProperty(connection, "encrypted_token_reference", {
      enumerable: true,
      get: credentialRead,
    });

    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase((state) => {
        if (state.table === "organization_memberships") {
          return {
            data:
              state.columns === "role"
                ? { role: "member" }
                : { organization_id: "org-1" },
            error: null,
          };
        }
        if (state.table === "crm_leads" && state.op === "select") {
          return {
            data: {
              access_scope: "organization",
              id: "lead-1",
              lead_date: "2026-08-11T09:00:00.000Z",
              next_action_date: null,
              notes: null,
              organization_id: "org-1",
              topic: "Client meeting",
              updated_at: "2026-08-10T01:00:00.000Z",
            },
            error: null,
          };
        }
        if (state.table === "integration_connections") {
          if (
            state.columns ===
            "id,organization_id,connected_by_profile_id,status,scopes"
          ) {
            return {
              data: {
                connected_by_profile_id: "user-1",
                id: "google-connection-1",
                organization_id: "org-1",
                scopes: [broadDriveScope],
                status: "connected",
              },
              error: null,
            };
          }
          return {
            data: {
              ...connection,
              connected_by_profile_id: "user-1",
              organization_id: "org-1",
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    );

    await expect(syncLeadToGoogleCalendarAction("lead-1")).resolves.toEqual({
      error:
        "Google Workspace non connecté ou autorisations à revalider. Veuillez reconnecter votre compte Google.",
      success: false,
    });
    expect(credentialRead).not.toHaveBeenCalled();
    expect(mocks.getGoogleWorkspaceAccessToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

describe("CRM external AI authorization boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function aiClient(lead: Record<string, unknown> | null = null) {
    return createFakeSupabase((state) => {
      if (state.table === "organization_memberships") {
        return {
          data: { organization_id: "org-1", role: "owner" },
          error: null,
        };
      }
      if (state.table === "crm_leads") {
        return { data: lead, error: null };
      }
      return { data: null, error: null };
    });
  }

  it("never calls Groq for an unauthenticated extraction", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(null);

    await expect(
      extractLeadFromNaturalTextAction("Nouveau lead Atlas"),
    ).resolves.toEqual({ error: "Not configured", success: false });
    expect(mocks.extractCrmLeadWithGroq).not.toHaveBeenCalled();
  });

  it.each([
    ["oversize", "x".repeat(4_001)],
    ["sensitive", "Prépare une fiche pour la candidate stagiaire Sara"],
  ])("rejects %s extraction text before Groq", async (_label, text) => {
    mocks.createServerSupabaseClient.mockResolvedValue(aiClient());

    const result = await extractLeadFromNaturalTextAction(text);

    expect(result.success).toBe(false);
    expect(mocks.extractCrmLeadWithGroq).not.toHaveBeenCalled();
  });

  it("extracts a bounded ordinary lead after exact membership authorization", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(aiClient());
    mocks.extractCrmLeadWithGroq.mockResolvedValue({
      status: "lead-to-contact",
      topic: "Atlas AI discovery",
    });

    await expect(
      extractLeadFromNaturalTextAction("Nouveau lead Atlas AI discovery"),
    ).resolves.toEqual({
      extracted: {
        status: "lead-to-contact",
        topic: "Atlas AI discovery",
      },
      success: true,
    });
    expect(mocks.extractCrmLeadWithGroq).toHaveBeenCalledWith(
      "Nouveau lead Atlas AI discovery",
    );
  });

  it("accepts only a lead ID and never trusts a forged browser draft payload", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(aiClient());

    const result = await generateFollowUpDraftAction({
      notes: "secret",
      topic: "forged",
    } as unknown as string);

    expect(result).toEqual({
      error: "Identifiant de lead invalide.",
      success: false,
    });
    expect(mocks.generateCrmFollowUpWithGroq).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-tenant or missing", null],
    [
      "confidential",
      {
        access_scope: "cofounders",
        company: null,
        contact: null,
        id: "lead-1",
        next_action: null,
        notes: "Entretien stagiaire",
        organization_id: "org-1",
        topic: "Candidate",
      },
    ],
  ])("rejects a %s canonical lead before Groq", async (_label, lead) => {
    mocks.createServerSupabaseClient.mockResolvedValue(aiClient(lead));

    const result = await generateFollowUpDraftAction("lead-1");

    expect(result.success).toBe(false);
    expect(mocks.generateCrmFollowUpWithGroq).not.toHaveBeenCalled();
  });

  it("loads the canonical active organization lead before generating a draft", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      aiClient({
        access_scope: "organization",
        company: {
          access_scope: "organization",
          archived_at: null,
          name: "Atlas",
        },
        contact: {
          access_scope: "organization",
          archived_at: null,
          name: "Amine",
        },
        id: "lead-1",
        next_action: "Relancer mardi",
        notes: "Démo réalisée",
        organization_id: "org-1",
        topic: "Atlas AI discovery",
      }),
    );
    mocks.generateCrmFollowUpWithGroq.mockResolvedValue({
      email: "Bonjour Amine",
      whatsapp: "Bonjour Amine",
    });

    const result = await generateFollowUpDraftAction("lead-1");

    expect(result.success).toBe(true);
    expect(mocks.generateCrmFollowUpWithGroq).toHaveBeenCalledWith({
      companyName: "Atlas",
      contactName: "Amine",
      nextAction: "Relancer mardi",
      notes: "Démo réalisée",
      topic: "Atlas AI discovery",
    });
  });
});

const calendarScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/gmail.readonly",
];

type CalendarTestLead = {
  access_scope: "cofounders" | "organization";
  id: string;
  lead_date: string | null;
  next_action_date: string | null;
  notes: string | null;
  organization_id: string;
  topic: string;
  updated_at: string;
};

function calendarTestLead(
  overrides: Partial<CalendarTestLead> = {},
): CalendarTestLead {
  return {
    access_scope: "organization",
    id: "lead-1",
    lead_date: "2026-08-11T09:00:00.000Z",
    next_action_date: null,
    notes: null,
    organization_id: "org-1",
    topic: "Client meeting",
    updated_at: "2026-08-10T01:00:00.000Z",
    ...overrides,
  };
}

function createCalendarBoundaryResponder({
  deleteMatches = true,
  dropLinkAfterWrite = false,
  leads = [calendarTestLead()],
  roles = ["member"],
  updateMatches = true,
}: {
  deleteMatches?: boolean;
  dropLinkAfterWrite?: boolean;
  leads?: CalendarTestLead[];
  roles?: Array<"admin" | "member" | "owner" | "viewer">;
  updateMatches?: boolean | boolean[];
} = {}): { queries: QueryState[]; respond: QueryResponder } {
  const queries: QueryState[] = [];
  let currentLead = { ...leads[0] };
  let leadReadCount = 0;
  let roleReadCount = 0;
  let updateReadCount = 0;
  let shouldDropLink = false;

  return {
    queries,
    respond: (state) => {
      queries.push({ ...state, filters: [...(state.filters ?? [])] });
      if (state.table === "organization_memberships") {
        if (state.columns === "organization_id") {
          return { data: { organization_id: "org-1" }, error: null };
        }
        const role = roles[Math.min(roleReadCount, roles.length - 1)];
        roleReadCount += 1;
        return { data: { role }, error: null };
      }
      if (state.table === "integration_connections") {
        return {
          data: {
            connected_by_profile_id: "user-1",
            id: "google-connection-1",
            organization_id: "org-1",
            scopes: calendarScopes,
            status: "connected",
          },
          error: null,
        };
      }
      if (state.table === "crm_leads" && state.op === "update") {
        const updateMatch = Array.isArray(updateMatches)
          ? (updateMatches[updateReadCount] ?? false)
          : updateMatches;
        updateReadCount += 1;
        if (!updateMatch) return { data: null, error: null };
        const payload = state.payload as {
          notes: string | null;
          updated_at: string;
        };
        currentLead = {
          ...currentLead,
          notes: payload.notes,
          updated_at: payload.updated_at,
        };
        shouldDropLink = dropLinkAfterWrite;
        return {
          data: {
            id: currentLead.id,
            notes: currentLead.notes,
            updated_at: currentLead.updated_at,
          },
          error: null,
        };
      }
      if (state.table === "crm_leads" && state.op === "delete") {
        return {
          data: deleteMatches ? { id: currentLead.id } : null,
          error: null,
        };
      }
      if (state.table === "crm_leads" && state.op === "select") {
        const nextLead = leads[leadReadCount];
        if (nextLead) {
          currentLead = { ...nextLead };
          leadReadCount += 1;
        }
        if (shouldDropLink) {
          shouldDropLink = false;
          return { data: { ...currentLead, notes: null }, error: null };
        }
        return { data: { ...currentLead }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

async function calendarCreateFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  if (String(input).includes("freeBusy")) {
    return new Response(
      JSON.stringify({ calendars: { primary: { busy: [] } } }),
      { status: 200 },
    );
  }
  if (init?.method === "GET") {
    return new Response(null, { status: 404 });
  }
  const body = JSON.parse(String(init?.body ?? "{}")) as { id?: string };
  return new Response(
    JSON.stringify({
      htmlLink: "https://calendar.google.com/event-1",
      id: body.id,
    }),
    { status: 200 },
  );
}

describe("CRM Calendar external authorization boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
    mocks.getGoogleWorkspaceAccessToken.mockResolvedValue("valid-access-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops before Calendar when the actor loses CRM update permission during token resolution", async () => {
    const boundary = createCalendarBoundaryResponder({
      roles: ["member", "viewer"],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(boundary.respond),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await syncLeadToGoogleCalendarAction("lead-1");

    expect(result).toEqual({
      error: "Tu n'as plus la permission de synchroniser ce lead.",
      success: false,
    });
    expect(mocks.getGoogleWorkspaceAccessToken).toHaveBeenCalledWith(
      {
        expectedConnectionId: "google-connection-1",
        requiredScopes: [
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.freebusy",
        ],
      },
      {
        organizationId: "org-1",
        profileId: "user-1",
        supabase: expect.anything(),
      },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stops before Calendar when the lead becomes confidential during token resolution", async () => {
    const boundary = createCalendarBoundaryResponder({
      leads: [
        calendarTestLead(),
        calendarTestLead({ access_scope: "cofounders" }),
      ],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(boundary.respond),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await syncLeadToGoogleCalendarAction("lead-1");

    expect(result).toEqual({
      error:
        "Synchronisation Calendar désactivée pour les leads confidentiels.",
      success: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not mutate Calendar when the lead revision changes during freebusy", async () => {
    const boundary = createCalendarBoundaryResponder({
      leads: [
        calendarTestLead(),
        calendarTestLead(),
        calendarTestLead({ updated_at: "2026-08-10T01:00:01.000Z" }),
      ],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(boundary.respond),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), {
        status: 200,
      }),
    );

    const result = await syncLeadToGoogleCalendarAction("lead-1");

    expect(result.success).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("freeBusy");
    expect(
      fetchSpy.mock.calls.some(
        ([, init]) =>
          ["DELETE", "PATCH", "POST"].includes(init?.method ?? "GET") &&
          !String(fetchSpy.mock.calls[0]?.[0]).includes("freeBusy"),
      ),
    ).toBe(false);
  });

  it("does not claim a link when the conditional CRM write matches zero rows", async () => {
    const boundary = createCalendarBoundaryResponder({ updateMatches: false });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(boundary.respond),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(calendarCreateFetch);

    const result = await syncLeadToGoogleCalendarAction("lead-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("aucune liaison n'a été enregistrée");
    expect(
      boundary.queries.find((query) => query.op === "update")?.filters,
    ).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-1"],
        ["access_scope", "organization"],
        ["updated_at", "2026-08-10T01:00:00.000Z"],
        ["archived_at", null],
      ]),
    );
  });

  it("reconciles the deterministic event after a DB-zero retry without a second insert", async () => {
    const boundary = createCalendarBoundaryResponder({
      updateMatches: [false, true],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(boundary.respond),
    );
    let storedEventId: string | undefined;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (String(input).includes("freeBusy")) {
          return new Response(
            JSON.stringify({ calendars: { primary: { busy: [] } } }),
            { status: 200 },
          );
        }
        if (init?.method === "GET") {
          return storedEventId
            ? new Response(
                JSON.stringify({
                  htmlLink: "https://calendar.google.com/event-1",
                  id: storedEventId,
                }),
                { status: 200 },
              )
            : new Response(null, { status: 404 });
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          id?: string;
        };
        storedEventId = body.id;
        return new Response(
          JSON.stringify({
            htmlLink: "https://calendar.google.com/event-1",
            id: storedEventId,
          }),
          { status: 200 },
        );
      });

    const first = await syncLeadToGoogleCalendarAction("lead-1");
    const second = await syncLeadToGoogleCalendarAction("lead-1");

    expect(first.success).toBe(false);
    expect(second.success).toBe(true);
    const eventInsertCalls = fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/calendar/v3/calendars/primary/events?") &&
        init?.method === "POST",
    );
    expect(eventInsertCalls).toHaveLength(1);
    expect(JSON.parse(String(eventInsertCalls[0]?.[1]?.body)).id).toBe(
      storedEventId,
    );
  });

  it("fails closed when the final re-read no longer confirms the stored link", async () => {
    const boundary = createCalendarBoundaryResponder({
      dropLinkAfterWrite: true,
    });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(boundary.respond),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(calendarCreateFetch);

    const result = await syncLeadToGoogleCalendarAction("lead-1");

    expect(result).toEqual({
      error: "La liaison Calendar finale n'a pas été confirmée.",
      success: false,
    });
  });

  it("creates and confirms an actor-owned Calendar event on the happy path", async () => {
    const boundary = createCalendarBoundaryResponder();
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(boundary.respond),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(calendarCreateFetch);

    const result = await syncLeadToGoogleCalendarAction("lead-1");

    expect(result.success).toBe(true);
    expect(result.calendarLink).toBe("https://calendar.google.com/event-1");
    const createCall = fetchSpy.mock.calls.find(
      ([, init]) =>
        String(init?.method).includes("POST") &&
        !String(init?.body).includes('"items"'),
    );
    expect(String(createCall?.[0])).toContain("sendUpdates=none");
    expect(String(createCall?.[1]?.body)).toContain("Client meeting");
    expect(
      boundary.queries.some(
        ({ columns, table }) =>
          table === "integration_connections" && columns === "*",
      ),
    ).toBe(false);
    expect(mocks.getGoogleWorkspaceAccessToken).toHaveBeenCalledWith(
      {
        expectedConnectionId: "google-connection-1",
        requiredScopes: [
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.freebusy",
        ],
      },
      {
        organizationId: "org-1",
        profileId: "user-1",
        supabase: expect.anything(),
      },
    );
  });

  it("revalidates confidentiality immediately before deleteLeadAction touches Calendar", async () => {
    const notes =
      "[Google Calendar Event ID: event-1]\n[Google Calendar Event Owner: user-1]\n[Google Calendar Event Link: https://calendar.google.com/event-1]";
    const boundary = createCalendarBoundaryResponder({
      leads: [
        calendarTestLead({ notes }),
        calendarTestLead({ notes }),
        calendarTestLead({ access_scope: "cofounders", notes }),
      ],
      roles: ["owner"],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(boundary.respond),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await deleteLeadAction("lead-1");

    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(boundary.queries.some((query) => query.op === "delete")).toBe(false);
  });

  it("deletes the owned Calendar event and exact CRM revision on the happy path", async () => {
    const notes =
      "[Google Calendar Event ID: event-1]\n[Google Calendar Event Owner: user-1]\n[Google Calendar Event Link: https://calendar.google.com/event-1]";
    const boundary = createCalendarBoundaryResponder({
      leads: [calendarTestLead({ notes })],
      roles: ["owner"],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(boundary.respond),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteLeadAction("lead-1")).resolves.toEqual({
      success: true,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("event-1?sendUpdates=none"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(mocks.getGoogleWorkspaceAccessToken).toHaveBeenCalledWith(
      {
        expectedConnectionId: "google-connection-1",
        requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
      },
      {
        organizationId: "org-1",
        profileId: "user-1",
        supabase: expect.anything(),
      },
    );
    expect(
      boundary.queries.find((query) => query.op === "delete")?.filters,
    ).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-1"],
        ["access_scope", "organization"],
        ["updated_at", "2026-08-10T01:00:00.000Z"],
        ["archived_at", null],
      ]),
    );
  });
});

describe("CRM lead status Drive folder creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
    mocks.isDriveServiceConfigured.mockReturnValue(true);
    mocks.ensureClientDriveFolder.mockResolvedValue({
      created: true,
      folderId: "client-folder",
      folderUrl: "https://drive.google.com/drive/folders/client-folder",
    });
  });

  it("creates the client Drive folder when a lead moves to meeting-booked", async () => {
    const driveUrlUpdates: QueryState[] = [];
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(
        respondForLead({
          companyName: "Total Energies",
          onUpdate: (state) => {
            if (
              (state.payload as { drive_folder_url?: string })?.drive_folder_url
            ) {
              driveUrlUpdates.push(state);
            }
          },
        }),
      ),
    );

    const result = await updateLeadStatusAction("lead-1", "meeting-booked");

    // The Drive work is deferred after the response, never awaited inline.
    expect(result).toEqual({ success: true });
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();

    await flushAfterCallbacks();

    expect(mocks.ensureClientDriveFolder).toHaveBeenCalledWith(
      "Total Energies",
    );
    expect(driveUrlUpdates.map((state) => state.table)).toEqual([
      "crm_leads",
      "crm_companies",
    ]);
  });

  it("does not touch Drive for other status transitions", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(respondForLead({ companyName: "Total Energies" })),
    );

    const result = await updateLeadStatusAction("lead-1", "contacted");
    await flushAfterCallbacks();

    expect(result).toEqual({ success: true });
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();
  });

  it("never creates a Drive folder for a confidential lead", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(
        respondForLead({
          accessScope: "cofounders",
          companyName: "Confidential Candidate",
        }),
      ),
    );

    const result = await updateLeadStatusAction("lead-1", "meeting-booked");
    await flushAfterCallbacks();

    expect(result).toEqual({ success: true });
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();
  });

  it("does not re-run Drive work when the lead was already meeting-booked", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(
        respondForLead({
          companyName: "Total Energies",
          previousStatus: "meeting-booked",
        }),
      ),
    );

    const result = await updateLeadStatusAction("lead-1", "meeting-booked");

    expect(result).toEqual({ success: true });
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();
  });

  it("reuses the existing lead folder instead of creating a new one", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(
        respondForLead({
          companyName: "Total Energies",
          driveFolderUrl: "https://drive.google.com/drive/folders/existing",
        }),
      ),
    );

    const result = await updateLeadStatusAction("lead-1", "meeting-booked");
    await flushAfterCallbacks();

    expect(result).toEqual({ success: true });
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();
  });

  it("skips folder creation when no company is resolved", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(respondForLead({ companyName: null })),
    );

    const result = await updateLeadStatusAction("lead-1", "meeting-booked");
    await flushAfterCallbacks();

    expect(result).toEqual({ success: true });
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();
  });

  it("keeps the status change successful when Drive fails", async () => {
    mocks.ensureClientDriveFolder.mockRejectedValue(
      new Error("Drive indisponible"),
    );
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(respondForLead({ companyName: "Total Energies" })),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await updateLeadStatusAction("lead-1", "meeting-booked");
    await flushAfterCallbacks();

    expect(result).toEqual({ success: true });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("creates the client Drive folder through updateLeadAction status changes", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(respondForLead({ companyName: "Total Energies" })),
    );

    const result = await updateLeadAction("lead-1", {
      status: "meeting-booked",
    });
    await flushAfterCallbacks();

    expect(result.success).toBe(true);
    expect(mocks.ensureClientDriveFolder).toHaveBeenCalledWith(
      "Total Energies",
    );
  });

  it("respects the explicit Drive opt-out in updateLeadAction", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(respondForLead({ companyName: "Total Energies" })),
    );

    const result = await updateLeadAction("lead-1", {
      skipGoogleDriveCreate: true,
      status: "meeting-booked",
    });

    expect(result.success).toBe(true);
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();
  });

  it("updates the lead and its tags through one atomic RPC", async () => {
    const terminalQueries: QueryState[] = [];
    const fallback = respondForLead({ companyName: "Total Energies" });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase((state) => {
        terminalQueries.push({ ...state });
        if (state.op === "rpc") {
          return { data: { active_tag_count: 2 }, error: null };
        }
        return fallback(state);
      }),
    );

    const result = await updateLeadAction("lead-1", {
      tagIds: ["tag-a", "tag-b"],
    });

    expect(result.success).toBe(true);
    expect(terminalQueries).toContainEqual(
      expect.objectContaining({
        functionName: "update_crm_lead_atomic",
        op: "rpc",
        payload: expect.objectContaining({
          requested_actor_profile_id: "user-1",
          requested_lead_id: "lead-1",
          requested_organization_id: "org-1",
          requested_updates: { tag_ids: ["tag-a", "tag-b"] },
        }),
      }),
    );
    expect(
      terminalQueries.some(
        (query) => query.table === "crm_lead_tags" && query.op === "delete",
      ),
    ).toBe(false);
  });

  it("never creates company/contact rows outside a rejected atomic edit", async () => {
    const terminalQueries: QueryState[] = [];
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase((state) => {
        terminalQueries.push({ ...state });
        if (
          state.op === "rpc" &&
          state.functionName === "update_crm_lead_atomic"
        ) {
          return {
            data: null,
            error: {
              code: "42501",
              message:
                "Only a cofounder may update a confidential CRM lead family",
            },
          };
        }
        if (state.table === "organization_memberships") {
          return { data: { organization_id: "org-1" }, error: null };
        }
        return { data: null, error: null };
      }),
    );

    const result = await updateLeadAction("lead-1", {
      notes: "Entreprise: Secret Interns\nContact: Candidate Person",
      topic: "Stage confidentiel",
    });

    expect(result).toEqual({
      error: "Only a cofounder may update a confidential CRM lead family",
      success: false,
    });
    expect(terminalQueries).toContainEqual(
      expect.objectContaining({
        functionName: "update_crm_lead_atomic",
        payload: expect.objectContaining({
          requested_auto_company_name: "Secret Interns",
          requested_auto_contact_name: "Candidate Person",
        }),
      }),
    );
    expect(
      terminalQueries.some(
        (query) =>
          ["delete", "insert", "update"].includes(query.op) &&
          ["crm_companies", "crm_contacts", "crm_leads"].includes(query.table),
      ),
    ).toBe(false);
  });
});

describe("manual CRM Drive folder authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
    mocks.isDriveServiceConfigured.mockReturnValue(true);
    mocks.ensureClientDriveFolder.mockResolvedValue({
      created: true,
      folderId: "client-folder",
      folderUrl: "https://drive.google.com/drive/folders/client-folder",
    });
  });

  function driveResponder({
    companyOrganizationId = "org-1",
    companyScope = "organization",
    lead = true,
    leadScope = "organization",
    role = "member",
    roleSequence,
    zeroCompanyUpdate = false,
  }: {
    companyOrganizationId?: string;
    companyScope?: "cofounders" | "organization";
    lead?: boolean;
    leadScope?: "cofounders" | "organization";
    role?: "member" | "viewer";
    roleSequence?: Array<"member" | "viewer">;
    zeroCompanyUpdate?: boolean;
  } = {}): QueryResponder {
    let companyFolderUrl: string | null = null;
    let leadFolderUrl: string | null = null;
    let roleReadCount = 0;

    return (state) => {
      if (state.table === "organization_memberships") {
        if (state.columns === "organization_id") {
          return { data: { organization_id: "org-1" }, error: null };
        }
        const currentRole = roleSequence?.[roleReadCount] ?? role;
        roleReadCount += 1;
        return { data: { role: currentRole }, error: null };
      }
      if (state.table === "crm_leads" && state.op === "select") {
        if (!lead) return { data: null, error: null };
        return {
          data: {
            access_scope: leadScope,
            company: {
              access_scope: companyScope,
              archived_at: null,
              drive_folder_url: companyFolderUrl,
              id: "company-1",
              name: "Canonical Client",
              organization_id: companyOrganizationId,
            },
            company_id: "company-1",
            drive_folder_url: leadFolderUrl,
            id: "lead-1",
          },
          error: null,
        };
      }
      if (state.table === "crm_companies" && state.op === "update") {
        if (zeroCompanyUpdate) return { data: null, error: null };
        companyFolderUrl =
          (state.payload as { drive_folder_url?: string }).drive_folder_url ??
          null;
        return { data: { id: "company-1" }, error: null };
      }
      if (state.table === "crm_leads" && state.op === "update") {
        leadFolderUrl =
          (state.payload as { drive_folder_url?: string }).drive_folder_url ??
          null;
        return { data: { id: "lead-1" }, error: null };
      }
      return { data: null, error: null };
    };
  }

  it.each([
    ["a cross-tenant company relation", { companyOrganizationId: "org-2" }],
    ["a missing lead", { lead: false }],
    ["a confidential lead", { leadScope: "cofounders" }],
    ["a confidential company", { companyScope: "cofounders" }],
    ["a read-only member", { role: "viewer" }],
  ] as const)("does not call Drive for %s", async (_label, options) => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(driveResponder(options)),
    );

    const result = await (
      createGoogleDriveFolderAction as unknown as (
        leadId: string,
        forgedCompanyName: string,
      ) => Promise<{ success: boolean }>
    )("lead-1", "Forged Browser Company");

    expect(result.success).toBe(false);
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();
  });

  it("derives the canonical company name server-side", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(driveResponder()),
    );

    const result = await (
      createGoogleDriveFolderAction as unknown as (
        leadId: string,
        forgedCompanyName: string,
      ) => Promise<{ success: boolean; folderLink?: string }>
    )("lead-1", "Forged Browser Company");

    expect(result).toEqual({
      folderLink: "https://drive.google.com/drive/folders/client-folder",
      success: true,
    });
    expect(mocks.ensureClientDriveFolder).toHaveBeenCalledWith(
      "Canonical Client",
    );
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalledWith(
      "Forged Browser Company",
    );
  });

  it("fails closed when a checked persistence update matches zero rows", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(driveResponder({ zeroCompanyUpdate: true })),
    );

    const result = await createGoogleDriveFolderAction("lead-1");

    expect(result.success).toBe(false);
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("plus modifiable"),
      }),
    );
  });

  it("revalidates membership immediately before calling Drive", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createFakeSupabase(
        driveResponder({ roleSequence: ["member", "viewer"] }),
      ),
    );

    const result = await createGoogleDriveFolderAction("lead-1");

    expect(result.success).toBe(false);
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();
  });
});

describe("createLeadAction contact enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
  });

  it("delegates company, contact, lead and tag writes to one atomic RPC", async () => {
    const atomicCalls: QueryState[] = [];
    const client = createFakeSupabase((state) => {
      if (
        state.op === "rpc" &&
        state.functionName === "create_crm_lead_atomic"
      ) {
        atomicCalls.push(state);
        return {
          data: {
            access_scope: "organization",
            company_id: "company-winxo",
            contact_id: "contact-youssef",
            lead_id: "lead-winxo",
          },
          error: null,
        };
      }
      if (state.table === "crm_leads" && state.op === "select") {
        return {
          data: {
            access_scope: "organization",
            company_id: "company-winxo",
            contact_id: "contact-youssef",
            contact_job_title: "Directeur d'exploitation",
            contact_linkedin_url: null,
            created_at: "2026-07-10T09:00:00.000Z",
            id: "lead-winxo",
            last_contacted_at: null,
            lead_date: null,
            next_action: "Envoyer la présentation",
            next_action_date: null,
            notes: "Contact téléphonique",
            organization_id: "org-1",
            source: "Slack",
            status: "contacted",
            topic: "Présentation pour Winxo",
            updated_at: "2026-07-10T09:00:00.000Z",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }) as unknown as SupabaseClient;

    const result = await createLeadAction(
      {
        companyName: "Winxo",
        contactEmail: "yzaidi@winxo.com",
        contactJobTitle: "Directeur d'exploitation",
        contactName: "Youssef Zaidi",
        contactPhone: "0661420960",
        skipGoogleCalendarSync: true,
        skipGoogleDriveCreate: true,
        status: "contacted",
        topic: "Présentation pour Winxo",
      },
      trustedContext(client),
    );

    expect(result.success).toBe(true);
    expect(atomicCalls).toHaveLength(1);
    expect(atomicCalls[0]?.payload).toMatchObject({
      requested_actor_profile_id: "profile-ali",
      requested_company_name: "Winxo",
      requested_contact_email: "yzaidi@winxo.com",
      requested_contact_job_title: "Directeur d'exploitation",
      requested_contact_name: "Youssef Zaidi",
      requested_contact_phone: "0661420960",
      requested_organization_id: "org-1",
      requested_topic: "Présentation pour Winxo",
    });
  });

  it("never calls Calendar or Drive for a confidential lead", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("provider call must stay unreachable"));
    const client = createFakeSupabase((state) => {
      if (state.op === "rpc") {
        return {
          data: {
            access_scope: "cofounders",
            company_id: "company-private",
            contact_id: "contact-private",
            lead_id: "lead-private",
          },
          error: null,
        };
      }
      if (state.table === "crm_leads" && state.op === "select") {
        return {
          data: {
            access_scope: "cofounders",
            company_id: "company-private",
            contact_id: "contact-private",
            contact_job_title: "Stagiaire",
            contact_linkedin_url: null,
            created_at: "2026-08-10T09:00:00.000Z",
            id: "lead-private",
            last_contacted_at: null,
            lead_date: "2026-08-11T09:00:00.000Z",
            next_action: "Entretien",
            next_action_date: null,
            notes: "Candidature stage",
            organization_id: "org-1",
            source: "NAIA",
            status: "meeting-booked",
            topic: "Entretien stagiaire",
            updated_at: "2026-08-10T09:00:00.000Z",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }) as unknown as SupabaseClient;

    const result = await createLeadAction(
      {
        companyName: "Private candidate",
        contactJobTitle: "Stagiaire",
        contactName: "Candidate",
        leadDate: "2026-08-11T09:00:00.000Z",
        status: "meeting-booked",
        topic: "Entretien stagiaire",
      },
      trustedContext(client),
    );

    expect(result).toMatchObject({
      accessScope: "cofounders",
      calendarSynced: false,
      success: true,
    });
    expect(result.calendarError).toContain("désactivée");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.ensureClientDriveFolder).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

function fakeLeadUpdateClient(result: {
  data: Array<{ id: string }> | null;
  error: { message: string } | null;
}) {
  const select = vi.fn().mockResolvedValue(result);
  const orgEq = vi.fn(() => ({ select }));
  const idEq = vi.fn(() => ({ eq: orgEq }));
  const update = vi.fn(() => ({ eq: idEq }));

  return {
    client: { from: vi.fn(() => ({ update })) } as unknown as SupabaseClient,
    update,
  };
}

function trustedContext(client: SupabaseClient): CrmActionContext {
  return {
    actorProfileId: "profile-ali",
    organizationId: "org-1",
    supabase: client,
  };
}

describe("updateLeadStatusAction trusted context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
  });

  it("succeeds when the scoped update matches a lead", async () => {
    const { client } = fakeLeadUpdateClient({
      data: [{ id: "lead-1" }],
      error: null,
    });

    const result = await updateLeadStatusAction(
      "lead-1",
      "won",
      trustedContext(client),
    );

    expect(result).toEqual({ success: true });
  });

  it("fails when the update matches zero rows instead of silently succeeding", async () => {
    const { client } = fakeLeadUpdateClient({ data: [], error: null });

    const result = await updateLeadStatusAction(
      "lead-of-another-org",
      "won",
      trustedContext(client),
    );

    expect(result).toEqual({ success: false, error: "Lead introuvable" });
  });

  it("propagates database errors", async () => {
    const { client } = fakeLeadUpdateClient({
      data: null,
      error: { message: "permission denied" },
    });

    const result = await updateLeadStatusAction(
      "lead-1",
      "won",
      trustedContext(client),
    );

    expect(result).toEqual({ success: false, error: "permission denied" });
  });
});
