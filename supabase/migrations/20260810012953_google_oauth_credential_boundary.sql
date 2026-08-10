-- Google OAuth credentials are server-only secrets. Row-level security alone
-- cannot hide one column from an otherwise visible row, so the browser role
-- receives column-level SELECT on metadata and no table/DML privileges.

alter table public.integration_connections
  add column if not exists server_review_reason text;

alter table public.integration_connections
  drop constraint if exists integration_connections_server_review_reason_check;
alter table public.integration_connections
  add constraint integration_connections_server_review_reason_check
  check (
    server_review_reason is null
    or server_review_reason in (
      'legacy-unattested',
      'identity-attestation-failed',
      'scope-attestation-failed',
      'revocation-failed'
    )
  );

-- Existing rows were created while authenticated users could mutate their
-- own scope/status attestation. Their credentials are retained so a proven
-- Google revocation remains possible, but they cannot be used again until a
-- server-side provider attestation (or an interactive reconnect) succeeds.
update public.integration_connections
set status = 'needs-review',
    server_review_reason = 'legacy-unattested',
    updated_at = now()
where provider = 'google'
  and status = 'connected';

drop policy if exists "users can manage their own integration connections"
  on public.integration_connections;
drop policy if exists "admins can manage integration connections"
  on public.integration_connections;

-- Clear historical/default table grants first. A table-level SELECT would
-- override the column boundary below and make encrypted_token_reference
-- readable through PostgREST even with a self-row RLS policy.
revoke all privileges on table public.integration_connections from public;
revoke all privileges on table public.integration_connections from anon;
revoke all privileges on table public.integration_connections from authenticated;

grant select (
  id,
  organization_id,
  provider,
  status,
  external_account_label,
  scopes,
  connected_by_profile_id,
  connected_at,
  created_at,
  updated_at
) on table public.integration_connections to authenticated;

-- Explicitly retain the trusted runtime boundary. service_role bypasses RLS,
-- while every application query still scopes Google rows by id, org,
-- provider and profile before reading or writing credential material.
grant all privileges on table public.integration_connections to service_role;

-- Keep the one safe browser policy. DML has no policy and, independently, no
-- INSERT/UPDATE/DELETE grant for authenticated.
drop policy if exists "users can read their own integration connections"
  on public.integration_connections;
create policy "users can read their own integration connections"
on public.integration_connections for select
to authenticated
using ((select auth.uid()) = connected_by_profile_id);

comment on column public.integration_connections.encrypted_token_reference is
  'Server-only Google/provider credential envelope; never selectable by browser roles.';
comment on column public.integration_connections.scopes is
  'Provider-attested server metadata; browser-readable but server-writable only.';
comment on column public.integration_connections.server_review_reason is
  'Server-only fail-closed reason; revocation-failed gates explicit manual confirmation.';
