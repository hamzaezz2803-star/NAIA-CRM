// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260812131053_naia_whatsapp_inbound_queue.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const profileIndexMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260812134722_index_naia_whatsapp_inbound_queue_profile.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const historyDedupeMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260812135443_dedupe_naia_whatsapp_history_by_wamid.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

describe("NAIA WhatsApp durable inbox migration", () => {
  it("keeps payloads service-role only and claims with a fenced lease", () => {
    expect(migration).toContain(
      "alter table public.naia_whatsapp_inbound_queue enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.naia_whatsapp_inbound_queue",
    );
    expect(migration).toContain(
      "revoke all on sequence public.naia_whatsapp_inbound_queue_sequence_no_seq",
    );
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("lease_token = p_lease_token");
    expect(migration).toContain("earlier.sender_phone = queued.sender_phone");
    expect(migration).toContain(
      "organization_id uuid not null references public.organizations(id)",
    );
    expect(migration).toContain(
      "profile_id uuid not null references public.profiles(id)",
    );
    expect(migration).toContain("to service_role");
    expect(migration).not.toContain("security definer");
  });

  it("indexes both foreign-key leading columns", () => {
    expect(migration).toContain("(organization_id, profile_id, status)");
    expect(profileIndexMigration).toContain(
      "on public.naia_whatsapp_inbound_queue (profile_id)",
    );
  });

  it("makes private command history idempotent by Meta message id", () => {
    expect(historyDedupeMigration).toContain("add column if not exists wamid");
    expect(historyDedupeMigration).toContain(
      "create unique index if not exists naia_private_whatsapp_messages_wamid_idx",
    );
  });
});
