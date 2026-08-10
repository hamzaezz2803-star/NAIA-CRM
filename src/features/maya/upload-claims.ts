import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const executeClaimSchema = z.object({
  action: z.literal("execute"),
  claimId: z.string().uuid(),
  leaseToken: z.string().uuid(),
  reservedDriveFileId: z.string().min(1),
});

const busyClaimSchema = z.object({
  action: z.literal("busy"),
  claimId: z.string().uuid(),
});

const uploadedClaimSchema = z.object({
  action: z.literal("uploaded"),
  claimId: z.string().uuid(),
  driveFileId: z.string().min(1),
  driveFileUrl: z.string().nullable().optional(),
});

const uploadClaimSchema = z.discriminatedUnion("action", [
  executeClaimSchema,
  busyClaimSchema,
  uploadedClaimSchema,
]);

export type MayaPitchUploadClaim = z.infer<typeof uploadClaimSchema>;

export async function claimMayaPitchUpload({
  draftFileName,
  leadId,
  organizationId,
  pitchFolderId,
  reservedDriveFileId,
  supabase,
  templateDriveFileId,
  templateSha256,
}: {
  draftFileName: string;
  leadId: string;
  organizationId: string;
  pitchFolderId: string;
  reservedDriveFileId: string;
  supabase: SupabaseClient;
  templateDriveFileId: string;
  templateSha256: string;
}): Promise<MayaPitchUploadClaim> {
  const { data, error } = await supabase.rpc("claim_maya_pitch_upload", {
    lease_seconds: 900,
    requested_draft_file_name: draftFileName,
    requested_lead_id: leadId,
    requested_organization_id: organizationId,
    requested_pitch_folder_id: pitchFolderId,
    requested_reserved_drive_file_id: reservedDriveFileId,
    requested_template_drive_file_id: templateDriveFileId,
    requested_template_sha256: templateSha256,
  });

  if (error) {
    throw new Error(`Maya could not claim the Drive upload: ${error.message}`);
  }

  const parsed = uploadClaimSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      "Maya received an invalid upload claim response; the Drive write is blocked.",
    );
  }

  return parsed.data;
}

export async function completeMayaPitchUploadClaim({
  claimId,
  driveFileId,
  driveFileUrl,
  leaseToken,
  supabase,
}: {
  claimId: string;
  driveFileId: string;
  driveFileUrl?: string;
  leaseToken: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase.rpc(
    "complete_maya_pitch_upload_claim",
    {
      requested_claim_id: claimId,
      requested_drive_file_id: driveFileId,
      requested_drive_file_url: driveFileUrl ?? "",
      requested_lease_token: leaseToken,
    },
  );

  if (error) {
    throw new Error(
      `Maya uploaded the draft but could not finalize its idempotency claim: ${error.message}`,
    );
  }
  if (data !== true) {
    throw new Error(
      "Maya uploaded the draft but its idempotency lease was no longer valid; retry to reconcile the existing file.",
    );
  }
}

export async function renewMayaPitchUploadClaim({
  claimId,
  leaseToken,
  supabase,
}: {
  claimId: string;
  leaseToken: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase.rpc("renew_maya_pitch_upload_claim", {
    lease_seconds: 900,
    requested_claim_id: claimId,
    requested_lease_token: leaseToken,
  });

  if (error) {
    throw new Error(
      `Maya could not renew the Drive upload lease: ${error.message}`,
    );
  }
  if (data !== true) {
    throw new Error(
      "Maya's idempotency lease changed before upload; no Drive file was created.",
    );
  }
}

export async function failMayaPitchUploadClaim({
  claimId,
  errorMessage,
  leaseToken,
  supabase,
}: {
  claimId: string;
  errorMessage: string;
  leaseToken: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase.rpc("fail_maya_pitch_upload_claim", {
    failure_message: errorMessage,
    requested_claim_id: claimId,
    requested_lease_token: leaseToken,
  });

  if (error) {
    throw new Error(
      `Maya could not mark the upload claim failed: ${error.message}`,
    );
  }

  return data === true;
}
