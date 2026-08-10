#!/usr/bin/env node

import process from "node:process";

import {
  createFilesystemDependencies,
  DEFAULT_TRELLO_EXPORT_PATH,
  runCrmTrelloImport,
  SafeImportError,
  type CrmTrelloImportMode,
} from "../src/features/crm/trello-import-runner";

function readOption(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseMode(): CrmTrelloImportMode {
  const requested = process.argv[2];
  if (requested === "apply" || requested === "dry-run") return requested;
  throw new SafeImportError(
    "MODE_REQUIRED",
    "Usage: npm run crm:trello-import -- dry-run|apply [--confirm-apply]",
  );
}

async function main() {
  const mode = parseMode();
  const exportPath = readOption("--export") ?? DEFAULT_TRELLO_EXPORT_PATH;
  const databaseWorkdir = readOption("--database-workdir") ?? process.cwd();
  const result = await runCrmTrelloImport(
    {
      confirmApply: process.argv.includes("--confirm-apply"),
      exportPath,
      mode,
    },
    createFilesystemDependencies(databaseWorkdir),
  );
  // The result contains only reviewed hashes, counts, a run UUID and booleans.
  // Raw Trello/CRM values and provider command output never reach stdout.
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

main().catch((error: unknown) => {
  const safeError =
    error instanceof SafeImportError
      ? error
      : new SafeImportError(
          "UNEXPECTED_FAILURE",
          "Échec sécurisé sans sortie de données.",
        );
  process.stderr.write(
    `${JSON.stringify({
      code: safeError.code,
      message: safeError.message,
      ok: false,
    })}\n`,
  );
  process.exitCode = 1;
});
