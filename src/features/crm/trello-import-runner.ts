import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { join, resolve } from "node:path";

import { z } from "zod";

import {
  createTrelloStagingAttestation,
  normalizeTrelloExport,
  reconcileTrelloImportWithExistingCrm,
  type ExistingCrmReconciliationSnapshot,
  type TrelloImportDryRun,
} from "./trello-import";

export type CrmTrelloImportMode = "apply" | "dry-run";

export const DEFAULT_TRELLO_EXPORT_PATH =
  "/Users/ali/Library/Application Support/NAIA/imports/trello/commercial-lead-consulting-2026-08-09T2323.json";

export type TrelloImportSourceContract = {
  boardId: string;
  cofoundersOnly: number;
  counts: {
    categories: number;
    leads: number;
    tags: number;
    totalItems: number;
  };
  expectedLeadTagRelations: number;
  organizationIdSha256: string;
  rawSha256: string;
  rawSize: number;
  sourceHash: string;
  stagingHash: string;
};

export const COMMERCIAL_TRELLO_SOURCE_CONTRACT: TrelloImportSourceContract = {
  boardId: "69de18c4a11891f0f0aae68a",
  cofoundersOnly: 4,
  counts: {
    categories: 14,
    leads: 221,
    tags: 3,
    totalItems: 238,
  },
  expectedLeadTagRelations: 139,
  organizationIdSha256:
    "3a4a564659d65572eb77be0e02c3b6d61ecd659761802e0b521486bddb9ba461",
  rawSha256: "d8096a4afc5c0fde191bd7ba1b3528fe7001dd18332abe0d8a423abf1663bdde",
  rawSize: 1_590_067,
  sourceHash:
    "af8f6341485e1c0f47598a66168cac5fe6eedf78f32af73c3ba57572bede6c43",
  stagingHash:
    "7475418f8629ca717973038a354911cbc3e306706eec2d5dfb179cdeda702254",
};

export type TrelloImportTargetContract = {
  organizationIdSha256: string;
  projectRefSha256: string;
};

const PRODUCTION_SUPABASE_PROJECT_REF_SHA256 =
  "afde75cbef68512550adedf94df1452f069248f98ed15874d0628c5994b12232";

type DatabaseOperation =
  | "apply"
  | "founder-rls"
  | "nonfounder-rls"
  | "post-verify"
  | "rollback"
  | "rollback-verify"
  | "run-status"
  | "schema-gate"
  | "snapshot"
  | "stage"
  | "stage-verify"
  | "target-attestation";

export type DatabasePort = {
  query(operation: DatabaseOperation, sql: string): unknown;
};

type ExportFile = {
  bytes: Buffer;
  isRegularFile: boolean;
  mode: number;
  size: number;
};

export type RunnerDependencies = {
  attestTarget(contract: TrelloImportTargetContract): unknown;
  database: DatabasePort;
  loadExport(path: string): ExportFile;
};

export type RunCrmTrelloImportOptions = {
  confirmApply?: boolean;
  exportPath: string;
  mode: CrmTrelloImportMode;
  sourceContract?: TrelloImportSourceContract;
};

export type CrmTrelloImportResult = {
  applied?: {
    conflicts: number;
    created: number;
    linked: number;
    replayVerified: true;
    revived: number;
    runId: string;
    unchanged: number;
  };
  counts: TrelloImportSourceContract["counts"];
  existingCrmDeterministicMatches: number;
  mode: CrmTrelloImportMode;
  privacy: { cofoundersOnly: number };
  rlsVerified: boolean;
  schemaVerified: true;
  sourceHash: string;
  stagingHash: string;
  status: "applied" | "ready";
};

export class SafeImportError extends Error {
  constructor(
    readonly code: string,
    safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "SafeImportError";
  }
}

function assertGate(
  condition: unknown,
  code: string,
  safeMessage: string,
): asserts condition {
  if (!condition) throw new SafeImportError(code, safeMessage);
}

const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.enum(["cofounders", "organization"]);

const schemaGateSchema = z.object({
  attestationColumns: z.boolean(),
  crmTablesRls: z.boolean(),
  functionsDeleteFree: z.boolean(),
  functionsPresent: z.boolean(),
  functionsRestricted: z.boolean(),
  ledgerGrantsReadOnly: z.boolean(),
  ledgerPoliciesReadOnly: z.boolean(),
  ledgerRls: z.boolean(),
  migrationsApplied: z.boolean(),
});

const targetAttestationSchema = z
  .object({
    cofoundersPresent: z.boolean(),
    organizationMatch: z.boolean(),
  })
  .strict();

const snapshotSchema = z.object({
  actorProfileId: uuidSchema.nullable(),
  categories: z.array(
    z.object({
      accessScope: scopeSchema,
      id: uuidSchema,
      statusKey: z.string(),
    }),
  ),
  contextCount: z.number().int().nonnegative(),
  externalRefs: z.array(
    z.object({
      archivedAt: z.string().nullable(),
      externalId: z.string(),
      externalType: z.enum(["category", "lead", "tag"]),
      localId: uuidSchema,
      sourceHash: sha256Schema,
    }),
  ),
  leads: z.array(
    z.object({
      accessScope: scopeSchema,
      id: uuidSchema,
      topic: z.string(),
    }),
  ),
  nonFounderCount: z.number().int().nonnegative(),
  nonFounderProfileId: uuidSchema.nullable(),
  organizationId: uuidSchema.nullable(),
  preCounts: z.object({
    categories: z.number().int().nonnegative(),
    leads: z.number().int().nonnegative(),
    tags: z.number().int().nonnegative(),
  }),
  tags: z.array(
    z.object({
      accessScope: scopeSchema,
      id: uuidSchema,
      name: z.string(),
    }),
  ),
});

const stageResponseSchema = z.object({
  reused: z.boolean(),
  runId: uuidSchema,
  status: z.enum(["applied", "staged"]),
});

const stageVerificationSchema = z.object({
  categoryCount: z.number().int().nonnegative(),
  cofoundersOnly: z.number().int().nonnegative(),
  expectedItemCount: z.number().int().nonnegative(),
  leadCount: z.number().int().nonnegative(),
  sourceHash: sha256Schema,
  stagingCount: z.number().int().nonnegative(),
  stagingHash: sha256Schema,
  status: z.enum(["applied", "staged"]),
  tagCount: z.number().int().nonnegative(),
  validationErrorRows: z.number().int().nonnegative(),
});

const rlsVerificationSchema = z.object({
  cofounderLeadRelations: z.number().int().nonnegative(),
  cofounderLeads: z.number().int().nonnegative(),
  importedCofounderLeads: z.number().int().nonnegative(),
  ledgerChanges: z.number().int().nonnegative(),
  ledgerRefs: z.number().int().nonnegative(),
  ledgerRuns: z.number().int().nonnegative(),
  ledgerStaging: z.number().int().nonnegative(),
  organizationLeads: z.number().int().nonnegative(),
  unexpectedRefs: z.number().int().nonnegative(),
});

const importSummarySchema = z.record(z.string(), z.unknown());

const postVerificationSchema = z.object({
  activeCategoryMappings: z.number().int().nonnegative(),
  activeLeadMappings: z.number().int().nonnegative(),
  activeRefs: z.number().int().nonnegative(),
  activeTagMappings: z.number().int().nonnegative(),
  activatedByType: z.object({
    categories: z.number().int().nonnegative(),
    leads: z.number().int().nonnegative(),
    tags: z.number().int().nonnegative(),
  }),
  changeCount: z.number().int().nonnegative(),
  cofounderLocalLeads: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  expectedRelations: z.number().int().nonnegative(),
  hashMismatches: z.number().int().nonnegative(),
  localScopeMismatches: z.number().int().nonnegative(),
  mappedRefs: z.number().int().nonnegative(),
  missingRelations: z.number().int().nonnegative(),
  postCounts: z.object({
    categories: z.number().int().nonnegative(),
    leads: z.number().int().nonnegative(),
    tags: z.number().int().nonnegative(),
  }),
  refScopeMismatches: z.number().int().nonnegative(),
  status: z.enum(["applied", "rolled-back", "staged"]),
  summary: importSummarySchema,
  unexpectedRefs: z.number().int().nonnegative(),
});

const rollbackVerificationSchema = z.object({
  activeCreatedOrRevivedRows: z.number().int().nonnegative(),
  activeImportedRelations: z.number().int().nonnegative(),
  activeRefs: z.number().int().nonnegative(),
  relationRollbackMismatches: z.number().int().nonnegative(),
  status: z.enum(["rolled-back"]),
  unexpectedRefs: z.number().int().nonnegative(),
});

const runStatusSchema = z.object({
  status: z.enum(["applied", "rolled-back", "staged"]),
});

function safeParse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new SafeImportError(code, "Réponse de contrôle invalide.");
  }
  return parsed.data;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyTargetAttestation(value: unknown) {
  const target = safeParse(
    targetAttestationSchema,
    value,
    "TARGET_ATTESTATION_INVALID",
  );
  assertGate(
    target.organizationMatch,
    "TARGET_ORGANIZATION_MISMATCH",
    "L'organisation Supabase ne correspond pas à la cible revue.",
  );
  assertGate(
    target.cofoundersPresent,
    "TARGET_COFUNDERS_MISSING",
    "La cible Supabase n'a pas les deux cofondateurs attendus.",
  );
}

function base64Text(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function sqlDecodedText(value: string) {
  return `convert_from(decode('${base64Text(value)}', 'base64'), 'UTF8')`;
}

function sqlJson(value: unknown) {
  return `${sqlDecodedText(JSON.stringify(value))}::jsonb`;
}

function assertUuid(value: string) {
  return uuidSchema.parse(value);
}

function numberFromSummary(
  summary: Record<string, unknown>,
  key: "conflicts" | "created" | "linked" | "revived" | "unchanged",
) {
  const value = summary[key];
  assertGate(
    typeof value === "number" && Number.isInteger(value) && value >= 0,
    "INVALID_APPLY_SUMMARY",
    "Résumé d'application invalide.",
  );
  return value;
}

function countLeadTagRelations(dryRun: TrelloImportDryRun) {
  return dryRun.items
    .filter((item) => item.entityType === "lead")
    .reduce((count, item) => {
      const labelIds = Array.isArray(item.payload.labelExternalIds)
        ? item.payload.labelExternalIds.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      return count + new Set(labelIds).size;
    }, 0);
}

function normalizedStagingRows(dryRun: TrelloImportDryRun) {
  return dryRun.items.map((item) => ({
    access_scope: item.accessScope,
    entity_type: item.entityType,
    external_id: item.externalId,
    normalized_payload: item.payload,
    parent_external_id: item.parentExternalId ?? null,
    payload_hash: item.payloadHash,
    privacy_reasons: item.privacyReasons,
    validation_errors: item.validationErrors,
  }));
}

function verifyLocalSource(
  file: ExportFile,
  contract: TrelloImportSourceContract,
) {
  assertGate(
    file.isRegularFile,
    "EXPORT_NOT_REGULAR",
    "L'export sécurisé n'est pas un fichier régulier.",
  );
  assertGate(
    (file.mode & 0o077) === 0,
    "EXPORT_PERMISSIONS",
    "Les permissions de l'export ne sont pas privées.",
  );
  assertGate(
    file.size === contract.rawSize,
    "EXPORT_SIZE_MISMATCH",
    "La taille de l'export a changé.",
  );
  assertGate(
    sha256(file.bytes) === contract.rawSha256,
    "EXPORT_HASH_MISMATCH",
    "L'empreinte de l'export a changé.",
  );
}

function verifyNormalizedSource(
  dryRun: TrelloImportDryRun,
  contract: TrelloImportSourceContract,
) {
  const attestation = createTrelloStagingAttestation(dryRun.items);
  assertGate(
    dryRun.board.externalId === contract.boardId &&
      dryRun.sourceHash === contract.sourceHash &&
      attestation.stagingHash === contract.stagingHash,
    "NORMALIZED_HASH_MISMATCH",
    "L'export normalisé ne correspond pas à l'attestation revue.",
  );
  assertGate(
    dryRun.items.length === contract.counts.totalItems &&
      dryRun.counts.categories === contract.counts.categories &&
      dryRun.counts.tags === contract.counts.tags &&
      dryRun.counts.leads === contract.counts.leads &&
      dryRun.counts.cofoundersOnly === contract.cofoundersOnly &&
      countLeadTagRelations(dryRun) === contract.expectedLeadTagRelations,
    "NORMALIZED_COUNTS_MISMATCH",
    "Les agrégats de l'export ne correspondent pas à la revue.",
  );
  assertGate(
    dryRun.items.every((item) => item.validationErrors.length === 0),
    "NORMALIZATION_VALIDATION_ERRORS",
    "La normalisation contient des erreurs bloquantes.",
  );
}

function verifySchemaGate(value: unknown) {
  const gate = safeParse(schemaGateSchema, value, "SCHEMA_GATE_INVALID");
  assertGate(
    Object.values(gate).every(Boolean),
    "SCHEMA_GATE_FAILED",
    "Les migrations, privilèges ou politiques RLS ne sont pas prêts.",
  );
}

function snapshotForReconciliation(value: unknown) {
  const snapshot = safeParse(snapshotSchema, value, "SNAPSHOT_INVALID");
  assertGate(
    snapshot.contextCount === 1 &&
      snapshot.actorProfileId &&
      snapshot.organizationId,
    "FOUNDER_CONTEXT_AMBIGUOUS",
    "Le contexte organisationnel d'Ali est introuvable ou ambigu.",
  );
  assertGate(
    snapshot.nonFounderCount >= 1 && snapshot.nonFounderProfileId,
    "NONFOUNDER_CONTEXT_MISSING",
    "Aucun membre nonfondateur n'est disponible pour tester la RLS.",
  );
  return snapshot;
}

function verifyReconciliation(
  dryRun: TrelloImportDryRun,
  snapshot: z.infer<typeof snapshotSchema>,
  contract: TrelloImportSourceContract,
) {
  const existing: ExistingCrmReconciliationSnapshot = {
    categories: snapshot.categories,
    externalRefs: snapshot.externalRefs,
    leads: snapshot.leads,
    tags: snapshot.tags,
  };
  const reconciled = reconcileTrelloImportWithExistingCrm(dryRun, existing);
  assertGate(
    reconciled.review.existingCrmAmbiguousItems === 0 &&
      reconciled.items.every((item) => item.validationErrors.length === 0),
    "RECONCILIATION_BLOCKED",
    "La réconciliation CRM contient une ambiguïté ou un conflit de scope.",
  );
  const attestation = createTrelloStagingAttestation(reconciled.items);
  assertGate(
    attestation.expectedItemCount === contract.counts.totalItems &&
      attestation.stagingHash === contract.stagingHash,
    "RECONCILIATION_ATTESTATION_CHANGED",
    "La réconciliation a modifié l'attestation revue.",
  );
  return reconciled;
}

export function buildTargetAttestationSql(
  expectedOrganizationIdSha256: string,
) {
  assertGate(
    sha256Schema.safeParse(expectedOrganizationIdSha256).success,
    "TARGET_CONTRACT_INVALID",
    "Le contrat de cible Supabase est invalide.",
  );
  return `/* naia:target-attestation */
with ali_contexts as (
  select distinct membership.organization_id
  from public.organization_memberships membership
  join auth.users user_record on user_record.id = membership.profile_id
  where lower(user_record.email) = 'ali@qarizmi.com'
), selected as (
  select organization_id from ali_contexts
), cofounders as (
  select distinct lower(user_record.email) as email
  from selected context
  join public.organization_memberships membership
    on membership.organization_id = context.organization_id
  join auth.users user_record on user_record.id = membership.profile_id
  where lower(user_record.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com')
)
select jsonb_build_object(
  'organizationMatch', (
    (select count(*) from ali_contexts) = 1
    and coalesce((
      select bool_and(
        encode(
          extensions.digest(
            convert_to(context.organization_id::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ) = ${sqlDecodedText(expectedOrganizationIdSha256)}
      )
      from selected context
    ), false)
  ),
  'cofoundersPresent', (select count(*) = 2 from cofounders)
) as payload;`;
}

export function buildSchemaGateSql() {
  return `/* naia:schema-gate */
with ledger_tables(name) as (
  values ('crm_import_runs'), ('crm_import_staging'),
    ('crm_external_refs'), ('crm_import_changes')
), crm_tables(name) as (
  values ('crm_companies'), ('crm_contacts'), ('crm_leads'),
    ('crm_categories'), ('crm_tags'), ('crm_tasks'), ('crm_lead_tags'),
    ('crm_contact_tags'), ('crm_task_tags'), ('crm_lead_notes'),
    ('crm_lead_follow_ups')
), import_functions(signature) as (
  values
    ('public.stage_crm_trello_import(uuid,text,text,text,integer,jsonb,jsonb)'),
    ('public.apply_crm_trello_import(uuid)'),
    ('public.rollback_crm_trello_import(uuid)')
), function_oids as (
  select signature, to_regprocedure(signature) as oid from import_functions
)
select jsonb_build_object(
  'migrationsApplied', (
    select count(*) = 2 from supabase_migrations.schema_migrations
    where version in ('20260809221616', '20260810000025')
  ),
  'ledgerRls', (
    select count(*) = 4 and bool_and(class.relrowsecurity)
    from ledger_tables expected
    join pg_class class on class.relname = expected.name
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
  ),
  'crmTablesRls', (
    select count(*) = 11 and bool_and(class.relrowsecurity)
    from crm_tables expected
    join pg_class class on class.relname = expected.name
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
  ),
  'ledgerPoliciesReadOnly', (
    select count(*) = 4 and bool_and(policy.cmd = 'SELECT')
    from ledger_tables expected
    join pg_policies policy
      on policy.schemaname = 'public' and policy.tablename = expected.name
    where 'authenticated' = any(policy.roles)
  ),
  'ledgerGrantsReadOnly', (
    select bool_and(
      has_table_privilege('authenticated', 'public.' || name, 'SELECT')
      and not has_table_privilege('authenticated', 'public.' || name, 'INSERT')
      and not has_table_privilege('authenticated', 'public.' || name, 'UPDATE')
      and not has_table_privilege('authenticated', 'public.' || name, 'DELETE')
      and not has_table_privilege('anon', 'public.' || name, 'SELECT')
      and not has_table_privilege('anon', 'public.' || name, 'INSERT')
      and not has_table_privilege('anon', 'public.' || name, 'UPDATE')
      and not has_table_privilege('anon', 'public.' || name, 'DELETE')
    ) from ledger_tables
  ),
  'functionsPresent', (
    select count(*) = 3 and bool_and(oid is not null) from function_oids
  ),
  'functionsRestricted', (
    select bool_and(
      has_function_privilege('authenticated', oid, 'EXECUTE')
      and not has_function_privilege('anon', oid, 'EXECUTE')
    ) from function_oids where oid is not null
  ),
  'functionsDeleteFree', (
    select count(*) = 3 and bool_and(
      lower(pg_get_functiondef(oid)) !~ '(^|[^a-z])delete([^a-z]|$)'
    ) from function_oids where oid is not null
  ),
  'attestationColumns', (
    select count(*) = 2 and bool_and(column_record.is_nullable = 'NO')
    from information_schema.columns column_record
    where column_record.table_schema = 'public'
      and column_record.table_name = 'crm_import_runs'
      and column_record.column_name in ('expected_item_count', 'staging_hash')
  )
) as payload;`;
}

export function buildSnapshotSql() {
  return `/* naia:snapshot */
with ali_contexts as (
  select membership.organization_id, membership.profile_id
  from public.organization_memberships membership
  join auth.users user_record on user_record.id = membership.profile_id
  where lower(user_record.email) = 'ali@qarizmi.com'
), selected as (
  select * from ali_contexts order by organization_id limit 1
), nonfounders as (
  select membership.profile_id
  from selected context
  join public.organization_memberships membership
    on membership.organization_id = context.organization_id
  join auth.users user_record on user_record.id = membership.profile_id
  where lower(coalesce(user_record.email, '')) not in (
    'ali@qarizmi.com', 'nabil@qarizmi.com'
  )
  order by membership.profile_id
)
select jsonb_build_object(
  'contextCount', (select count(*) from ali_contexts),
  'actorProfileId', (select profile_id from selected),
  'organizationId', (select organization_id from selected),
  'nonFounderCount', (select count(*) from nonfounders),
  'nonFounderProfileId', (select profile_id from nonfounders limit 1),
  'preCounts', jsonb_build_object(
    'categories', (select count(*) from public.crm_categories row_record, selected context where row_record.organization_id = context.organization_id and row_record.archived_at is null),
    'tags', (select count(*) from public.crm_tags row_record, selected context where row_record.organization_id = context.organization_id and row_record.archived_at is null),
    'leads', (select count(*) from public.crm_leads row_record, selected context where row_record.organization_id = context.organization_id and row_record.archived_at is null)
  ),
  'categories', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', row_record.id,
      'statusKey', row_record.status_key,
      'accessScope', row_record.access_scope
    ) order by row_record.id)
    from public.crm_categories row_record, selected context
    where row_record.organization_id = context.organization_id
      and row_record.archived_at is null
  ), '[]'::jsonb),
  'tags', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', row_record.id,
      'name', row_record.name,
      'accessScope', row_record.access_scope
    ) order by row_record.id)
    from public.crm_tags row_record, selected context
    where row_record.organization_id = context.organization_id
      and row_record.archived_at is null
  ), '[]'::jsonb),
  'leads', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', row_record.id,
      'topic', row_record.topic,
      'accessScope', row_record.access_scope
    ) order by row_record.id)
    from public.crm_leads row_record, selected context
    where row_record.organization_id = context.organization_id
      and row_record.archived_at is null
  ), '[]'::jsonb),
  'externalRefs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'externalType', row_record.external_type,
      'externalId', row_record.external_id,
      'localId', row_record.local_id,
      'sourceHash', row_record.source_hash,
      'archivedAt', row_record.archived_at
    ) order by row_record.id)
    from public.crm_external_refs row_record, selected context
    where row_record.organization_id = context.organization_id
      and row_record.provider = 'trello'
  ), '[]'::jsonb)
) as payload;`;
}

function actorCte(actorProfileId: string) {
  assertUuid(actorProfileId);
  return `actor_context as materialized (
    select set_config(
      'request.jwt.claim.sub',
      ${sqlDecodedText(actorProfileId)},
      true
    )
  )`;
}

export function buildStageSql(args: {
  actorProfileId: string;
  dryRun: TrelloImportDryRun;
  organizationId: string;
}) {
  assertUuid(args.organizationId);
  const attestation = createTrelloStagingAttestation(args.dryRun.items);
  const rows = normalizedStagingRows(args.dryRun);
  const summary = {
    boardName: args.dryRun.board.name,
    counts: args.dryRun.counts,
    review: args.dryRun.review,
    warnings: args.dryRun.warnings,
  };
  return `/* naia:stage */
begin;
set local role authenticated;
with ${actorCte(args.actorProfileId)}
select public.stage_crm_trello_import(
  ${sqlDecodedText(args.organizationId)}::uuid,
  ${sqlDecodedText(args.dryRun.board.externalId)},
  ${sqlDecodedText(args.dryRun.sourceHash)},
  ${sqlDecodedText(attestation.stagingHash)},
  ${attestation.expectedItemCount},
  ${sqlJson(summary)},
  ${sqlJson(rows)}
) as payload
from actor_context;
commit;`;
}

export function buildStageVerificationSql(runId: string) {
  assertUuid(runId);
  return `/* naia:stage-verify */
with target_run as (
  select * from public.crm_import_runs where id = ${sqlDecodedText(runId)}::uuid
)
select jsonb_build_object(
  'status', target_run.status,
  'expectedItemCount', target_run.expected_item_count,
  'sourceHash', target_run.source_hash,
  'stagingHash', target_run.staging_hash,
  'stagingCount', (select count(*) from public.crm_import_staging row_record where row_record.run_id = target_run.id and row_record.organization_id = target_run.organization_id),
  'categoryCount', (select count(*) from public.crm_import_staging row_record where row_record.run_id = target_run.id and row_record.organization_id = target_run.organization_id and row_record.entity_type = 'category'),
  'tagCount', (select count(*) from public.crm_import_staging row_record where row_record.run_id = target_run.id and row_record.organization_id = target_run.organization_id and row_record.entity_type = 'tag'),
  'leadCount', (select count(*) from public.crm_import_staging row_record where row_record.run_id = target_run.id and row_record.organization_id = target_run.organization_id and row_record.entity_type = 'lead'),
  'cofoundersOnly', (select count(*) from public.crm_import_staging row_record where row_record.run_id = target_run.id and row_record.organization_id = target_run.organization_id and row_record.access_scope = 'cofounders'),
  'validationErrorRows', (select count(*) from public.crm_import_staging row_record where row_record.run_id = target_run.id and row_record.organization_id = target_run.organization_id and jsonb_array_length(row_record.validation_errors) > 0)
) as payload
from target_run;`;
}

export function buildRlsVerificationSql(args: {
  actorProfileId: string;
  organizationId: string;
  runId: string;
}) {
  assertUuid(args.organizationId);
  assertUuid(args.runId);
  return `/* naia:rls-verify */
begin;
set local role authenticated;
with ${actorCte(args.actorProfileId)}, target_run as materialized (
  select row_record.*
  from public.crm_import_runs row_record, actor_context
  where row_record.id = ${sqlDecodedText(args.runId)}::uuid
    and row_record.organization_id = ${sqlDecodedText(args.organizationId)}::uuid
    and row_record.provider = 'trello'
), staged as materialized (
  select stage.*
  from target_run
  join public.crm_import_staging stage
    on stage.run_id = target_run.id
    and stage.organization_id = target_run.organization_id
), run_refs as materialized (
  select ref.*
  from target_run
  join public.crm_external_refs ref
    on ref.organization_id = target_run.organization_id
    and ref.provider = target_run.provider
    and ref.last_run_id = target_run.id
), refs as materialized (
  select ref.*
  from target_run
  join staged stage on stage.organization_id = target_run.organization_id
  join public.crm_external_refs ref
    on stage.organization_id = ref.organization_id
    and ref.provider = target_run.provider
    and ref.external_type = stage.entity_type
    and ref.external_id = stage.external_id
), changes as materialized (
  select change.*
  from target_run
  join public.crm_import_changes change
    on change.run_id = target_run.id
    and change.organization_id = target_run.organization_id
), stats as (
  select
    (select count(*) from target_run) as ledger_runs,
    (select count(*) from staged) as ledger_staging,
    (select count(*) from refs) as ledger_refs,
    (select count(*) from changes) as ledger_changes,
    (select count(*) from run_refs ref where not exists (
      select 1 from staged stage
      where stage.organization_id = ref.organization_id
        and stage.entity_type = ref.external_type
        and stage.external_id = ref.external_id
    )) as unexpected_refs,
    (select count(*) from public.crm_leads row_record where row_record.organization_id = ${sqlDecodedText(args.organizationId)}::uuid and row_record.archived_at is null and row_record.access_scope = 'organization') as organization_leads,
    (select count(*) from public.crm_leads row_record where row_record.organization_id = ${sqlDecodedText(args.organizationId)}::uuid and row_record.archived_at is null and row_record.access_scope = 'cofounders') as cofounder_leads,
    (select count(*) from public.crm_lead_tags relation join public.crm_leads lead on lead.id = relation.lead_id where lead.organization_id = ${sqlDecodedText(args.organizationId)}::uuid and lead.archived_at is null and lead.access_scope = 'cofounders' and relation.archived_at is null) as cofounder_lead_relations,
    (select count(*)
      from refs ref
      join public.crm_leads lead
        on lead.id = ref.local_id
        and lead.organization_id = ref.organization_id
      where ref.local_table = 'crm_leads'
        and ref.archived_at is null
        and lead.archived_at is null
        and lead.access_scope = 'cofounders'
    ) as imported_cofounder_leads
  from actor_context
)
select jsonb_build_object(
  'ledgerRuns', ledger_runs,
  'ledgerStaging', ledger_staging,
  'ledgerRefs', ledger_refs,
  'ledgerChanges', ledger_changes,
  'organizationLeads', organization_leads,
  'cofounderLeads', cofounder_leads,
  'cofounderLeadRelations', cofounder_lead_relations,
  'importedCofounderLeads', imported_cofounder_leads,
  'unexpectedRefs', unexpected_refs
) as payload from stats;
rollback;`;
}

export function buildApplySql(actorProfileId: string, runId: string) {
  assertUuid(runId);
  return `/* naia:apply */
begin;
set local role authenticated;
with ${actorCte(actorProfileId)}
select public.apply_crm_trello_import(${sqlDecodedText(runId)}::uuid) as payload
from actor_context;
commit;`;
}

export function buildPostVerificationSql(runId: string) {
  assertUuid(runId);
  const run = `${sqlDecodedText(runId)}::uuid`;
  return `/* naia:post-verify */
with target_run as (
  select * from public.crm_import_runs where id = ${run} and provider = 'trello'
), staged as (
  select stage.*
  from target_run
  join public.crm_import_staging stage
    on stage.run_id = target_run.id
    and stage.organization_id = target_run.organization_id
), run_refs as (
  select ref.*
  from target_run
  join public.crm_external_refs ref
    on ref.organization_id = target_run.organization_id
    and ref.provider = target_run.provider
    and ref.last_run_id = target_run.id
), refs as (
  select ref.*
  from target_run
  join staged stage on stage.organization_id = target_run.organization_id
  join public.crm_external_refs ref
    on stage.organization_id = ref.organization_id
    and ref.provider = target_run.provider
    and ref.external_type = stage.entity_type
    and ref.external_id = stage.external_id
), expected_relations as (
  select distinct lead_ref.local_id as lead_id, tag_ref.local_id as tag_id
  from staged lead_stage
  cross join lateral jsonb_array_elements_text(
    coalesce(lead_stage.normalized_payload -> 'labelExternalIds', '[]'::jsonb)
  ) label_external_id
  join refs lead_ref
    on lead_ref.external_type = 'lead'
    and lead_ref.external_id = lead_stage.external_id
    and lead_ref.archived_at is null
  join refs tag_ref
    on tag_ref.external_type = 'tag'
    and tag_ref.external_id = label_external_id
    and tag_ref.archived_at is null
  where lead_stage.entity_type = 'lead'
), activated as (
  select
    count(*) filter (where local_table = 'crm_categories') as categories,
    count(*) filter (where local_table = 'crm_tags') as tags,
    count(*) filter (where local_table = 'crm_leads') as leads
  from public.crm_import_changes
  where run_id = ${run} and operation in ('created', 'revived')
)
select jsonb_build_object(
  'status', target_run.status,
  'summary', target_run.summary,
  'activeRefs', (select count(*) from refs where archived_at is null),
  'mappedRefs', (select count(*) from refs ref join staged stage on stage.organization_id = ref.organization_id and stage.entity_type = ref.external_type and stage.external_id = ref.external_id where ref.archived_at is null and ref.source_hash = stage.payload_hash),
  'hashMismatches', (select count(*) from refs ref join staged stage on stage.organization_id = ref.organization_id and stage.entity_type = ref.external_type and stage.external_id = ref.external_id where ref.source_hash <> stage.payload_hash),
  'refScopeMismatches', (select count(*) from refs ref join staged stage on stage.organization_id = ref.organization_id and stage.entity_type = ref.external_type and stage.external_id = ref.external_id where ref.access_scope <> stage.access_scope),
  'unexpectedRefs', (select count(*) from run_refs ref where not exists (select 1 from staged stage where stage.organization_id = ref.organization_id and stage.entity_type = ref.external_type and stage.external_id = ref.external_id)),
  'activeCategoryMappings', (select count(*) from refs ref join public.crm_categories local_row on local_row.id = ref.local_id and local_row.organization_id = ref.organization_id where ref.local_table = 'crm_categories' and ref.archived_at is null and local_row.archived_at is null),
  'activeTagMappings', (select count(*) from refs ref join public.crm_tags local_row on local_row.id = ref.local_id and local_row.organization_id = ref.organization_id where ref.local_table = 'crm_tags' and ref.archived_at is null and local_row.archived_at is null),
  'activeLeadMappings', (select count(*) from refs ref join public.crm_leads local_row on local_row.id = ref.local_id and local_row.organization_id = ref.organization_id where ref.local_table = 'crm_leads' and ref.archived_at is null and local_row.archived_at is null),
  'localScopeMismatches', (
    select count(*) from (
      select ref.id from refs ref join public.crm_categories local_row on local_row.id = ref.local_id and local_row.organization_id = ref.organization_id where ref.local_table = 'crm_categories' and ref.access_scope <> local_row.access_scope
      union all
      select ref.id from refs ref join public.crm_tags local_row on local_row.id = ref.local_id and local_row.organization_id = ref.organization_id where ref.local_table = 'crm_tags' and ref.access_scope <> local_row.access_scope
      union all
      select ref.id from refs ref join public.crm_leads local_row on local_row.id = ref.local_id and local_row.organization_id = ref.organization_id where ref.local_table = 'crm_leads' and ref.access_scope <> local_row.access_scope
    ) mismatches
  ),
  'cofounderLocalLeads', (select count(*) from refs ref join public.crm_leads lead on lead.id = ref.local_id where ref.local_table = 'crm_leads' and ref.archived_at is null and lead.archived_at is null and lead.access_scope = 'cofounders'),
  'expectedRelations', (select count(*) from expected_relations),
  'missingRelations', (select count(*) from expected_relations expected where not exists (select 1 from public.crm_lead_tags relation where relation.lead_id = expected.lead_id and relation.tag_id = expected.tag_id and relation.archived_at is null)),
  'conflictCount', (select count(*) from public.crm_import_changes where run_id = ${run} and operation = 'conflict'),
  'changeCount', (select count(*) from public.crm_import_changes where run_id = ${run}),
  'activatedByType', jsonb_build_object('categories', activated.categories, 'tags', activated.tags, 'leads', activated.leads),
  'postCounts', jsonb_build_object(
    'categories', (select count(*) from public.crm_categories row_record where row_record.organization_id = target_run.organization_id and row_record.archived_at is null),
    'tags', (select count(*) from public.crm_tags row_record where row_record.organization_id = target_run.organization_id and row_record.archived_at is null),
    'leads', (select count(*) from public.crm_leads row_record where row_record.organization_id = target_run.organization_id and row_record.archived_at is null)
  )
) as payload
from target_run cross join activated;`;
}

export function buildRunStatusSql(runId: string) {
  assertUuid(runId);
  return `/* naia:run-status */
select jsonb_build_object('status', status) as payload
from public.crm_import_runs where id = ${sqlDecodedText(runId)}::uuid;`;
}

export function buildRollbackSql(actorProfileId: string, runId: string) {
  assertUuid(runId);
  return `/* naia:rollback */
begin;
set local role authenticated;
with ${actorCte(actorProfileId)}
select public.rollback_crm_trello_import(${sqlDecodedText(runId)}::uuid) as payload
from actor_context;
commit;`;
}

export function buildRollbackVerificationSql(runId: string) {
  assertUuid(runId);
  const run = `${sqlDecodedText(runId)}::uuid`;
  return `/* naia:rollback-verify */
with target_run as (
  select * from public.crm_import_runs where id = ${run} and provider = 'trello'
), staged as (
  select stage.*
  from target_run
  join public.crm_import_staging stage
    on stage.run_id = target_run.id
    and stage.organization_id = target_run.organization_id
), run_refs as (
  select ref.*
  from target_run
  join public.crm_external_refs ref
    on ref.organization_id = target_run.organization_id
    and ref.provider = target_run.provider
    and ref.last_run_id = target_run.id
), refs as (
  select ref.*
  from target_run
  join staged stage on stage.organization_id = target_run.organization_id
  join public.crm_external_refs ref
    on stage.organization_id = ref.organization_id
    and ref.provider = target_run.provider
    and ref.external_type = stage.entity_type
    and ref.external_id = stage.external_id
), changes as (
  select change.*
  from target_run
  join public.crm_import_changes change
    on change.run_id = target_run.id
    and change.organization_id = target_run.organization_id
)
select jsonb_build_object(
  'status', target_run.status,
  'activeRefs', (select count(*) from run_refs where archived_at is null),
  'unexpectedRefs', (select count(*) from run_refs ref where not exists (select 1 from staged stage where stage.organization_id = ref.organization_id and stage.entity_type = ref.external_type and stage.external_id = ref.external_id)),
  'activeCreatedOrRevivedRows', (
    select count(*) from (
      select change.id from changes change join public.crm_categories row_record on row_record.id = change.local_id where change.operation in ('created', 'revived') and change.local_table = 'crm_categories' and row_record.archived_at is null
      union all
      select change.id from changes change join public.crm_tags row_record on row_record.id = change.local_id where change.operation in ('created', 'revived') and change.local_table = 'crm_tags' and row_record.archived_at is null
      union all
      select change.id from changes change join public.crm_leads row_record on row_record.id = change.local_id where change.operation in ('created', 'revived') and change.local_table = 'crm_leads' and row_record.archived_at is null
    ) active_rows
  ),
  'activeImportedRelations', (
    select count(*)
    from changes change
    join public.crm_lead_tags relation
      on relation.lead_id = (change.after_snapshot ->> 'leadId')::uuid
      and relation.tag_id = (change.after_snapshot ->> 'tagId')::uuid
    where change.operation = 'linked-relation'
      and coalesce(change.before_snapshot ->> 'wasPresent', 'false')::boolean = false
      and relation.archived_at is null
  ),
  'relationRollbackMismatches', (
    select count(*)
    from changes change
    left join public.crm_lead_tags relation
      on relation.lead_id = (change.after_snapshot ->> 'leadId')::uuid
      and relation.tag_id = (change.after_snapshot ->> 'tagId')::uuid
    where change.operation = 'linked-relation'
      and (
        (
          coalesce(change.before_snapshot ->> 'wasPresent', 'false')::boolean = false
          and (relation.lead_id is null or relation.archived_at is null)
        )
        or (
          coalesce(change.before_snapshot ->> 'wasPresent', 'false')::boolean = true
          and (
            relation.lead_id is null
            or relation.archived_at is distinct from
              (change.before_snapshot ->> 'previousArchivedAt')::timestamptz
          )
        )
      )
  )
) as payload from target_run;`;
}

function verifyStage(value: unknown, contract: TrelloImportSourceContract) {
  const stage = safeParse(
    stageVerificationSchema,
    value,
    "STAGE_VERIFICATION_INVALID",
  );
  assertGate(
    stage.expectedItemCount === contract.counts.totalItems &&
      stage.stagingCount === contract.counts.totalItems &&
      stage.categoryCount === contract.counts.categories &&
      stage.tagCount === contract.counts.tags &&
      stage.leadCount === contract.counts.leads &&
      stage.cofoundersOnly === contract.cofoundersOnly &&
      stage.validationErrorRows === 0 &&
      stage.sourceHash === contract.sourceHash &&
      stage.stagingHash === contract.stagingHash,
    "STAGE_VERIFICATION_FAILED",
    "Le staging ne correspond pas à l'attestation revue.",
  );
  return stage;
}

function verifyRls(args: {
  founder: unknown;
  nonFounder: unknown;
  contract: TrelloImportSourceContract;
  expectApplied: boolean;
}) {
  const founder = safeParse(
    rlsVerificationSchema,
    args.founder,
    "FOUNDER_RLS_INVALID",
  );
  const nonFounder = safeParse(
    rlsVerificationSchema,
    args.nonFounder,
    "NONFOUNDER_RLS_INVALID",
  );
  assertGate(
    founder.ledgerRuns === 1 &&
      founder.ledgerStaging === args.contract.counts.totalItems &&
      nonFounder.ledgerRuns === 0 &&
      nonFounder.ledgerStaging === 0 &&
      nonFounder.ledgerRefs === 0 &&
      nonFounder.ledgerChanges === 0 &&
      nonFounder.cofounderLeads === 0 &&
      nonFounder.cofounderLeadRelations === 0 &&
      nonFounder.importedCofounderLeads === 0 &&
      founder.unexpectedRefs === 0 &&
      nonFounder.unexpectedRefs === 0 &&
      nonFounder.organizationLeads > 0 &&
      (!args.expectApplied ||
        (founder.importedCofounderLeads === args.contract.cofoundersOnly &&
          founder.ledgerRefs === args.contract.counts.totalItems &&
          founder.ledgerChanges > 0)),
    "RLS_VERIFICATION_FAILED",
    "La vérification RLS fondateur/nonfondateur a échoué.",
  );
}

function verifyPostconditions(args: {
  contract: TrelloImportSourceContract;
  post: unknown;
  preCounts: z.infer<typeof snapshotSchema>["preCounts"];
  verifyDelta: boolean;
}) {
  const post = safeParse(
    postVerificationSchema,
    args.post,
    "POST_VERIFICATION_INVALID",
  );
  const summary = post.summary;
  const created = numberFromSummary(summary, "created");
  const linked = numberFromSummary(summary, "linked");
  const revived = numberFromSummary(summary, "revived");
  const unchanged = numberFromSummary(summary, "unchanged");
  const conflicts = numberFromSummary(summary, "conflicts");
  assertGate(
    post.status === "applied" &&
      conflicts === 0 &&
      post.conflictCount === 0 &&
      created + linked + revived + unchanged ===
        args.contract.counts.totalItems &&
      post.activeRefs === args.contract.counts.totalItems &&
      post.mappedRefs === args.contract.counts.totalItems &&
      post.hashMismatches === 0 &&
      post.refScopeMismatches === 0 &&
      post.unexpectedRefs === 0 &&
      post.localScopeMismatches === 0 &&
      post.activeCategoryMappings === args.contract.counts.categories &&
      post.activeTagMappings === args.contract.counts.tags &&
      post.activeLeadMappings === args.contract.counts.leads &&
      post.cofounderLocalLeads === args.contract.cofoundersOnly &&
      post.expectedRelations === args.contract.expectedLeadTagRelations &&
      post.missingRelations === 0,
    "POSTCONDITION_FAILED",
    "Les postconditions de l'import ont échoué.",
  );
  if (args.verifyDelta) {
    assertGate(
      post.postCounts.categories ===
        args.preCounts.categories + post.activatedByType.categories &&
        post.postCounts.tags ===
          args.preCounts.tags + post.activatedByType.tags &&
        post.postCounts.leads ===
          args.preCounts.leads + post.activatedByType.leads,
      "POST_DELTA_FAILED",
      "Les deltas CRM ne correspondent pas aux créations/réactivations.",
    );
  }
  return { conflicts, created, linked, post, revived, unchanged };
}

function postFingerprint(post: z.infer<typeof postVerificationSchema>) {
  return JSON.stringify({
    activeCategoryMappings: post.activeCategoryMappings,
    activeLeadMappings: post.activeLeadMappings,
    activeRefs: post.activeRefs,
    activeTagMappings: post.activeTagMappings,
    changeCount: post.changeCount,
    cofounderLocalLeads: post.cofounderLocalLeads,
    postCounts: post.postCounts,
  });
}

function verifyRollback(value: unknown) {
  const rollback = safeParse(
    rollbackVerificationSchema,
    value,
    "ROLLBACK_VERIFICATION_INVALID",
  );
  assertGate(
    rollback.status === "rolled-back" &&
      rollback.activeRefs === 0 &&
      rollback.unexpectedRefs === 0 &&
      rollback.activeCreatedOrRevivedRows === 0 &&
      rollback.activeImportedRelations === 0 &&
      rollback.relationRollbackMismatches === 0,
    "ROLLBACK_VERIFICATION_FAILED",
    "Le rollback compensatoire n'est pas complet.",
  );
}

async function rollbackAppliedRun(args: {
  actorProfileId: string;
  database: DatabasePort;
  runId: string;
}) {
  const status = safeParse(
    runStatusSchema,
    args.database.query("run-status", buildRunStatusSql(args.runId)),
    "RUN_STATUS_INVALID",
  );
  if (status.status !== "applied") return false;
  args.database.query(
    "rollback",
    buildRollbackSql(args.actorProfileId, args.runId),
  );
  verifyRollback(
    args.database.query(
      "rollback-verify",
      buildRollbackVerificationSql(args.runId),
    ),
  );
  return true;
}

export async function runCrmTrelloImport(
  options: RunCrmTrelloImportOptions,
  dependencies: RunnerDependencies,
): Promise<CrmTrelloImportResult> {
  const contract = options.sourceContract ?? COMMERCIAL_TRELLO_SOURCE_CONTRACT;
  assertGate(
    options.mode !== "apply" || options.confirmApply === true,
    "APPLY_CONFIRMATION_REQUIRED",
    "Le mode apply exige --confirm-apply.",
  );

  const targetContract = {
    organizationIdSha256: contract.organizationIdSha256,
    projectRefSha256: PRODUCTION_SUPABASE_PROJECT_REF_SHA256,
  } satisfies TrelloImportTargetContract;
  verifyTargetAttestation(dependencies.attestTarget(targetContract));

  const file = dependencies.loadExport(options.exportPath);
  verifyLocalSource(file, contract);
  const normalized = normalizeTrelloExport(file.bytes.toString("utf8"));
  verifyNormalizedSource(normalized, contract);

  verifySchemaGate(
    dependencies.database.query("schema-gate", buildSchemaGateSql()),
  );
  const snapshot = snapshotForReconciliation(
    dependencies.database.query("snapshot", buildSnapshotSql()),
  );
  assertGate(
    snapshot.organizationId !== null &&
      sha256(Buffer.from(snapshot.organizationId, "utf8")) ===
        targetContract.organizationIdSha256,
    "TARGET_ORGANIZATION_CHANGED",
    "Le contexte CRM ne correspond plus à l'organisation revue.",
  );
  const reconciled = verifyReconciliation(normalized, snapshot, contract);

  const baseResult = {
    counts: contract.counts,
    existingCrmDeterministicMatches:
      reconciled.review.existingCrmDeterministicMatches,
    mode: options.mode,
    privacy: { cofoundersOnly: contract.cofoundersOnly },
    sourceHash: contract.sourceHash,
    stagingHash: contract.stagingHash,
  } as const;

  if (options.mode === "dry-run") {
    return {
      ...baseResult,
      rlsVerified: false,
      schemaVerified: true,
      status: "ready",
    };
  }

  const actorProfileId = snapshot.actorProfileId!;
  const nonFounderProfileId = snapshot.nonFounderProfileId!;
  const organizationId = snapshot.organizationId!;
  const staged = safeParse(
    stageResponseSchema,
    dependencies.database.query(
      "stage",
      buildStageSql({
        actorProfileId,
        dryRun: reconciled,
        organizationId,
      }),
    ),
    "STAGE_RESPONSE_INVALID",
  );
  const verifiedStage = verifyStage(
    dependencies.database.query(
      "stage-verify",
      buildStageVerificationSql(staged.runId),
    ),
    contract,
  );
  assertGate(
    verifiedStage.status === staged.status,
    "STAGE_STATUS_CHANGED",
    "Le statut du staging a changé pendant les contrôles.",
  );
  verifyRls({
    contract,
    expectApplied: staged.status === "applied",
    founder: dependencies.database.query(
      "founder-rls",
      buildRlsVerificationSql({
        actorProfileId,
        organizationId,
        runId: staged.runId,
      }),
    ),
    nonFounder: dependencies.database.query(
      "nonfounder-rls",
      buildRlsVerificationSql({
        actorProfileId: nonFounderProfileId,
        organizationId,
        runId: staged.runId,
      }),
    ),
  });

  const eligibleForAutomaticRollback =
    staged.status === "staged" && verifiedStage.status === "staged";
  let applyAttempted = false;
  try {
    applyAttempted = true;
    const applySummary = safeParse(
      importSummarySchema,
      dependencies.database.query(
        "apply",
        buildApplySql(actorProfileId, staged.runId),
      ),
      "APPLY_RESPONSE_INVALID",
    );
    const postResult = verifyPostconditions({
      contract,
      post: dependencies.database.query(
        "post-verify",
        buildPostVerificationSql(staged.runId),
      ),
      preCounts: snapshot.preCounts,
      verifyDelta: eligibleForAutomaticRollback,
    });
    verifyRls({
      contract,
      expectApplied: true,
      founder: dependencies.database.query(
        "founder-rls",
        buildRlsVerificationSql({
          actorProfileId,
          organizationId,
          runId: staged.runId,
        }),
      ),
      nonFounder: dependencies.database.query(
        "nonfounder-rls",
        buildRlsVerificationSql({
          actorProfileId: nonFounderProfileId,
          organizationId,
          runId: staged.runId,
        }),
      ),
    });

    const replayStage = safeParse(
      stageResponseSchema,
      dependencies.database.query(
        "stage",
        buildStageSql({ actorProfileId, dryRun: reconciled, organizationId }),
      ),
      "REPLAY_STAGE_INVALID",
    );
    assertGate(
      replayStage.runId === staged.runId &&
        replayStage.reused &&
        replayStage.status === "applied",
      "REPLAY_STAGE_FAILED",
      "Le replay du staging n'est pas idempotent.",
    );
    const replaySummary = safeParse(
      importSummarySchema,
      dependencies.database.query(
        "apply",
        buildApplySql(actorProfileId, staged.runId),
      ),
      "REPLAY_APPLY_INVALID",
    );
    assertGate(
      replaySummary.idempotentReplay === true,
      "REPLAY_APPLY_FAILED",
      "Le replay de l'application n'est pas idempotent.",
    );
    const replayPostResult = verifyPostconditions({
      contract,
      post: dependencies.database.query(
        "post-verify",
        buildPostVerificationSql(staged.runId),
      ),
      preCounts: snapshot.preCounts,
      verifyDelta: false,
    });
    assertGate(
      postFingerprint(replayPostResult.post) ===
        postFingerprint(postResult.post),
      "REPLAY_MUTATED_STATE",
      "Le replay a modifié l'état CRM.",
    );

    // Read the explicit summary returned by apply only after every independent
    // database postcondition has passed. It is never written to stdout.
    const created = numberFromSummary(applySummary, "created");
    const linked = numberFromSummary(applySummary, "linked");
    const revived = numberFromSummary(applySummary, "revived");
    const unchanged = numberFromSummary(applySummary, "unchanged");
    const conflicts = numberFromSummary(applySummary, "conflicts");
    return {
      ...baseResult,
      applied: {
        conflicts,
        created,
        linked,
        replayVerified: true,
        revived,
        runId: staged.runId,
        unchanged,
      },
      rlsVerified: true,
      schemaVerified: true,
      status: "applied",
    };
  } catch (error) {
    if (eligibleForAutomaticRollback && applyAttempted) {
      try {
        const rolledBack = await rollbackAppliedRun({
          actorProfileId,
          database: dependencies.database,
          runId: staged.runId,
        });
        if (rolledBack) {
          throw new SafeImportError(
            "POSTCONDITION_ROLLED_BACK",
            "Une postcondition a échoué; l'import a été soft-archivé.",
          );
        }
      } catch (rollbackError) {
        if (
          rollbackError instanceof SafeImportError &&
          rollbackError.code === "POSTCONDITION_ROLLED_BACK"
        ) {
          throw rollbackError;
        }
        throw new SafeImportError(
          "ROLLBACK_FAILED",
          "Échec critique du rollback compensatoire; intervention requise.",
        );
      }
    }
    if (error instanceof SafeImportError) throw error;
    throw new SafeImportError(
      "APPLY_FAILED",
      "L'application de l'import a échoué sans sortie de données.",
    );
  }
}

function parseDatabasePayload(stdout: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(stdout);
  } catch {
    throw new SafeImportError(
      "DATABASE_OUTPUT_INVALID",
      "La commande base de données a retourné un format invalide.",
    );
  }
  const rows = Array.isArray(decoded)
    ? decoded
    : decoded &&
        typeof decoded === "object" &&
        "rows" in decoded &&
        Array.isArray((decoded as { rows: unknown }).rows)
      ? (decoded as { rows: unknown[] }).rows
      : decoded &&
          typeof decoded === "object" &&
          "data" in decoded &&
          Array.isArray((decoded as { data: unknown }).data)
        ? (decoded as { data: unknown[] }).data
        : [];
  const row = [...rows]
    .reverse()
    .find(
      (candidate) =>
        candidate && typeof candidate === "object" && "payload" in candidate,
    ) as { payload?: unknown } | undefined;
  assertGate(
    row && "payload" in row,
    "DATABASE_PAYLOAD_MISSING",
    "La commande base de données n'a pas retourné de contrôle exploitable.",
  );
  return row.payload;
}

export type SpawnSupabase = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    encoding: "utf8";
    input: string;
    maxBuffer: number;
    stdio: ["pipe", "pipe", "pipe"];
    timeout: number;
  },
) => SpawnSyncReturns<string>;

type RunnerFilesystemStat = {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  size: number;
};

export type RunnerFilesystem = {
  lstat(path: string): RunnerFilesystemStat;
  readFile(path: string): Buffer;
  realpath(path: string): string;
};

export type FilesystemDependencyOptions = {
  filesystem?: RunnerFilesystem;
  runtimeWorkdir?: string;
  spawn?: SpawnSupabase;
};

const nodeRunnerFilesystem: RunnerFilesystem = {
  lstat: (path) => lstatSync(path),
  readFile: (path) => readFileSync(path),
  realpath: (path) => realpathSync(path),
};

function targetStat(args: {
  code: string;
  filesystem: RunnerFilesystem;
  path: string;
  safeMessage: string;
}) {
  try {
    return args.filesystem.lstat(args.path);
  } catch {
    throw new SafeImportError(args.code, args.safeMessage);
  }
}

function verifyFilesystemTarget(args: {
  contract: TrelloImportTargetContract;
  filesystem: RunnerFilesystem;
  runtimeWorkdir: string;
  workdir: string;
}) {
  assertGate(
    sha256Schema.safeParse(args.contract.projectRefSha256).success &&
      sha256Schema.safeParse(args.contract.organizationIdSha256).success,
    "TARGET_CONTRACT_INVALID",
    "Le contrat de cible Supabase est invalide.",
  );
  const workdir = resolve(args.workdir);
  const runtimeWorkdir = resolve(args.runtimeWorkdir);
  assertGate(
    workdir === runtimeWorkdir,
    "TARGET_WORKDIR_MISMATCH",
    "Le dossier Supabase doit être le dossier courant revu.",
  );

  const workdirStat = targetStat({
    code: "TARGET_WORKDIR_MISSING",
    filesystem: args.filesystem,
    path: workdir,
    safeMessage: "Le dossier Supabase revu est introuvable.",
  });
  assertGate(
    workdirStat.isDirectory() && !workdirStat.isSymbolicLink(),
    "TARGET_WORKDIR_UNSAFE",
    "Le dossier Supabase revu n'est pas un dossier réel sûr.",
  );
  let realWorkdir: string;
  try {
    realWorkdir = args.filesystem.realpath(workdir);
  } catch {
    throw new SafeImportError(
      "TARGET_WORKDIR_UNSAFE",
      "Le dossier Supabase revu n'est pas résoluble sûrement.",
    );
  }
  assertGate(
    realWorkdir === workdir,
    "TARGET_WORKDIR_UNSAFE",
    "Le dossier Supabase revu ne peut pas passer par un lien symbolique.",
  );

  const projectRefPath = join(workdir, "supabase", ".temp", "project-ref");
  const projectRefStat = targetStat({
    code: "TARGET_PROJECT_LINK_MISSING",
    filesystem: args.filesystem,
    path: projectRefPath,
    safeMessage: "La liaison Supabase revue est introuvable.",
  });
  assertGate(
    projectRefStat.isFile() &&
      !projectRefStat.isSymbolicLink() &&
      projectRefStat.size > 0 &&
      projectRefStat.size <= 256,
    "TARGET_PROJECT_LINK_UNSAFE",
    "La liaison Supabase revue n'est pas un fichier sûr.",
  );
  let realProjectRefPath: string;
  let projectRefBytes: Buffer;
  try {
    realProjectRefPath = args.filesystem.realpath(projectRefPath);
    projectRefBytes = args.filesystem.readFile(projectRefPath);
  } catch {
    throw new SafeImportError(
      "TARGET_PROJECT_LINK_UNSAFE",
      "La liaison Supabase revue n'est pas lisible sûrement.",
    );
  }
  assertGate(
    realProjectRefPath === projectRefPath,
    "TARGET_PROJECT_LINK_UNSAFE",
    "La liaison Supabase revue ne peut pas passer par un lien symbolique.",
  );
  const projectRef = projectRefBytes.toString("utf8").trim();
  assertGate(
    projectRef.length > 0 &&
      sha256(Buffer.from(projectRef, "utf8")) ===
        args.contract.projectRefSha256,
    "TARGET_PROJECT_MISMATCH",
    "La liaison Supabase ne correspond pas à la cible revue.",
  );
}

export class SupabaseStdinDatabase implements DatabasePort {
  constructor(
    private readonly workdir: string,
    private readonly spawn: SpawnSupabase = spawnSync,
  ) {}

  query(_operation: DatabaseOperation, sql: string) {
    const result = this.spawn(
      "supabase",
      [
        "--log-level",
        "error",
        "db",
        "query",
        "--linked",
        "--file",
        "/dev/stdin",
        "--output",
        "json",
      ],
      {
        cwd: this.workdir,
        encoding: "utf8",
        input: sql,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
      },
    );
    if (result.error || result.status !== 0) {
      // stderr and SQL are deliberately discarded: either can contain a
      // database statement or provider detail. Only this fixed message leaves
      // the process boundary.
      throw new SafeImportError(
        "DATABASE_COMMAND_FAILED",
        "Commande Supabase échouée; aucune sortie SQL n'a été affichée.",
      );
    }
    return parseDatabasePayload(result.stdout);
  }
}

export function createFilesystemDependencies(
  workdir: string,
  options: FilesystemDependencyOptions = {},
): RunnerDependencies {
  const filesystem = options.filesystem ?? nodeRunnerFilesystem;
  const resolvedWorkdir = resolve(workdir);
  const database = new SupabaseStdinDatabase(resolvedWorkdir, options.spawn);
  return {
    attestTarget(contract) {
      verifyFilesystemTarget({
        contract,
        filesystem,
        runtimeWorkdir: options.runtimeWorkdir ?? process.cwd(),
        workdir,
      });
      return database.query(
        "target-attestation",
        buildTargetAttestationSql(contract.organizationIdSha256),
      );
    },
    database,
    loadExport(path) {
      const stat = filesystem.lstat(path);
      return {
        bytes: filesystem.readFile(path),
        isRegularFile: stat.isFile() && !stat.isSymbolicLink(),
        mode: stat.mode,
        size: stat.size,
      };
    },
  };
}
