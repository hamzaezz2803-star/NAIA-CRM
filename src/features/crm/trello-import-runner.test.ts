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
  buildTargetAttestationSql,
  createFilesystemDependencies,
  runCrmTrelloImport,
  SupabaseStdinDatabase,
  verifyReviewedProductionTarget,
  type DatabasePort,
  type RunnerFilesystem,
  type RunnerDependencies,
  type SpawnSupabase,
  type TrelloImportSourceContract,
  type TrelloImportTargetContract,
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
  organizationIdSha256: createHash("sha256")
    .update(ORGANIZATION_ID)
    .digest("hex"),
  rawSha256: createHash("sha256").update(exportBytes).digest("hex"),
  rawSize: exportBytes.length,
  sourceHash: normalized.sourceHash,
  stagingHash: attestation.stagingHash,
};

const targetReady = {
  cofoundersPresent: true,
  organizationMatch: true,
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
    attestTarget: () => targetReady,
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

const syntheticTargetContract: TrelloImportTargetContract = {
  organizationIdSha256: contract.organizationIdSha256,
  projectRefSha256: createHash("sha256")
    .update("synthetic-project")
    .digest("hex"),
};

function fakeTargetFilesystem(args: {
  missingProjectRef?: boolean;
  projectRef?: string;
  symlinkedWorkdir?: boolean;
}): RunnerFilesystem {
  const projectRef = args.projectRef ?? "synthetic-project";
  return {
    lstat(path) {
      if (path === "/repo") {
        return {
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => args.symlinkedWorkdir === true,
          mode: 0o40700,
          size: 0,
        };
      }
      if (path === "/repo/supabase/.temp/project-ref") {
        if (args.missingProjectRef) throw new Error("missing");
        return {
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
          mode: 0o100600,
          size: Buffer.byteLength(projectRef),
        };
      }
      throw new Error("unexpected path");
    },
    readFile: () => Buffer.from(projectRef, "utf8"),
    realpath: (path) => path,
  };
}

function providerMustNotRun() {
  return vi.fn<SpawnSupabase>(() => {
    throw new Error("provider must not run");
  });
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

  it("attests the production target before reading the export or CRM", async () => {
    const events: string[] = [];
    const database = new MockDatabase();
    const wrappedDatabase: DatabasePort = {
      query(operation, sql) {
        events.push(`database:${operation}`);
        return database.query(operation, sql);
      },
    };

    await runCrmTrelloImport(
      {
        exportPath: "/secure/export.json",
        mode: "dry-run",
        sourceContract: contract,
      },
      {
        attestTarget: () => {
          events.push("target");
          return targetReady;
        },
        database: wrappedDatabase,
        loadExport: () => {
          events.push("source");
          return {
            bytes: exportBytes,
            isRegularFile: true,
            mode: 0o100600,
            size: exportBytes.length,
          };
        },
      },
    );

    expect(events.slice(0, 3)).toEqual([
      "target",
      "source",
      "database:schema-gate",
    ]);
  });

  it("rejects an incorrect production organization before source or CRM reads", async () => {
    const database = new MockDatabase();
    const loadExport = vi.fn(() => {
      throw new Error("source must not be read");
    });

    await expect(
      runCrmTrelloImport(
        {
          exportPath: "/secure/export.json",
          mode: "dry-run",
          sourceContract: contract,
        },
        {
          attestTarget: () => ({
            cofoundersPresent: true,
            organizationMatch: false,
          }),
          database,
          loadExport,
        },
      ),
    ).rejects.toMatchObject({ code: "TARGET_ORGANIZATION_MISMATCH" });
    expect(loadExport).not.toHaveBeenCalled();
    expect(database.calls).toEqual([]);
  });

  it("rejects a target missing a reviewed cofounder before source or CRM reads", async () => {
    const database = new MockDatabase();
    const loadExport = vi.fn(() => {
      throw new Error("source must not be read");
    });

    await expect(
      runCrmTrelloImport(
        {
          exportPath: "/secure/export.json",
          mode: "dry-run",
          sourceContract: contract,
        },
        {
          attestTarget: () => ({
            cofoundersPresent: false,
            organizationMatch: true,
          }),
          database,
          loadExport,
        },
      ),
    ).rejects.toMatchObject({ code: "TARGET_COFUNDERS_MISSING" });
    expect(loadExport).not.toHaveBeenCalled();
    expect(database.calls).toEqual([]);
  });

  it("rejects a snapshot whose organization changed after attestation", async () => {
    const database = new MockDatabase();
    const changedDatabase: DatabasePort = {
      query(operation, sql) {
        if (operation === "snapshot") {
          return {
            ...snapshot,
            organizationId: "10000000-0000-4000-8000-000000000099",
          };
        }
        return database.query(operation, sql);
      },
    };

    await expect(
      runCrmTrelloImport(
        {
          exportPath: "/secure/export.json",
          mode: "dry-run",
          sourceContract: contract,
        },
        dependencies(changedDatabase),
      ),
    ).rejects.toMatchObject({ code: "TARGET_ORGANIZATION_CHANGED" });
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

describe("production target filesystem boundary", () => {
  it("rejects a mismatched environment URL before target attestation", () => {
    const attestTarget = vi.fn();

    expect(() =>
      verifyReviewedProductionTarget({
        dependencies: { attestTarget },
        supabaseUrl: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
      }),
    ).toThrowError(expect.objectContaining({ code: "TARGET_URL_MISMATCH" }));
    expect(attestTarget).not.toHaveBeenCalled();
  });

  it("attests the reviewed URL, linked project, organization, and cofounders", () => {
    const attestTarget = vi.fn(() => targetReady);
    const reviewedProjectRef = "juqhonvapkrlylvseolu";

    expect(() =>
      verifyReviewedProductionTarget({
        dependencies: { attestTarget },
        supabaseUrl: `https://${reviewedProjectRef}.supabase.co`,
      }),
    ).not.toThrow();
    expect(attestTarget).toHaveBeenCalledWith({
      organizationIdSha256:
        "3a4a564659d65572eb77be0e02c3b6d61ecd659761802e0b521486bddb9ba461",
      projectRefSha256:
        "afde75cbef68512550adedf94df1452f069248f98ed15874d0628c5994b12232",
    });
  });

  it("rejects a different database workdir before invoking Supabase", () => {
    const spawn = providerMustNotRun();
    const dependencies = createFilesystemDependencies("/other", {
      filesystem: fakeTargetFilesystem({}),
      runtimeWorkdir: "/repo",
      spawn,
    });

    expect(() =>
      dependencies.attestTarget(syntheticTargetContract),
    ).toThrowError(
      expect.objectContaining({ code: "TARGET_WORKDIR_MISMATCH" }),
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects a missing project link before invoking Supabase", () => {
    const spawn = providerMustNotRun();
    const dependencies = createFilesystemDependencies("/repo", {
      filesystem: fakeTargetFilesystem({ missingProjectRef: true }),
      runtimeWorkdir: "/repo",
      spawn,
    });

    expect(() =>
      dependencies.attestTarget(syntheticTargetContract),
    ).toThrowError(
      expect.objectContaining({ code: "TARGET_PROJECT_LINK_MISSING" }),
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects a symlinked workdir before invoking Supabase", () => {
    const spawn = providerMustNotRun();
    const dependencies = createFilesystemDependencies("/repo", {
      filesystem: fakeTargetFilesystem({ symlinkedWorkdir: true }),
      runtimeWorkdir: "/repo",
      spawn,
    });

    expect(() =>
      dependencies.attestTarget(syntheticTargetContract),
    ).toThrowError(expect.objectContaining({ code: "TARGET_WORKDIR_UNSAFE" }));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects an incorrect linked project before invoking Supabase", () => {
    const spawn = providerMustNotRun();
    const dependencies = createFilesystemDependencies("/repo", {
      filesystem: fakeTargetFilesystem({ projectRef: "wrong-project" }),
      runtimeWorkdir: "/repo",
      spawn,
    });

    expect(() =>
      dependencies.attestTarget(syntheticTargetContract),
    ).toThrowError(
      expect.objectContaining({ code: "TARGET_PROJECT_MISMATCH" }),
    );
    expect(spawn).not.toHaveBeenCalled();
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

  it("attests the reviewed organization without exposing its identifier", () => {
    const sql = buildTargetAttestationSql(contract.organizationIdSha256);

    expect(sql).toContain("extensions.digest");
    expect(sql).toContain("'organizationMatch'");
    expect(sql).toContain("'cofoundersPresent'");
    expect(sql).not.toContain(ORGANIZATION_ID);
    expect(sql).not.toContain(contract.organizationIdSha256);
    expect(sql).not.toMatch(/\b(?:delete|insert|update)\b/i);
  });

  it("builds every control query without embedding raw Trello text in argv", () => {
    const sql = [
      buildTargetAttestationSql(contract.organizationIdSha256),
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
