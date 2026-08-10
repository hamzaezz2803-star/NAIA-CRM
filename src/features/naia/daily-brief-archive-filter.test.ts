// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./daily-brief.ts", import.meta.url),
  "utf8",
);

describe("NAIA daily brief CRM archive boundary", () => {
  it("excludes archived tasks and leads even for service-role reads", () => {
    const archiveFilters = source.match(/\.is\("archived_at", null\)/g) ?? [];
    expect(archiveFilters).toHaveLength(2);
  });
});
