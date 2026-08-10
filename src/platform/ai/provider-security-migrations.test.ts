import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const quotaMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260810020926_external_ai_daily_quota.sql",
  ),
  "utf8",
);
const slackMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260810021401_slack_event_claims.sql",
  ),
  "utf8",
);

describe("provider security migrations", () => {
  it("uses an atomic founder-only daily quota without direct table access", () => {
    expect(quotaMigration).toContain("external_ai_daily_usage");
    expect(quotaMigration).toContain("enable row level security");
    expect(quotaMigration).toContain("security definer");
    expect(quotaMigration).toContain("set search_path = ''");
    expect(quotaMigration).toContain("'ali@qarizmi.com', 'nabil@qarizmi.com'");
    expect(quotaMigration).toContain("membership.role in ('owner', 'admin')");
    expect(quotaMigration).toContain(
      "public.external_ai_daily_usage.request_count < requested_limit",
    );
    expect(quotaMigration).toContain("from public, anon, authenticated");
    expect(quotaMigration).not.toMatch(
      /grant\s+(?:select|insert|update|delete).*external_ai_daily_usage/i,
    );
  });

  it("claims Slack event IDs atomically with TTL and no destructive cleanup", () => {
    expect(slackMigration).toContain("claim_slack_event");
    expect(slackMigration).toContain("on conflict (event_id)");
    expect(slackMigration).toContain(
      "public.slack_event_claims.expires_at <= now()",
    );
    expect(slackMigration).toContain("to service_role");
    expect(slackMigration).toContain("from public, anon, authenticated");
    expect(slackMigration).not.toMatch(/\bdelete\s+from\b/i);
  });
});
