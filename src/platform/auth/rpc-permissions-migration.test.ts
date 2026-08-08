import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260808225532_harden_rpc_execute_permissions.sql",
  ),
  "utf8",
);

describe("RPC permission hardening migration", () => {
  it("keeps authenticated RLS helpers unavailable to anonymous callers", () => {
    expect(migration).toContain(
      "revoke execute on function public.ensure_membership() from public, anon",
    );
    expect(migration).toContain(
      "revoke execute on function public.is_org_admin(uuid) from public, anon",
    );
    expect(migration).toContain(
      "revoke execute on function public.is_org_contributor(uuid) from public, anon",
    );
    expect(migration).toContain(
      "revoke execute on function public.is_org_member(uuid) from public, anon",
    );
  });

  it("does not expose trigger functions as authenticated RPCs", () => {
    expect(migration).toContain(
      "revoke execute on function public.handle_new_user() from public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke execute on function public.sync_meeting_from_crm_lead()",
    );
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain(
      "to_regprocedure('public.rls_auto_enable()') is not null",
    );
  });
});
