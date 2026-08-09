import "server-only";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

import {
  normalizeTrelloExport,
  type TrelloImportDryRun,
} from "./trello-import";

export type StagedTrelloImport = {
  dryRun: TrelloImportDryRun;
  reused: boolean;
  runId: string;
};

async function requireImportContext() {
  const client = await createServerSupabaseClient();
  if (!client) throw new Error("Supabase n'est pas configuré.");

  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user) throw new Error("Authentification requise.");

  const { data: membership, error: membershipError } = await client
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership?.organization_id) {
    throw new Error("Organisation active introuvable.");
  }

  return {
    client,
    organizationId: membership.organization_id,
    profileId: user.id,
  };
}

/**
 * Parses a Trello JSON export and persists only normalized staging rows.
 * The raw export, actions, members, and credentials are never stored.
 */
export async function stageTrelloImportDryRun(
  input: string | unknown,
): Promise<StagedTrelloImport> {
  const dryRun = normalizeTrelloExport(input);
  const { client, organizationId, profileId } = await requireImportContext();

  const { data: existingRun, error: existingRunError } = await client
    .from("crm_import_runs")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("provider", "trello")
    .eq("source_external_id", dryRun.board.externalId)
    .eq("source_hash", dryRun.sourceHash)
    .limit(1)
    .maybeSingle();
  if (existingRunError) throw new Error(existingRunError.message);

  if (
    existingRun?.status === "applied" ||
    existingRun?.status === "rolled-back"
  ) {
    return { dryRun, reused: true, runId: existingRun.id };
  }

  let runId = existingRun?.id as string | undefined;
  if (!runId) {
    const { data: createdRun, error: createRunError } = await client
      .from("crm_import_runs")
      .insert({
        organization_id: organizationId,
        provider: "trello",
        source_external_id: dryRun.board.externalId,
        source_hash: dryRun.sourceHash,
        status: "staged",
        dry_run: true,
        summary: {
          boardName: dryRun.board.name,
          counts: dryRun.counts,
          review: dryRun.review,
          warnings: dryRun.warnings,
        },
        created_by_profile_id: profileId,
      })
      .select("id")
      .single();
    if (createRunError || !createdRun) {
      throw new Error(
        createRunError?.message ?? "Création du dry-run impossible.",
      );
    }
    runId = createdRun.id;
  }
  if (!runId) throw new Error("Identifiant de dry-run introuvable.");

  const stagingRows = dryRun.items.map((item) => ({
    access_scope: item.accessScope,
    entity_type: item.entityType,
    external_id: item.externalId,
    normalized_payload: item.payload,
    organization_id: organizationId,
    parent_external_id: item.parentExternalId ?? null,
    payload_hash: item.payloadHash,
    privacy_reasons: item.privacyReasons,
    run_id: runId,
    validation_errors: item.validationErrors,
  }));

  const { error: stagingError } = await client
    .from("crm_import_staging")
    .upsert(stagingRows, {
      onConflict: "run_id,entity_type,external_id",
    });
  if (stagingError) throw new Error(stagingError.message);

  return { dryRun, reused: Boolean(existingRun), runId };
}

/** Apply is an explicit, founder-authorized database transaction. */
export async function applyStagedTrelloImport(runId: string) {
  const { client } = await requireImportContext();
  const { data, error } = await client.rpc("apply_crm_trello_import", {
    requested_run_id: runId,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

/** Rollback compensates with soft archives; it never deletes CRM rows. */
export async function rollbackStagedTrelloImport(runId: string) {
  const { client } = await requireImportContext();
  const { data, error } = await client.rpc("rollback_crm_trello_import", {
    requested_run_id: runId,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}
