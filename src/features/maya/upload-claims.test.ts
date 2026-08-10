import { describe, expect, it, vi } from "vitest";

import {
  claimMayaPitchUpload,
  completeMayaPitchUploadClaim,
  failMayaPitchUploadClaim,
  renewMayaPitchUploadClaim,
} from "./upload-claims";

function makeSupabase(data: unknown, error: { message: string } | null = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  };
}

const claimInput = {
  draftFileName:
    "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
  leadId: "33333333-3333-4333-8333-333333333333",
  organizationId: "44444444-4444-4444-8444-444444444444",
  pitchFolderId: "pitch-folder-id",
  reservedDriveFileId: "reserved-drive-file-id",
  templateDriveFileId: "approved-teaser-id",
  templateSha256: "a".repeat(64),
};

describe("Maya durable pitch upload claims", () => {
  it("parses an atomic execution lease and sends the full idempotency key", async () => {
    const supabase = makeSupabase({
      action: "execute",
      claimId: "11111111-1111-4111-8111-111111111111",
      leaseToken: "22222222-2222-4222-8222-222222222222",
      reservedDriveFileId: "reserved-drive-file-id",
      status: "claim",
    });

    await expect(
      claimMayaPitchUpload({
        ...claimInput,
        supabase: supabase as never,
      }),
    ).resolves.toMatchObject({ action: "execute" });
    expect(supabase.rpc).toHaveBeenCalledWith("claim_maya_pitch_upload", {
      lease_seconds: 900,
      requested_draft_file_name: claimInput.draftFileName,
      requested_lead_id: claimInput.leadId,
      requested_organization_id: claimInput.organizationId,
      requested_pitch_folder_id: claimInput.pitchFolderId,
      requested_reserved_drive_file_id: claimInput.reservedDriveFileId,
      requested_template_drive_file_id: claimInput.templateDriveFileId,
      requested_template_sha256: claimInput.templateSha256,
    });
  });

  it("distinguishes busy and already-uploaded claims", async () => {
    const busy = makeSupabase({
      action: "busy",
      claimId: "11111111-1111-4111-8111-111111111111",
    });
    const uploaded = makeSupabase({
      action: "uploaded",
      claimId: "11111111-1111-4111-8111-111111111111",
      driveFileId: "draft-id",
      driveFileUrl: null,
    });

    await expect(
      claimMayaPitchUpload({ ...claimInput, supabase: busy as never }),
    ).resolves.toMatchObject({ action: "busy" });
    await expect(
      claimMayaPitchUpload({ ...claimInput, supabase: uploaded as never }),
    ).resolves.toMatchObject({ action: "uploaded", driveFileId: "draft-id" });
  });

  it("fails closed on an invalid RPC response or RPC error", async () => {
    const malformed = makeSupabase({ action: "execute" });
    const failed = makeSupabase(null, { message: "function unavailable" });

    await expect(
      claimMayaPitchUpload({ ...claimInput, supabase: malformed as never }),
    ).rejects.toThrow("invalid upload claim response");
    await expect(
      claimMayaPitchUpload({ ...claimInput, supabase: failed as never }),
    ).rejects.toThrow("function unavailable");
  });

  it("requires the database to accept completion and records failures", async () => {
    const completed = makeSupabase(true);
    await expect(
      completeMayaPitchUploadClaim({
        claimId: "11111111-1111-4111-8111-111111111111",
        driveFileId: "draft-id",
        driveFileUrl: "https://drive.google.com/file/d/draft-id/view",
        leaseToken: "22222222-2222-4222-8222-222222222222",
        supabase: completed as never,
      }),
    ).resolves.toBeUndefined();

    const stale = makeSupabase(false);
    await expect(
      completeMayaPitchUploadClaim({
        claimId: "11111111-1111-4111-8111-111111111111",
        driveFileId: "draft-id",
        leaseToken: "22222222-2222-4222-8222-222222222222",
        supabase: stale as never,
      }),
    ).rejects.toThrow("lease was no longer valid");

    const failed = makeSupabase(true);
    await expect(
      failMayaPitchUploadClaim({
        claimId: "11111111-1111-4111-8111-111111111111",
        errorMessage: "hash mismatch",
        leaseToken: "22222222-2222-4222-8222-222222222222",
        supabase: failed as never,
      }),
    ).resolves.toBe(true);
    expect(failed.rpc).toHaveBeenCalledWith("fail_maya_pitch_upload_claim", {
      failure_message: "hash mismatch",
      requested_claim_id: "11111111-1111-4111-8111-111111111111",
      requested_lease_token: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("requires a lease-bound renewal immediately before upload", async () => {
    const renewed = makeSupabase(true);
    await expect(
      renewMayaPitchUploadClaim({
        claimId: "11111111-1111-4111-8111-111111111111",
        leaseToken: "22222222-2222-4222-8222-222222222222",
        supabase: renewed as never,
      }),
    ).resolves.toBeUndefined();
    expect(renewed.rpc).toHaveBeenCalledWith("renew_maya_pitch_upload_claim", {
      lease_seconds: 900,
      requested_claim_id: "11111111-1111-4111-8111-111111111111",
      requested_lease_token: "22222222-2222-4222-8222-222222222222",
    });

    const stale = makeSupabase(false);
    await expect(
      renewMayaPitchUploadClaim({
        claimId: "11111111-1111-4111-8111-111111111111",
        leaseToken: "22222222-2222-4222-8222-222222222222",
        supabase: stale as never,
      }),
    ).rejects.toThrow("lease changed before upload");
  });
});
