import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildApplySql,
  buildPostVerificationSql,
  buildRollbackSql,
  buildRollbackVerificationSql,
  buildRlsVerificationSql,
  buildRunStatusSql,
  buildSchemaGateSql,
  buildSnapshotSql,
  buildStageSql,
  buildStageVerificationSql,
  runCrmTrelloImport,
  SupabaseStdinDatabase,
  type DatabasePort,
  type RunnerDependencies,
  type SpawnSupabase,
  type TrelloImportSourceContract,
} from "./trello-import-runner";
import {
  createTrelloStagingAttestation,
  normalizeTrelloExport,
} from "./trello-import";

const ALI_ID = "20000000-0000-4000-8000-000000000001";
const MEMBER_ID = "20000000-0000-4000-8000-000000000002";
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "90000000-0000-4000-8000-000000000001";

const board = {
  cards: [
    {
      attachments: [],
      closed: false,
      desc: "",
      id: "card-1",
      idLabels: ["label-1"],
      idList: "list-1",
      idMembers: [],
      name: "Prospect synthétique",
      pos: 1,
    },
  ],
  checklists: [],
  id: "board-1",
  labels: [{ color: "red", id: "label-1", name: "Urgent" }],
  lists: [{ closed: false, id: "list-1", name: "Contacted", pos: 1 }],
  name: "Board synthétique",
};

const exportBytes = Buffer.from(JSON.stringify(board), "utf8");
const normalized = normalizeTrelloExport(exportBytes.toString("utf8"));
const attestation = createTrelloStagingAttestation(normalized.items);
const contract: TrelloImportSourceContract = {
  boardId: board.id,
  cofoundersOnly: 0,
  counts: { categories: 1, leads: 1, tags: 1, totalItems: 3 },
  expectedLeadTagRelations: 1,
  rawSha256: createHash("sha256").update(exportBytes).digest("hex"),
  rawSize: exportBytes.length,
  sourceHash: normalized.sourceHash,
  stagingHash: attestation.stagingHash,
};

const schemaReady = {
  attestationColumns: true,
  crmTablesRls: true,
  functionsDeleteFree: true,
  functionsPresent: true,
  functionsRestricted: true,
  ledgerGrantsReadOnly: true,
  ledgerPoliciesReadOnly: true,
  ledgerRls: true,
  migrationsApplied: true,
};

const snapshot = {
  actorProfileId: ALI_ID,
  categories: [],
  contextCount: 1,
  externalRefs: [],
  leads: [],
  nonFounderCount: 1,
  nonFounderProfileId: MEMBER_ID,
  organizationId: ORGANIZATION_ID,
  preCounts: { categories: 1, leads: 1, tags: 1 },
  tags: [],
};

const stageVerification = {
  categoryCount: 1,
  cofoundersOnly: 0,
  expectedItemCount: 3,
  leadCount: 1,
  sourceHash: contract.sourceHash,
  stagingCount: 3,
  stagingHash: contract.stagingHash,
  status: "staged",
  tagCount: 1,
  validationErrorRows: 0,
};

const founderRlsBefore = {
  cofounderLeadRelations: 0,
  cofounderLeads: 0,
  importedCofounderLeads: 0,
  ledgerChanges: 0,
  ledgerRefs: 0,
  ledgerRuns: 1,
  ledgerStaging: 3,
  organizationLeads: 1,
  unexpectedRefs: 0,
};

const founderRlsAfter = {
  ...founderRlsBefore,
  ledgerChanges: 4,
  ledgerRefs: 3,
};

const nonFounderRls = {
  cofounderLeadRelations: 0,
  cofounderLeads: 0,
  importedCofounderLeads: 0,
  ledgerChanges: 0,
  ledgerRefs: 0,
  ledgerRuns: 0,
  ledgerStaging: 0,
  organizationLeads: 1,
  unexpectedRefs: 0,
};

const applySummary = {
  conflicts: 0,
  created: 3,
  linked: 0,
  revived: 0,
  unchanged: 0,
};

const validPost = {
  activeCategoryMappings: 1,
  activeLeadMappings: 1,
  activeRefs: 3,
  activeTagMappings: 1,
  activatedByType: { categories: 1, leads: 1, tags: 1 },
  changeCount: 4,
  cofounderLocalLeads: 0,
  conflictCount: 0,
  expectedRelations: 1,
  hashMismatches: 0,
  localScopeMismatches: 0,
  mappedRefs: 3,
  missingRelations: 0,
  postCounts: { categories: 2, leads: 2, tags: 2 },
  refScopeMismatches: 0,
  status: "applied",
  summary: applySummary,
  unexpectedRefs: 0,
};

function dependencies(database: DatabasePort): RunnerDependencies {
  return {
    database,
    loadExport: () => ({
      bytes: exportBytes,
      isRegularFile: true,
      mode: 0o100600,
      size: exportBytes.length,
    }),
  };
}

class MockDatabase implements DatabasePort {
  readonly calls: Array<{ operation: string; sql: string }> = [];
  private counts = new Map<string, number>();

  constructor(private readonly conflictPost = false) {}

  query(operation: Parameters<DatabasePort["query"]>[0], sql: string) {
    this.calls.push({ operation, sql });
    const count = (this.counts.get(operation) ?? 0) + 1;
    this.counts.set(operation, count);
    switch (operation) {
      case "schema-gate":
        return schemaReady;
      case "snapshot":
        return snapshot;
      case "stage":
        return count === 1
          ? { reused: false, runId: RUN_ID, status: "staged" }
          : { reused: true, runId: RUN_ID, status: "applied" };
      case "stage-verify":
        return stageVerification;
      case "founder-rls":
        return count === 1 ? founderRlsBefore : founderRlsAfter;
      case "nonfounder-rls":
        return nonFounderRls;
      case "apply":
        return count === 1
          ? applySummary
          : { ...applySummary, idempotentReplay: true };
      case "post-verify":
        return this.conflictPost
          ? {
              ...validPost,
              conflictCount: 1,
              summary: { ...applySummary, conflicts: 1 },
            }
          : validPost;
      case "run-status":
        return { status: "applied" };
      case "rollback":
        return { softArchivedOnRollback: 4 };
      case "rollback-verify":
        return {
          activeCreatedOrRevivedRows: 0,
          activeImportedRelations: 0,
          activeRefs: 0,
          relationRollbackMismatches: 0,
          status: "rolled-back",
          unexpectedRefs: 0,
        };
    }
  }
}

describe("CRM Trello import runner", () => {
  it("passes a complete dry-run using only aggregate responses", async () => {
    const database = new MockDatabase();
    const result = await runCrmTrelloImport(
      {
        exportPath: "/secure/export.json",
        mode: "dry-run",
        sourceContract: contract,
      },
      dependencies(database),
    );

    expect(result).toMatchObject({
      counts: contract.counts,
      mode: "dry-run",
      rlsVerified: false,
      schemaVerified: true,
      status: "ready",
    });
    expect(database.calls.map(({ operation }) => operation)).toEqual([
      "schema-gate",
      "snapshot",
    ]);
  });

  it("stages, applies, checks RLS, and proves an idempotent replay", async () => {
    const database = new MockDatabase();
    const result = await runCrmTrelloImport(
      {
        confirmApply: true,
        exportPath: "/secure/export.json",
        mode: "apply",
        sourceContract: contract,
      },
      dependencies(database),
    );

    expect(result.status).toBe("applied");
    expect(result.applied).toEqual({
      conflicts: 0,
      created: 3,
      linked: 0,
      replayVerified: true,
      revived: 0,
      runId: RUN_ID,
      unchanged: 0,
    });
    expect(database.calls.map(({ operation }) => operation)).toEqual([
      "schema-gate",
      "snapshot",
      "stage",
      "stage-verify",
      "founder-rls",
      "nonfounder-rls",
      "apply",
      "post-verify",
      "founder-rls",
      "nonfounder-rls",
      "stage",
      "apply",
      "post-verify",
    ]);
  });

  it("soft-archives a newly applied run when a postcondition fails", async () => {
    const database = new MockDatabase(true);

    await expect(
      runCrmTrelloImport(
        {
          confirmApply: true,
          exportPath: "/secure/export.json",
          mode: "apply",
          sourceContract: contract,
        },
        dependencies(database),
      ),
    ).rejects.toMatchObject({ code: "POSTCONDITION_ROLLED_BACK" });
    expect(database.calls.map(({ operation }) => operation)).toContain(
      "rollback",
    );
    expect(database.calls.map(({ operation }) => operation)).toContain(
      "rollback-verify",
    );
  });

  it("requires an explicit apply confirmation", async () => {
    await expect(
      runCrmTrelloImport(
        {
          exportPath: "/secure/export.json",
          mode: "apply",
          sourceContract: contract,
        },
        dependencies(new MockDatabase()),
      ),
    ).rejects.toMatchObject({ code: "APPLY_CONFIRMATION_REQUIRED" });
  });
});

describe("Supabase stdin transport", () => {
  it("keeps SQL exclusively on stdin and discards provider stderr", () => {
    const spawn = vi.fn<SpawnSupabase>(
      () =>
        ({
          error: undefined,
          output: [],
          pid: 1,
          signal: null,
          status: 0,
          stderr: "provider detail that must remain private",
          stdout:
            '{"boundary":"query","rows":[{"payload":{"ready":true}}],"warning":"captured"}',
        }) as ReturnType<SpawnSupabase>,
    );
    const database = new SupabaseStdinDatabase("/repo", spawn);
    const sql = "select sensitive_normalized_payload";

    expect(database.query("schema-gate", sql)).toEqual({ ready: true });
    const [, args, options] = spawn.mock.calls[0]!;
    expect(args).toContain("/dev/stdin");
    expect(args.join(" ")).not.toContain(sql);
    expect(options.input).toBe(sql);
    expect(options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(options.timeout).toBe(120_000);
  });

  it("returns only a fixed error when the provider command fails", () => {
    const spawn = vi.fn<SpawnSupabase>(
      () =>
        ({
          error: undefined,
          output: [],
          pid: 1,
          signal: null,
          status: 1,
          stderr: "raw SQL and data",
          stdout: "",
        }) as ReturnType<SpawnSupabase>,
    );
    const database = new SupabaseStdinDatabase("/repo", spawn);

    expect(() => database.query("schema-gate", "secret SQL")).toThrowError(
      expect.objectContaining({
        code: "DATABASE_COMMAND_FAILED",
        message: expect.not.stringContaining("raw SQL"),
      }),
    );
  });
});

describe("generated SQL safety", () => {
  it("never emits a DELETE statement in any mutating query", () => {
    const sql = [
      buildStageSql({
        actorProfileId: ALI_ID,
        dryRun: normalized,
        organizationId: ORGANIZATION_ID,
      }),
      buildApplySql(ALI_ID, RUN_ID),
      buildRollbackSql(ALI_ID, RUN_ID),
    ].join("\n");
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("builds every control query without embedding raw Trello text in argv", () => {
    const sql = [
      buildSchemaGateSql(),
      buildSnapshotSql(),
      buildStageVerificationSql(RUN_ID),
      buildRlsVerificationSql({
        actorProfileId: ALI_ID,
        organizationId: ORGANIZATION_ID,
        runId: RUN_ID,
      }),
      buildPostVerificationSql(RUN_ID),
      buildRunStatusSql(RUN_ID),
      buildRollbackVerificationSql(RUN_ID),
    ];
    expect(sql.every((statement) => statement.length > 0)).toBe(true);
    expect(sql.join("\n")).not.toContain(board.cards[0].name);
  });

  it("scopes revived references to the exact staging provenance of the current run", () => {
    const verificationSql = [
      buildRlsVerificationSql({
        actorProfileId: ALI_ID,
        organizationId: ORGANIZATION_ID,
        runId: RUN_ID,
      }),
      buildPostVerificationSql(RUN_ID),
      buildRollbackVerificationSql(RUN_ID),
    ];

    for (const sql of verificationSql) {
      expect(sql).not.toMatch(/first_run_id\s*=/i);
      expect(sql).toMatch(/ref\.last_run_id\s*=\s*target_run\.id/i);
      expect(sql).toMatch(
        /ref\.organization_id\s*=\s*target_run\.organization_id/i,
      );
      expect(sql).toMatch(/ref\.provider\s*=\s*target_run\.provider/i);
      expect(sql).toMatch(/stage\.organization_id\s*=\s*ref\.organization_id/i);
      expect(sql).toMatch(/stage\.entity_type\s*=\s*ref\.external_type/i);
      expect(sql).toMatch(/stage\.external_id\s*=\s*ref\.external_id/i);
      const refsCte = sql.match(
        /\), refs as(?: materialized)? \(([\s\S]*?)\n\), (?:expected_relations|changes) as/i,
      )?.[1];
      expect(refsCte).toContain("join public.crm_external_refs ref");
      expect(refsCte).not.toContain("from run_refs ref");
      expect(sql).toContain("'unexpectedRefs'");
    }
  });

  it("verifies the exact pre-run state of revived lead-tag relations on rollback", () => {
    const sql = buildRollbackVerificationSql(RUN_ID);

    expect(sql).toContain("'relationRollbackMismatches'");
    expect(sql).toMatch(
      /relationRollbackMismatches'[\s\S]*?left join public\.crm_lead_tags relation/i,
    );
    expect(sql).toMatch(/before_snapshot\s*->>\s*'previousArchivedAt'/i);
    expect(sql).toMatch(/relation\.lead_id\s+is\s+null/i);
    expect(sql).toMatch(/relation\.archived_at\s+is\s+distinct\s+from/i);
  });
});
