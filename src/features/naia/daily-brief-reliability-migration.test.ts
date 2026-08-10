import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260810023409_daily_brief_reliability.sql",
  ),
  "utf8",
);

describe("daily brief reliability migration", () => {
  it("reclaims only failed or provably pre-delivery stale runs atomically", () => {
    expect(migration).toContain("update public.naia_daily_brief_runs as runs");
    expect(migration).toMatch(/runs\.status = 'failed'/);
    expect(migration).toMatch(/runs\.status = 'sending'/);
    expect(migration).toMatch(/runs\.delivery_started_at is null/);
    expect(migration).toMatch(
      /runs\.updated_at < now\(\) - interval '10 minutes'/,
    );
    expect(migration).not.toMatch(/runs\.status = 'sent'/);
    expect(migration).not.toMatch(/runs\.status = 'delivery_uncertain'/);
  });

  it("keeps the RPC service-role-only", () => {
    expect(migration).toContain(
      "revoke all on function public.reclaim_naia_daily_brief_run(uuid, uuid, date)",
    );
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });
});
