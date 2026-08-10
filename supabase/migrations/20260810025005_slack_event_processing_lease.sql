-- Recover the narrow crash window between an Events API claim and Next.js
-- `after()` registration without permitting two workers to publish. No Slack
-- payload is persisted: the signed retry supplies it again. A short lease can
-- be stolen only while processing; a fencing token must then atomically move
-- the row to the terminal publishing boundary before chat.postMessage.

alter table public.slack_event_claims
  add column if not exists processing_state text not null default 'completed',
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

alter table public.slack_event_claims
  drop constraint if exists slack_event_claims_processing_state_check,
  drop constraint if exists slack_event_claims_processing_lease_check;

alter table public.slack_event_claims
  add constraint slack_event_claims_processing_state_check
    check (processing_state in ('processing', 'publishing', 'completed')),
  add constraint slack_event_claims_processing_lease_check
    check (
      processing_state <> 'processing'
      or (lease_token is not null and lease_expires_at is not null)
    );

revoke execute on function public.claim_slack_event(text, integer)
from service_role;
drop function public.claim_slack_event(text, integer);

create function public.lease_slack_event(
  requested_event_id text,
  requested_lease_token uuid,
  requested_force_takeover boolean default false,
  requested_lease_seconds integer default 30,
  requested_ttl_seconds integer default 86400
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acquired boolean;
begin
  if requested_event_id is null
    or char_length(requested_event_id) not between 3 and 255
    or requested_event_id !~ '^Ev[A-Za-z0-9_-]+$' then
    raise exception 'Slack event id is invalid' using errcode = '22023';
  end if;
  if requested_lease_token is null then
    raise exception 'Slack event lease token is invalid' using errcode = '22023';
  end if;
  if requested_lease_seconds < 1 or requested_lease_seconds > 300 then
    raise exception 'Slack event lease duration is invalid' using errcode = '22023';
  end if;
  if requested_ttl_seconds < 300 or requested_ttl_seconds > 604800 then
    raise exception 'Slack event claim TTL is invalid' using errcode = '22023';
  end if;

  insert into public.slack_event_claims (
    event_id,
    claimed_at,
    expires_at,
    processing_state,
    lease_token,
    lease_expires_at
  ) values (
    requested_event_id,
    now(),
    now() + make_interval(secs => requested_ttl_seconds),
    'processing',
    requested_lease_token,
    now() + make_interval(secs => requested_lease_seconds)
  )
  on conflict (event_id)
  do update
  set claimed_at = excluded.claimed_at,
      expires_at = excluded.expires_at,
      processing_state = excluded.processing_state,
      lease_token = excluded.lease_token,
      lease_expires_at = excluded.lease_expires_at
  where public.slack_event_claims.expires_at <= now()
    or (
      public.slack_event_claims.processing_state = 'processing'
      and (
        requested_force_takeover
        or public.slack_event_claims.lease_expires_at <= now()
      )
    )
  returning true into acquired;

  return coalesce(acquired, false);
end
$function$;

create function public.begin_slack_event_publish(
  requested_event_id text,
  requested_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acquired boolean;
begin
  update public.slack_event_claims
  set processing_state = 'publishing',
      lease_expires_at = null
  where event_id = requested_event_id
    and processing_state = 'processing'
    and lease_token = requested_lease_token
  returning true into acquired;

  return coalesce(acquired, false);
end
$function$;

create function public.complete_slack_event_publish(
  requested_event_id text,
  requested_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  completed boolean;
begin
  update public.slack_event_claims
  set processing_state = 'completed'
  where event_id = requested_event_id
    and processing_state = 'publishing'
    and lease_token = requested_lease_token
  returning true into completed;

  return coalesce(completed, false);
end
$function$;

revoke execute on function public.lease_slack_event(text, uuid, boolean, integer, integer)
from public, anon, authenticated;
revoke execute on function public.begin_slack_event_publish(text, uuid)
from public, anon, authenticated;
revoke execute on function public.complete_slack_event_publish(text, uuid)
from public, anon, authenticated;

grant execute on function public.lease_slack_event(text, uuid, boolean, integer, integer)
to service_role;
grant execute on function public.begin_slack_event_publish(text, uuid)
to service_role;
grant execute on function public.complete_slack_event_publish(text, uuid)
to service_role;
