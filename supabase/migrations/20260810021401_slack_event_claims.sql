-- Slack retries event envelopes. Claim each event_id atomically so a replay
-- cannot schedule or publish a second response. Expired rows are safely
-- reused in place; no destructive cleanup is required.

create table if not exists public.slack_event_claims (
  event_id text primary key check (
    char_length(event_id) between 3 and 255
    and event_id ~ '^Ev[A-Za-z0-9_-]+$'
  ),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > claimed_at)
);

alter table public.slack_event_claims enable row level security;
revoke all on table public.slack_event_claims
from public, anon, authenticated;

create or replace function public.claim_slack_event(
  requested_event_id text,
  requested_ttl_seconds integer default 86400
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  claimed boolean;
begin
  if requested_event_id is null
    or char_length(requested_event_id) not between 3 and 255
    or requested_event_id !~ '^Ev[A-Za-z0-9_-]+$' then
    raise exception 'Slack event id is invalid' using errcode = '22023';
  end if;
  if requested_ttl_seconds < 300 or requested_ttl_seconds > 604800 then
    raise exception 'Slack event claim TTL is invalid' using errcode = '22023';
  end if;

  insert into public.slack_event_claims (
    event_id,
    claimed_at,
    expires_at
  ) values (
    requested_event_id,
    now(),
    now() + make_interval(secs => requested_ttl_seconds)
  )
  on conflict (event_id)
  do update
  set claimed_at = excluded.claimed_at,
      expires_at = excluded.expires_at
  where public.slack_event_claims.expires_at <= now()
  returning true into claimed;

  return coalesce(claimed, false);
end
$function$;

revoke execute on function public.claim_slack_event(text, integer)
from public, anon, authenticated;
grant execute on function public.claim_slack_event(text, integer)
to service_role;
