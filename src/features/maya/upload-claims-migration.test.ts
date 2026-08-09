import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260809224332_maya_pitch_upload_claims.sql",
  ),
  "utf8",
);

describe("Maya pitch upload claim migration", () => {
  it("uses one transactional destination-and-filename idempotency key", () => {
    expect(migration).toContain("claim_maya_pitch_upload");
    expect(migration).toContain(
      "unique (destination_pitch_folder_id, draft_file_name)",
    );
    expect(migration).toContain("reserved_drive_file_id text not null unique");
    expect(migration).toContain(
      "on conflict (destination_pitch_folder_id, draft_file_name)",
    );
    expect(migration).toContain("for update");
  });

  it("tracks claim, uploaded and failed states with lease-bound transitions", () => {
    expect(migration).toContain("status in ('claim', 'uploaded', 'failed')");
    expect(migration).toContain("complete_maya_pitch_upload_claim");
    expect(migration).toContain("fail_maya_pitch_upload_claim");
    expect(migration).toContain("renew_maya_pitch_upload_claim");
    expect(migration).toContain(
      "and upload_claim.lease_token = requested_lease_token",
    );
    expect(migration).toContain(
      "attempt_count = upload_claim.attempt_count + 1",
    );
    expect(migration).toContain(
      "least(greatest(coalesce(lease_seconds, 900), 60), 3600)",
    );
  });

  it("is owner-only, RLS-protected and exposes no direct mutations", () => {
    expect(migration).toContain("is_maya_pitch_owner");
    expect(migration).toContain(
      "alter table public.maya_pitch_upload_claims enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.maya_pitch_upload_claims from anon, authenticated",
    );
    expect(migration).not.toContain(
      "delete from public.maya_pitch_upload_claims",
    );
  });
});
