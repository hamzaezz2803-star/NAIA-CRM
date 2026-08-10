// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const actionsSource = readFileSync(
  new URL("./actions.ts", import.meta.url),
  "utf8",
);
const fetchTasksSource = actionsSource.slice(
  actionsSource.indexOf("export async function fetchTasksAction"),
  actionsSource.indexOf("export async function createTaskAction"),
);

describe("CRM task archive boundary", () => {
  it("excludes archived tasks and leads from reads and on-demand backfill", () => {
    expect(fetchTasksSource).toContain('.from("crm_tasks")');
    expect(fetchTasksSource).toContain('.from("crm_leads")');
    expect(fetchTasksSource.match(/\.is\("archived_at", null\)/g)).toHaveLength(
      3,
    );
  });
});
