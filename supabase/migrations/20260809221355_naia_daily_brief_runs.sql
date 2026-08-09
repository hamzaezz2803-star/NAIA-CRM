-- Idempotence and audit trail for the private 09:30 NAIA Slack briefing.
-- The service-role cron is the only writer. The table deliberately has no
-- authenticated Data API grant because brief delivery metadata is operational
-- infrastructure, not shared organization content.

create table if not exists public.naia_daily_brief_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'failed', 'delivery_uncertain')),
  slack_channel_id text,
  slack_message_ts text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (profile_id, local_date)
);

create index if not exists naia_daily_brief_runs_org_date_idx
  on public.naia_daily_brief_runs (organization_id, local_date desc);

alter table public.naia_daily_brief_runs enable row level security;

revoke all on public.naia_daily_brief_runs from anon, authenticated, service_role;
grant select, insert, update on public.naia_daily_brief_runs to service_role;

-- A failed run is safe to retry only when application code proved that Slack
-- did not accept the message. Reclaiming it must be atomic so concurrent cron
-- deliveries cannot both turn the same failed row back into a sender claim.
create or replace function public.reclaim_naia_daily_brief_run(
  p_organization_id uuid,
  p_profile_id uuid,
  p_local_date date
)
returns table (id uuid)
language sql
security invoker
set search_path = ''
as $$
  update public.naia_daily_brief_runs as runs
  set
    status = 'sending',
    error_code = null,
    slack_channel_id = null,
    slack_message_ts = null,
    sent_at = null,
    updated_at = now()
  where runs.organization_id = p_organization_id
    and runs.profile_id = p_profile_id
    and runs.local_date = p_local_date
    and runs.status = 'failed'
  returning runs.id;
$$;

revoke all on function public.reclaim_naia_daily_brief_run(uuid, uuid, date)
from public, anon, authenticated;
grant execute on function public.reclaim_naia_daily_brief_run(uuid, uuid, date)
to service_role;
