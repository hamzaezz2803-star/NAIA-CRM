import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260717090000_meeting_intelligence.sql",
  ),
  "utf8",
);
const oneStepCaptureMigration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260809231500_meeting_one_step_capture.sql",
  ),
  "utf8",
);
const geminiArtifactMigration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260810001500_meeting_gemini_artifacts.sql",
  ),
  "utf8",
);

describe("meeting intelligence migration contract", () => {
  it("queues recording assets, jobs, and meeting state atomically", () => {
    expect(migration).toContain("queue_meeting_processing_job");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("returning id into queued_asset_id");
    expect(migration).toContain("returning id into queued_job_id");
    expect(migration).toContain("set status = 'queued', updated_at = now()");
  });

  it("keeps worker failure and output review transitions transactional", () => {
    expect(migration).toContain("fail_meeting_processing_job");
    expect(migration).toContain("claim_meeting_output_review");
    expect(migration).toContain("finalize_meeting_output_review");
    expect(migration).toContain("review_lock_token");
    expect(migration).toContain("review_revision integer not null default 0");
    expect(migration).toContain(
      "and output.review_revision = expected_review_revision",
    );
    expect(migration).toContain("review_revision = output.review_revision + 1");
  });

  it("binds additive CRM effects to one execution and one lead", () => {
    expect(migration).toContain("crm_lead_notes_meeting_action_execution_idx");
    expect(migration).toContain("crm_tasks_meeting_action_execution_idx");
    expect(migration).toContain("validate_meeting_crm_execution_target");
    expect(migration).toContain("meeting.lead_id = new.lead_id");
    expect(migration).toContain("next_action_meeting_execution_id");
    expect(migration).toContain("status_meeting_execution_id");
  });

  it("does not expose direct authenticated meeting deletion", () => {
    expect(migration).toContain('create policy "cofounders can read meetings"');
    expect(migration).toContain(
      'create policy "cofounders can update meetings"',
    );
    expect(migration).not.toContain(
      'create policy "cofounders can manage meetings"',
    );
  });

  it("adds bounded founder notes and consent metadata without new policies", () => {
    expect(oneStepCaptureMigration).toContain(
      "live_notes_markdown text not null default ''",
    );
    expect(oneStepCaptureMigration).toContain(
      "consent_confirmed_at timestamptz",
    );
    expect(oneStepCaptureMigration).toContain(
      "check (char_length(live_notes_markdown) <= 500000)",
    );
    expect(oneStepCaptureMigration).toContain(
      "meeting_assets_storage_path_unique_idx",
    );
    expect(oneStepCaptureMigration).not.toContain("create policy");
    expect(oneStepCaptureMigration).not.toContain("delete from");
  });

  it("keeps Gemini imports founder-only, tenant-bound and non-deletable", () => {
    expect(geminiArtifactMigration).toContain(
      "unique (organization_id, provider, external_message_id)",
    );
    expect(geminiArtifactMigration).toContain(
      "validate_meeting_external_artifact_tenant",
    );
    expect(geminiArtifactMigration).toContain(
      "public.is_meeting_notes_cofounder(organization_id)",
    );
    expect(geminiArtifactMigration).toContain(
      "grant select, insert, update on public.meeting_external_artifacts to authenticated",
    );
    expect(geminiArtifactMigration).not.toContain(
      "grant delete on public.meeting_external_artifacts to authenticated",
    );
    expect(geminiArtifactMigration).not.toContain("delete from");
  });
});
