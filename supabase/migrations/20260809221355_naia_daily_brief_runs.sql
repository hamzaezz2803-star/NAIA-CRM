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
    check (status in ('sending', 'sent', 'failed')),
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
