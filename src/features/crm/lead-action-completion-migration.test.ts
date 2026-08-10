// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260810133154_crm_uat_lead_action_completion.sql",
    import.meta.url,
  ),
  "utf8",
);

function functionBody(name: string, nextMarker: string) {
  const start = migration.indexOf(`create or replace function ${name}`);
  const end = migration.indexOf(nextMarker, start + 1);
  return migration.slice(start, end < 0 ? undefined : end);
}

describe("CRM next-action completion migration", () => {
  it("adds an independent completion state and explicit task provenance", () => {
    expect(migration).toContain("next_action_state text default 'pending'");
    expect(migration).toContain("next_action_completed_at timestamptz");
    expect(migration).toContain("next_action_completed_by_profile_id uuid");
    expect(migration).toContain("task_kind text default 'manual'");
    expect(migration).toContain("crm_tasks_active_lead_next_action_unique_idx");
    expect(migration).toContain("'meeting-recommendation'");
  });

  it("projects lead work transactionally without physically deleting data", () => {
    expect(migration).toContain("project_crm_lead_next_action_task");
    expect(migration).toContain("task.task_kind = 'lead-next-action'");
    expect(migration).toContain("set archived_at =");
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("updates completion without changing the pipeline stage or position", () => {
    const completionRpc = functionBody(
      "public.set_crm_lead_next_action_state",
      "revoke execute on function public.set_crm_lead_next_action_state",
    );

    expect(completionRpc).toContain("set next_action_state = requested_state");
    expect(completionRpc).not.toMatch(/\bset\s+status\s*=/i);
    expect(completionRpc).not.toMatch(/pipeline_position\s*=/i);
    expect(completionRpc).toContain("lead.archived_at is null");
    expect(completionRpc).toContain("lead_row.access_scope = 'cofounders'");
  });

  it("keeps canonical contact coordinates inside the atomic edit transaction", () => {
    const wrapper = functionBody(
      "public.update_crm_lead_uat_atomic",
      "revoke execute on function public.update_crm_lead_uat_atomic",
    );

    expect(wrapper).toContain("public.update_crm_lead_atomic(");
    expect(wrapper).toContain("update public.crm_contacts contact");
    expect(wrapper).toContain("requested_contact_email");
    expect(wrapper).toContain("requested_contact_phone");
    expect(wrapper).toContain(
      "contact.organization_id = requested_organization_id",
    );
    expect(wrapper).toContain("for update");
    expect(wrapper).toContain("(select auth.uid()) is null");
    expect(wrapper).toContain(
      "CRM contact email conflicts with the canonical value",
    );
    expect(wrapper).toContain(
      "CRM contact phone conflicts with the canonical value",
    );
    expect(wrapper).toContain("regexp_replace(existing_contact_phone");
  });

  it("converts founder labels to assignment and archives their tag artifacts", () => {
    expect(migration).toContain("ali@qarizmi.com");
    expect(migration).toContain("nabil@qarizmi.com");
    expect(migration).toContain("A Trello lead has both Ali and Nabil");
    expect(migration).toContain("update public.crm_lead_tags relation");
    expect(migration).toContain("update public.crm_tags tag");
    expect(migration).toContain("update public.crm_external_refs ref");
  });
});
