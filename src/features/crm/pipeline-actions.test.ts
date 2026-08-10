import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("./pipeline-data", () => ({
  fetchCrmNavigationSummary: vi.fn(),
  fetchCrmPipelineAuxiliary: vi.fn(),
  fetchCrmPipelineSnapshot: vi.fn(),
}));

import { reorderCrmPipelineLeadsAction } from "./pipeline-actions";

const LEAD_1 = "11111111-1111-4111-8111-111111111111";
const LEAD_2 = "22222222-2222-4222-8222-222222222222";

function createClient({
  role = "owner",
  rpcError = null,
}: {
  role?: "owner" | "viewer";
  rpcError?: { code?: string; message: string } | null;
} = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError });
  const query = {
    eq: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { organization_id: "org-1", role },
      error: null,
    }),
    select: vi.fn(() => query),
  };
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "profile-ali" } },
        error: null,
      }),
    },
    from: vi.fn(() => query),
    rpc,
  };
}

describe("reorderCrmPipelineLeadsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives the organization from the session and calls the atomic RPC", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await expect(
      reorderCrmPipelineLeadsAction({
        expectedOrderedIds: [LEAD_1, LEAD_2],
        orderedIds: [LEAD_2, LEAD_1],
        status: "contacted",
      }),
    ).resolves.toEqual({ success: true });

    expect(client.rpc).toHaveBeenCalledWith("reorder_crm_pipeline_leads", {
      expected_ordered_ids: [LEAD_1, LEAD_2],
      requested_ordered_ids: [LEAD_2, LEAD_1],
      requested_organization_id: "org-1",
      requested_status: "contacted",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/leads");
  });

  it("rejects duplicate ids before opening a database session", async () => {
    await expect(
      reorderCrmPipelineLeadsAction({
        expectedOrderedIds: [LEAD_1, LEAD_1],
        orderedIds: [LEAD_1, LEAD_1],
        status: "contacted",
      }),
    ).resolves.toEqual({
      error: "L’ordre demandé n’est pas une permutation valide.",
      success: false,
    });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("keeps viewers read-only", async () => {
    const client = createClient({ role: "viewer" });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const result = await reorderCrmPipelineLeadsAction({
      expectedOrderedIds: [LEAD_1, LEAD_2],
      orderedIds: [LEAD_2, LEAD_1],
      status: "contacted",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("permission");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns a refreshable message for concurrent reorder conflicts", async () => {
    const client = createClient({
      rpcError: { code: "40001", message: "serialization failure" },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await expect(
      reorderCrmPipelineLeadsAction({
        expectedOrderedIds: [LEAD_1, LEAD_2],
        orderedIds: [LEAD_2, LEAD_1],
        status: "contacted",
      }),
    ).resolves.toEqual({
      error: "L’ordre a changé entre-temps. Le pipeline va être rechargé.",
      success: false,
    });
  });
});
