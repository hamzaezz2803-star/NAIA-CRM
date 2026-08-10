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
  it("keeps task reads side-effect free and excludes archived tasks", () => {
    expect(fetchTasksSource).toContain('.from("crm_tasks")');
    expect(fetchTasksSource).not.toContain('.from("crm_leads")');
    expect(fetchTasksSource).toContain('.is("archived_at", null)');
    expect(fetchTasksSource).not.toContain(".insert(");
    expect(fetchTasksSource).not.toContain(".update(");
    expect(fetchTasksSource).not.toContain(".delete(");
  });
});
