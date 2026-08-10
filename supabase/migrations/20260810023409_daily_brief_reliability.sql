-- Bound daily-brief retries without ever replaying an ambiguous Slack send.
-- `delivery_started_at` is written durably before chat.postMessage. A stale
-- sending row is reclaimable only while that marker is still null, which
-- proves the previous worker never crossed the delivery boundary.

alter table public.naia_daily_brief_runs
  add column if not exists delivery_started_at timestamptz;

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
    delivery_started_at = null,
    updated_at = now()
  where runs.organization_id = p_organization_id
    and runs.profile_id = p_profile_id
    and runs.local_date = p_local_date
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

revoke all on function public.reclaim_naia_daily_brief_run(uuid, uuid, date)
from public, anon, authenticated;
grant execute on function public.reclaim_naia_daily_brief_run(uuid, uuid, date)
to service_role;
