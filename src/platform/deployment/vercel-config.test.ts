// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const vercelConfig = JSON.parse(
  readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"),
) as {
  crons?: Array<{ path?: string; schedule?: string }>;
  regions?: string[];
};

describe("Vercel production placement", () => {
  it("co-locates functions with the Frankfurt Supabase project", () => {
    expect(vercelConfig.regions).toEqual(["fra1"]);
  });

  it("retains the guarded daily brief schedule", () => {
    expect(vercelConfig.crons).toContainEqual({
      path: "/api/cron/naia-daily-brief",
      schedule: "30 8,9 * * *",
    });
  });

  it("recovers durable WhatsApp inbox work every minute", () => {
    expect(vercelConfig.crons).toContainEqual({
      path: "/api/cron/naia-whatsapp-inbox",
      schedule: "* * * * *",
    });
  });
});
