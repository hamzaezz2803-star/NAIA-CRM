import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown>,
  createServerSupabaseClient: vi.fn(),
  createSystemNotification: vi.fn(),
  ensureClientDriveFolder: vi.fn(),
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

import {
  checkGoogleAuthAction,
  createGoogleDriveFolderAction,
  createLeadAction,
  disconnectGoogleAuthAction,
  fetchCompanyDetailAction,
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
          return { data: { organization_id: "org-1" }, error: null };
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
          return { data: { organization_id: "org-1" }, error: null };
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
            },
            error: null,
          };
        }
        if (state.table === "integration_connections") {
          return { data: connection, error: null };
        }
        return { data: null, error: null };
      }),
    );

    await expect(syncLeadToGoogleCalendarAction("lead-1")).resolves.toEqual({
      error:
        "Session Google expirée ou invalide. Veuillez déconnecter et reconnecter votre compte Google.",
      success: false,
    });
    expect(credentialRead).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
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
