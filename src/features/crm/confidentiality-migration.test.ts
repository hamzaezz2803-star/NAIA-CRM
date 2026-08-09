import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260809221616_crm_confidentiality_and_trello_import.sql",
  ),
  "utf8",
);

describe("CRM confidentiality and import migration contract", () => {
  it("uses auth.users exact cofounders and a private helper schema", () => {
    expect(migration).toContain("create schema if not exists private");
    expect(migration).toContain("join auth.users user_record");
    expect(migration).toContain("'ali@qarizmi.com', 'nabil@qarizmi.com'");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("crm_bridge_actor_is_cofounder");
  });

  it("scopes roots, inherits parent policies, and removes viewer write policies", () => {
    for (const table of [
      "crm_companies",
      "crm_contacts",
      "crm_leads",
      "crm_categories",
      "crm_tags",
      "crm_tasks",
    ]) {
      expect(migration).toContain(`alter table public.${table}`);
    }
    expect(migration).toContain("private.can_read_crm_record");
    expect(migration).toContain("private.can_write_crm_record");
    expect(migration).toContain(
      'drop policy if exists "members can do all on crm_tasks"',
    );
    expect(migration).toContain(
      'create policy "crm inherited select" on public.crm_lead_notes',
    );
  });

  it("keeps import apply/rollback auditable and delete-free", () => {
    expect(migration).toContain(
      "create table if not exists public.crm_import_runs",
    );
    expect(migration).toContain(
      "create table if not exists public.crm_import_staging",
    );
    expect(migration).toContain(
      "create table if not exists public.crm_external_refs",
    );
    expect(migration).toContain(
      "create table if not exists public.crm_import_changes",
    );
    expect(migration).toContain("apply_crm_trello_import");
    expect(migration).toContain("rollback_crm_trello_import");
    expect(migration).not.toMatch(/\bdelete\s+from\s+public\.crm_/i);
    expect(migration).not.toMatch(
      /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+public\.crm_import/i,
    );
  });
});
