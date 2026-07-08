import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { updateLeadAction, updateLeadStatusAction } from "./actions";

type QueryState = {
  table: string;
  op: "delete" | "insert" | "select" | "update";
  columns?: string;
  payload?: unknown;
};

type QueryResponder = (state: QueryState) => unknown;

type FakeQueryBuilder = {
  delete: () => FakeQueryBuilder;
  eq: () => FakeQueryBuilder;
  insert: (payload: unknown) => FakeQueryBuilder;
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
        eq() {
          return builder;
        },
        insert(payload: unknown) {
          state.op = "insert";
          state.payload = payload;
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
  };
}

function respondForLead({
  companyName,
  driveFolderUrl = null,
  previousStatus = "contacted",
  onUpdate,
}: {
  companyName: string | null;
  driveFolderUrl?: string | null;
  previousStatus?: string;
  onUpdate?: (state: QueryState) => void;
}): QueryResponder {
  return (state) => {
    if (state.op === "update") {
      onUpdate?.(state);
      return { data: null, error: null };
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
});
