import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import {
  getMayaCrmLeadContext,
  listMayaCrmLeadContexts,
  resolveMayaCrmDriveFolderUrl,
} from "./crm";

describe("Maya CRM destination context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes queue and single-lead reads to the authenticated organization", async () => {
    const row = makeLeadRow();
    const listQuery = makeQuery({ data: [row], error: null });
    const getQuery = makeQuery({ data: row, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(listQuery)
      .mockReturnValueOnce(getQuery);
    mocks.createServerSupabaseClient.mockResolvedValue({ from });

    await expect(
      listMayaCrmLeadContexts({ organizationId: "org-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        clientName: "HPS",
        companyDriveFolderUrl:
          "https://drive.google.com/drive/folders/client-folder-id",
        leadId: "lead-1",
      }),
    ]);
    await expect(
      getMayaCrmLeadContext({ leadId: "lead-1", organizationId: "org-1" }),
    ).resolves.toMatchObject({ leadId: "lead-1", organizationId: "org-1" });

    expect(listQuery.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(listQuery.eq).toHaveBeenCalledWith("status", "meeting-booked");
    expect(getQuery.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(getQuery.eq).toHaveBeenCalledWith("id", "lead-1");
  });

  it("uses either CRM URL when both resolve to the same Drive folder", () => {
    expect(
      resolveMayaCrmDriveFolderUrl({
        companyDriveFolderUrl:
          "https://drive.google.com/drive/folders/client-folder-id?usp=sharing",
        leadDriveFolderUrl:
          "https://drive.google.com/drive/folders/client-folder-id",
      }),
    ).toBe("https://drive.google.com/drive/folders/client-folder-id");
  });

  it("blocks missing or conflicting lead/company destinations", () => {
    expect(() => resolveMayaCrmDriveFolderUrl({})).toThrow(
      "Aucun dossier Drive",
    );
    expect(() =>
      resolveMayaCrmDriveFolderUrl({
        companyDriveFolderUrl:
          "https://drive.google.com/drive/folders/company-folder",
        leadDriveFolderUrl:
          "https://drive.google.com/drive/folders/lead-folder",
      }),
    ).toThrow("destination est ambiguë");
  });

  it("rejects a lead without an authoritative CRM company", async () => {
    const query = makeQuery({
      data: { ...makeLeadRow(), company: null, company_id: null },
      error: null,
    });
    mocks.createServerSupabaseClient.mockResolvedValue({
      from: vi.fn(() => query),
    });

    await expect(
      getMayaCrmLeadContext({ leadId: "lead-1", organizationId: "org-1" }),
    ).rejects.toThrow("société CRM valide");
  });
});

function makeLeadRow() {
  return {
    company: {
      drive_folder_url:
        "https://drive.google.com/drive/folders/client-folder-id",
      id: "company-1",
      name: "HPS",
    },
    company_id: "company-1",
    contact: { name: "Abdeslam El-Alawi" },
    drive_folder_url: null,
    id: "lead-1",
    organization_id: "org-1",
    status: "meeting-booked",
  };
}

function makeQuery(payload: {
  data: unknown;
  error: null | { message: string };
}) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => payload),
    order: vi.fn(async () => payload),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}
