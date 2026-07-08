-- NAIA bridge approval tokens are single-use: the first execution claims the
-- sha256 of the token here, and any concurrent or repeated validation fails
-- on the primary key before any side effect runs. Rows are purged
-- opportunistically after 10 minutes (the tokens themselves expire after 5).
create table if not exists public.naia_consumed_action_tokens (
  token_hash text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  consumed_at timestamptz not null default now()
);

-- Service-role only: RLS is enabled with no policy on purpose, and the API
-- roles are revoked. Only the server-side service-role client (the NAIA
-- bridge) may read or write this table.
alter table public.naia_consumed_action_tokens enable row level security;

revoke all on table public.naia_consumed_action_tokens from anon, authenticated;
