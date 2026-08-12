-- Deliver the same private NAIA brief independently to Slack and WhatsApp.
-- Existing rows are Slack runs. A per-channel key prevents one provider from
-- suppressing or replaying the other provider's delivery.

alter table public.naia_daily_brief_runs
  add column if not exists delivery_channel text not null default 'slack',
  add column if not exists whatsapp_message_id text;

alter table public.naia_daily_brief_runs
  drop constraint if exists naia_daily_brief_runs_profile_id_local_date_key;

alter table public.naia_daily_brief_runs
  add constraint naia_daily_brief_runs_delivery_channel_check
  check (delivery_channel in ('slack', 'whatsapp'));

create unique index if not exists naia_daily_brief_runs_profile_date_channel_idx
  on public.naia_daily_brief_runs (profile_id, local_date, delivery_channel);

create or replace function public.reclaim_naia_daily_brief_run(
  p_organization_id uuid,
  p_profile_id uuid,
  p_local_date date,
  p_delivery_channel text
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
    whatsapp_message_id = null,
    sent_at = null,
    delivery_started_at = null,
    updated_at = now()
  where runs.organization_id = p_organization_id
    and runs.profile_id = p_profile_id
    and runs.local_date = p_local_date
    and runs.delivery_channel = p_delivery_channel
    and p_delivery_channel in ('slack', 'whatsapp')
    and (
      runs.status = 'failed'
      or (
        runs.status = 'sending'
        and runs.delivery_started_at is null
        and runs.updated_at < now() - interval '10 minutes'
      )
    )
  returning runs.id;
$$;

revoke all on function public.reclaim_naia_daily_brief_run(uuid, uuid, date, text)
from public, anon, authenticated;
grant execute on function public.reclaim_naia_daily_brief_run(uuid, uuid, date, text)
to service_role;

-- Keep the previous Slack-only signature during rolling deployments. Older
-- Vercel instances can still reclaim only their Slack row while the new code
-- starts using the channel-aware overload.
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
  select reclaimed.id
  from public.reclaim_naia_daily_brief_run(
    p_organization_id,
    p_profile_id,
    p_local_date,
    'slack'
  ) as reclaimed;
$$;

revoke all on function public.reclaim_naia_daily_brief_run(uuid, uuid, date)
from public, anon, authenticated;
grant execute on function public.reclaim_naia_daily_brief_run(uuid, uuid, date)
to service_role;
