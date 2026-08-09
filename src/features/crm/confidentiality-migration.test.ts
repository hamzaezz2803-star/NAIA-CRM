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
    for (const parentTable of ["crm_leads", "crm_contacts", "crm_tasks"]) {
      expect(migration).toContain(
        `join public.crm_tags tag on tag.id = crm_${parentTable.replace("crm_", "").replace(/s$/, "")}_tags.tag_id`,
      );
    }
    expect(
      migration.match(/organization_id = tag\.organization_id/g)?.length,
    ).toBeGreaterThanOrEqual(12);
    expect(migration).toContain("private.enforce_crm_root_boundary");
    expect(migration).toContain(
      "CRM boundary violation: task/lead organization mismatch",
    );
    expect(migration).toContain(
      "lead.organization_id = crm_tasks.organization_id",
    );
    expect(migration).toContain("crm_tasks_lead_id_idx");
  });

  it("escalates sensitive manual records and prevents scope downgrades", () => {
    expect(migration).toContain("private.crm_text_requires_cofounder");
    for (const vocabulary of [
      "trainees?",
      "apprentices?",
      "apprenti(e|es|s)?",
      "alternances?",
      "graduate[[:space:]]+interns?",
    ]) {
      expect(migration).toContain(vocabulary);
    }
    expect(migration).toContain("old.access_scope = 'cofounders'");
    expect(migration).toContain("new.access_scope := 'cofounders'");
  });

  it("binds every ledger child to the same organization as its run", () => {
    expect(migration).toContain(
      "constraint crm_import_runs_id_organization_unique unique (id, organization_id)",
    );
    expect(migration).toContain("foreign key (run_id, organization_id)");
    expect(migration).toContain(
      "references public.crm_import_runs (id, organization_id)",
    );
    expect(migration).toContain(
      "stage.organization_id = import_run.organization_id",
    );
    expect(
      migration.match(
        /organization_id = import_run\.organization_id\n\s+and run_id = import_run\.id/g,
      )?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("reconciles existing CRM rows and supports safe post-rollback attempts", () => {
    expect(migration).toContain("private.crm_normalize_match_text");
    expect(migration).toContain("Ambiguous existing CRM lead match");
    expect(migration).toContain(
      "Ambiguous staged Trello tag name for existing CRM tag",
    );
    expect(migration).toContain("Existing CRM lead scope mismatch");
    expect(migration).toContain("ref.local_table = 'crm_tags'");
    expect(migration).toContain("ref.local_table = 'crm_categories'");
    expect(migration).toContain("crm_import_runs_active_source_unique_idx");
    expect(migration).toContain("where status in ('staged', 'applied')");
    expect(migration).toContain("'revived'");
    expect(migration).toContain("Rolled-back Trello lead changed");
    expect(migration).toContain("'previousArchivedAt'");
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
    expect(migration).toContain("stage_crm_trello_import");
    expect(migration).toContain("private.crm_staging_attestation");
    expect(migration).toContain(
      "private.crm_text_array_hash(stage.validation_errors)",
    );
    expect(migration).toContain("expected_item_count");
    expect(migration).toContain("staging_hash");
    expect(migration).toContain(
      "CRM import staging attestation is incomplete or invalid",
    );
    expect(migration).toContain(
      "grant select on public.crm_import_runs, public.crm_import_staging",
    );
    expect(migration).not.toContain(
      "grant select, insert, update on public.crm_import_runs, public.crm_import_staging,\n  public.crm_external_refs, public.crm_import_changes to authenticated",
    );
    expect(migration).not.toContain(
      'create policy "cofounders can insert crm import ledger"',
    );
    expect(migration).toContain("rollback_crm_trello_import");
    expect(migration).not.toMatch(/\bdelete\s+from\s+public\.crm_/i);
    expect(migration).not.toMatch(
      /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+public\.crm_import/i,
    );
  });
});
