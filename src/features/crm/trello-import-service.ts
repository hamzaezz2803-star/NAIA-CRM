import "server-only";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

import {
  createTrelloStagingAttestation,
  normalizeTrelloExport,
  reconcileTrelloImportWithExistingCrm,
  type CrmAccessScope,
  type ExistingCrmReconciliationSnapshot,
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
  };
}

async function reconcileAgainstExistingCrm(
  client: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  organizationId: string,
  dryRun: TrelloImportDryRun,
) {
  if (!client) throw new Error("Supabase n'est pas configuré.");

  const pageSize = 1_000;
  async function fetchAllRows<Row>(
    label: string,
    fetchPage: (
      from: number,
      to: number,
    ) => PromiseLike<{
      data: Row[] | null;
      error: { message: string } | null;
    }>,
  ) {
    const rows: Row[] = [];
    let from = 0;
    for (;;) {
      const result = await fetchPage(from, from + pageSize - 1);
      if (result.error) {
        throw new Error(
          `Préflight CRM existant impossible (${label}): ${result.error.message}`,
        );
      }
      const page = result.data ?? [];
      if (page.length === 0) return rows;
      rows.push(...page);
      // Advance by the number actually returned. PostgREST can enforce a
      // server-side maximum below our requested range, so a short page does
      // not prove that the dataset is exhausted.
      from += page.length;
    }
  }

  const [categories, tags, leads, externalRefs] = await Promise.all([
    fetchAllRows("catégories", (from, to) =>
      client
        .from("crm_categories")
        .select("id, status_key, access_scope")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows("tags", (from, to) =>
      client
        .from("crm_tags")
        .select("id, name, access_scope")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows("leads", (from, to) =>
      client
        .from("crm_leads")
        .select("id, topic, access_scope")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows("références Trello", (from, to) =>
      client
        .from("crm_external_refs")
        .select(
          "external_type, external_id, local_id, source_hash, archived_at",
        )
        .eq("organization_id", organizationId)
        .eq("provider", "trello")
        .order("id")
        .range(from, to),
    ),
  ]);

  const snapshot: ExistingCrmReconciliationSnapshot = {
    categories: categories.map((row) => ({
      accessScope: row.access_scope as CrmAccessScope,
      id: row.id,
      statusKey: row.status_key,
    })),
    externalRefs: externalRefs.map((row) => ({
      archivedAt: row.archived_at,
      externalId: row.external_id,
      externalType: row.external_type as "category" | "lead" | "tag",
      localId: row.local_id,
      sourceHash: row.source_hash,
    })),
    leads: leads.map((row) => ({
      accessScope: row.access_scope as CrmAccessScope,
      id: row.id,
      topic: row.topic,
    })),
    tags: tags.map((row) => ({
      accessScope: row.access_scope as CrmAccessScope,
      id: row.id,
      name: row.name,
    })),
  };

  return reconcileTrelloImportWithExistingCrm(dryRun, snapshot);
}

/**
 * Parses a Trello JSON export and persists only normalized staging rows.
 * The raw export, actions, members, and credentials are never stored.
 */
export async function stageTrelloImportDryRun(
  input: string | unknown,
): Promise<StagedTrelloImport> {
  const normalizedDryRun = normalizeTrelloExport(input);
  const { client, organizationId } = await requireImportContext();
  const dryRun = await reconcileAgainstExistingCrm(
    client,
    organizationId,
    normalizedDryRun,
  );

  const attestation = createTrelloStagingAttestation(dryRun.items);
  const stagingRows = dryRun.items.map((item) => ({
    access_scope: item.accessScope,
    entity_type: item.entityType,
    external_id: item.externalId,
    normalized_payload: item.payload,
    parent_external_id: item.parentExternalId ?? null,
    payload_hash: item.payloadHash,
    privacy_reasons: item.privacyReasons,
    validation_errors: item.validationErrors,
  }));
  const { data, error } = await client.rpc("stage_crm_trello_import", {
    requested_expected_item_count: attestation.expectedItemCount,
    requested_organization_id: organizationId,
    requested_rows: stagingRows,
    requested_source_external_id: dryRun.board.externalId,
    requested_source_hash: dryRun.sourceHash,
    requested_staging_hash: attestation.stagingHash,
    requested_summary: {
      boardName: dryRun.board.name,
      counts: dryRun.counts,
      review: dryRun.review,
      warnings: dryRun.warnings,
    },
  });
  if (error) throw new Error(error.message);
  const staged = data as {
    reused?: boolean;
    runId?: string;
  } | null;
  if (!staged?.runId) throw new Error("Identifiant de dry-run introuvable.");

  return {
    dryRun,
    reused: staged.reused === true,
    runId: staged.runId,
  };
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
