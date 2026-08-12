import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260812123107_naia_daily_brief_multichannel.sql",
  ),
  "utf8",
);

describe("daily brief multichannel migration", () => {
  it("deduplicates Slack and WhatsApp independently", () => {
    expect(migration).toContain(
      "delivery_channel text not null default 'slack'",
    );
    expect(migration).toContain("whatsapp_message_id text");
    expect(migration).toContain("(profile_id, local_date, delivery_channel)");
    expect(migration).toContain("runs.delivery_channel = p_delivery_channel");
  });

  it("keeps the channel-aware reclaim RPC service-role-only", () => {
    expect(migration).toContain(
      "revoke all on function public.reclaim_naia_daily_brief_run(uuid, uuid, date, text)",
    );
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });

  it("keeps the old Slack-only RPC safe during a rolling deployment", () => {
    expect(migration).toContain("p_local_date,\n    'slack'");
    expect(migration).toContain(
      "revoke all on function public.reclaim_naia_daily_brief_run(uuid, uuid, date)",
    );
  });

  it("never reclaims an ambiguous post-delivery run", () => {
    expect(migration).toContain("runs.delivery_started_at is null");
    expect(migration).not.toMatch(/runs\.status = 'delivery_uncertain'/);
    expect(migration).not.toMatch(/runs\.status = 'sent'/);
  });
});
