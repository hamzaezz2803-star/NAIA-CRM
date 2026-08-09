import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { fetchCrmPipelineSnapshot } from "./pipeline-data";

type QueryResponse = { data: unknown; error: unknown };

function createReadOnlyClient(responses: Record<string, QueryResponse>) {
  const calls: string[] = [];
  const writes: string[] = [];
  const getUser = vi.fn(async () => ({
    data: { user: { id: "profile-ali" } },
    error: null,
  }));

  function from(table: string) {
    calls.push(table);
    const response = responses[table] ?? { data: null, error: null };
    const builder = {
      delete() {
        writes.push(`delete:${table}`);
        return builder;
      },
      eq() {
        return builder;
      },
      insert() {
        writes.push(`insert:${table}`);
        return builder;
      },
      is() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle: async () => response,
      order() {
        return builder;
      },
      select() {
        return builder;
      },
      then(
        resolve: (value: QueryResponse) => unknown,
        reject: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(response).then(resolve, reject);
      },
      update() {
        writes.push(`update:${table}`);
        return builder;
      },
      upsert() {
        writes.push(`upsert:${table}`);
        return builder;
      },
    };
    return builder;
  }

  return {
    calls,
    client: { auth: { getUser }, from } as unknown as SupabaseClient,
    getUser,
    writes,
  };
}

describe("fetchCrmPipelineSnapshot", () => {
  it("uses one auth/org context, two data reads, and performs no writes", async () => {
    const fake = createReadOnlyClient({
      crm_categories: {
        data: [
          {
            color: "blue",
            id: "category-1",
            name: "À contacter",
            organization_id: "org-1",
            position: 1,
            status_key: "lead-to-contact",
          },
        ],
        error: null,
      },
      crm_leads: {
        data: [
          {
            assigned_to: null,
            company: { id: "company-1", name: "TGCC" },
            company_id: "company-1",
            contact: null,
            contact_id: null,
            created_at: "2026-08-09T20:00:00.000Z",
            crm_lead_tags: [],
            id: "lead-1",
            organization_id: "org-1",
            status: "lead-to-contact",
            topic: "Meeting TGCC",
            updated_at: "2026-08-09T20:00:00.000Z",
          },
        ],
        error: null,
      },
      organization_memberships: {
        data: { organization_id: "org-1" },
        error: null,
      },
    });

    const snapshot = await fetchCrmPipelineSnapshot({
      client: fake.client,
      now: () => new Date("2026-08-09T22:00:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      categories: [{ id: "category-1", statusKey: "lead-to-contact" }],
      leads: [{ companyName: "TGCC", id: "lead-1" }],
      loadedAt: "2026-08-09T22:00:00.000Z",
      source: "database",
    });
    expect(fake.getUser).toHaveBeenCalledTimes(1);
    expect(fake.calls).toEqual([
      "organization_memberships",
      "crm_leads",
      "crm_categories",
    ]);
    expect(fake.writes).toEqual([]);
  });
});
