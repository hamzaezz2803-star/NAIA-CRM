import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { POST } from "./route";

type ClientOptions = {
  deleteError?: { message: string } | null;
  membership?: { organization_id: string } | null;
  membershipError?: { message: string } | null;
  user?: { id: string } | null;
  userError?: { message: string } | null;
};

function createRequest(provider: unknown = "google") {
  return new NextRequest("http://localhost/api/integrations/disconnect", {
    body: JSON.stringify({ provider }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function createClient({
  deleteError = null,
  membership = { organization_id: "org-1" },
  membershipError = null,
  user = { id: "user-1" },
  userError = null,
}: ClientOptions = {}) {
  const deleteEqProfile = vi.fn().mockResolvedValue({ error: deleteError });
  const deleteEqProvider = vi.fn().mockReturnValue({ eq: deleteEqProfile });
  const deleteEqOrganization = vi
    .fn()
    .mockReturnValue({ eq: deleteEqProvider });
  const deleteRows = vi.fn().mockReturnValue({ eq: deleteEqOrganization });

  const maybeSingle = vi.fn().mockResolvedValue({
    data: membership,
    error: membershipError,
  });
  const limit = vi.fn().mockReturnValue({ maybeSingle });
  const membershipEq = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ eq: membershipEq });

  const from = vi.fn((table: string) => {
    if (table === "organization_memberships") return { select };
    if (table === "integration_connections") return { delete: deleteRows };
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: userError,
      }),
    },
    from,
    spies: {
      deleteEqOrganization,
      deleteEqProfile,
      deleteEqProvider,
      deleteRows,
    },
  };
}

describe("POST /api/integrations/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects every provider except personal Google", async () => {
    const response = await POST(createRequest("slack"));

    expect(response.status).toBe(400);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ user: null }),
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
  });

  it("requires an organization membership", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ membership: null }),
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
  });

  it("deletes only the acting user's Google connection", async () => {
    const client = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, provider: "google" });
    expect(client.spies.deleteRows).toHaveBeenCalledOnce();
    expect(client.spies.deleteEqOrganization).toHaveBeenCalledWith(
      "organization_id",
      "org-1",
    );
    expect(client.spies.deleteEqProvider).toHaveBeenCalledWith(
      "provider",
      "google",
    );
    expect(client.spies.deleteEqProfile).toHaveBeenCalledWith(
      "connected_by_profile_id",
      "user-1",
    );
  });

  it("does not report success when the database deletion fails", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ deleteError: { message: "database unavailable" } }),
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "La connexion Google n’a pas pu être supprimée.",
    });
  });
});
