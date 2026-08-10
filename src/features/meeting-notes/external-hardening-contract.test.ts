import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const actionsSource = read("src/features/meeting-notes/actions.ts");
const workerSource = read("src/features/meeting-notes/worker-service.ts");
const migration = read(
  "supabase/migrations/20260810020545_meeting_drive_archive_and_gemini_sync_guards.sql",
);

describe("Meeting external-effect security contract", () => {
  it("routes approval and worker archives through guarded CAS paths", () => {
    expect(actionsSource).toContain(
      "retryMeetingDriveArchiveAction(meeting.id)",
    );
    expect(actionsSource).not.toContain("updateDriveFileContent");
    expect(workerSource).toContain("archiveMeetingOutput({");
    expect(workerSource).toContain('"authorize_worker_meeting_drive_archive"');
    expect(workerSource).toContain('"finalize_worker_meeting_drive_archive"');
    expect(workerSource).toContain(
      '.gt("lease_expires_at", reservationStartedAt)',
    );
  });

  it("authorizes every founder archive against live actor, tenant, company, output and revision", () => {
    expect(migration).toContain(
      "public.is_meeting_notes_cofounder(requested_organization_id)",
    );
    expect(migration).toContain("meeting.company_id = requested_company_id");
    expect(migration).toContain(
      "company.organization_id = requested_organization_id",
    );
    expect(migration).toContain("output.id = requested_output_id");
    expect(migration).toContain("output.version = expected_output_version");
    expect(migration).toContain(
      "output.review_revision = expected_review_revision",
    );
    expect(migration).toContain(
      "for update of meeting, company, output, membership, user_record",
    );
    expect(migration).toContain("using errcode = '40001'");
    expect(migration).toContain("'sha256', archive_file->>'sha256'");
    expect(migration).not.toContain("delete from");
  });

  it("keeps Gemini cursor state server-only and enforces bounded resumable leases", () => {
    expect(migration).toContain(
      "create table public.meeting_gemini_sync_states",
    );
    expect(migration).toContain("primary key (organization_id, profile_id)");
    expect(migration).toContain(
      "revoke all on public.meeting_gemini_sync_states from public, anon, authenticated",
    );
    expect(migration).toContain(
      "'maxResults', least(25, 100 - state.run_scanned)",
    );
    expect(migration).toContain("state.run_documents >= 20");
    expect(migration).toContain("state.run_bytes >= 10485760");
    expect(migration).toContain(
      "state.run_started_at <= now() - interval '5 minutes'",
    );
    expect(migration).toContain(
      "sync_state.lease_token = requested_lease_token",
    );
  });
});

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}
