// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationsDirectory = new URL(
  "../../../supabase/migrations/",
  import.meta.url,
);
const migrationName = readdirSync(migrationsDirectory).find((name) =>
  name.endsWith("_crm_pipeline_priority_order.sql"),
);

if (!migrationName) throw new Error("CRM pipeline order migration missing");

const migration = readFileSync(
  new URL(migrationName, migrationsDirectory),
  "utf8",
);

describe("CRM pipeline order migration", () => {
  it("backfills a deterministic per-column order and resets moved cards", () => {
    expect(migration).toContain("pipeline_position bigint");
    expect(migration).toContain(
      "partition by lead.organization_id, lead.status",
    );
    expect(migration).toContain("order by lead.created_at desc, lead.id");
    expect(migration).toContain(
      "before insert or update of status on public.crm_leads",
    );
    expect(migration).toContain(
      "select coalesce(min(lead.pipeline_position), 1024) - 1024",
    );
    expect(migration).toContain("lead.id is distinct from new.id");
  });

  it("uses a tenant-scoped atomic security-invoker reorder contract", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("expected_ordered_ids uuid[]");
    expect(migration).toContain("requested_ordered_ids uuid[]");
    expect(migration).toContain(
      "lead.organization_id = requested_organization_id",
    );
    expect(migration).toContain("lead.status = requested_status");
    expect(migration).toContain("lead.archived_at is null");
    expect(migration).toContain("using errcode = '40001'");
    expect(migration).toContain("to authenticated, service_role");
  });

  it("does not turn a priority move into CRM activity", () => {
    const reorderFunction = migration.slice(
      migration.indexOf(
        "create or replace function public.reorder_crm_pipeline_leads",
      ),
    );
    expect(reorderFunction).not.toContain("updated_at =");
  });
});
