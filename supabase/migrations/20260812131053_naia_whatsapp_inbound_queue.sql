-- Durable inbox for the private NAIA WhatsApp bridge. Authorized webhook
-- messages are persisted before Meta receives HTTP 200, then claimed with a
-- fenced lease. A recovery cron can resume an interrupted Vercel invocation
-- without processing two messages from the same sender concurrently.

create table if not exists public.naia_whatsapp_inbound_queue (
  id uuid primary key default gen_random_uuid(),
  sequence_no bigint generated always as identity unique,
  wamid text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  authorized_email text not null,
  sender_phone text not null,
  message_kind text not null,
  text_body text,
  media_id text,
  button_reply_id text,
  status text not null default 'queued',
  attempts smallint not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint naia_whatsapp_inbound_queue_wamid_length_check
    check (char_length(wamid) between 1 and 512),
  constraint naia_whatsapp_inbound_queue_email_length_check
    check (char_length(authorized_email) between 3 and 320),
  constraint naia_whatsapp_inbound_queue_sender_phone_check
    check (sender_phone ~ '^[0-9]{7,20}$'),
  constraint naia_whatsapp_inbound_queue_message_kind_check
    check (message_kind in ('text', 'audio', 'button_reply')),
  constraint naia_whatsapp_inbound_queue_status_check
    check (status in ('queued', 'processing', 'completed', 'failed')),
  constraint naia_whatsapp_inbound_queue_attempts_check
    check (attempts between 0 and 5),
  constraint naia_whatsapp_inbound_queue_payload_check
    check (
      (
        status = 'completed'
        and text_body is null
        and media_id is null
        and button_reply_id is null
      )
      or (
        status <> 'completed'
        and (
          (
            message_kind = 'text'
            and text_body is not null
            and char_length(text_body) between 1 and 2000
            and media_id is null
            and button_reply_id is null
          )
          or (
            message_kind = 'audio'
            and media_id is not null
            and char_length(media_id) between 1 and 256
            and text_body is null
            and button_reply_id is null
          )
          or (
            message_kind = 'button_reply'
            and button_reply_id is not null
            and char_length(button_reply_id) between 1 and 256
            and text_body is null
            and media_id is null
          )
        )
      )
    )
);

create index if not exists naia_whatsapp_inbound_queue_claim_idx
  on public.naia_whatsapp_inbound_queue (status, available_at, sequence_no);

create index if not exists naia_whatsapp_inbound_queue_sender_order_idx
  on public.naia_whatsapp_inbound_queue (sender_phone, sequence_no)
  where status in ('queued', 'processing');

create index if not exists naia_whatsapp_inbound_queue_scope_idx
  on public.naia_whatsapp_inbound_queue (organization_id, profile_id, status);

create index if not exists naia_whatsapp_inbound_queue_lease_recovery_idx
  on public.naia_whatsapp_inbound_queue (lease_expires_at)
  where status = 'processing';

create index if not exists naia_whatsapp_inbound_queue_retention_idx
  on public.naia_whatsapp_inbound_queue (updated_at)
  where status in ('completed', 'failed');

alter table public.naia_whatsapp_inbound_queue enable row level security;

revoke all on table public.naia_whatsapp_inbound_queue
from public, anon, authenticated;
revoke all on sequence public.naia_whatsapp_inbound_queue_sequence_no_seq
from public, anon, authenticated;
grant usage, select, update
on sequence public.naia_whatsapp_inbound_queue_sequence_no_seq
to service_role;

create or replace function public.claim_naia_whatsapp_inbound_message(
  p_lease_token uuid,
  p_lease_seconds integer default 360
)
returns table (
  id uuid,
  wamid text,
  organization_id uuid,
  profile_id uuid,
  authorized_email text,
  sender_phone text,
  message_kind text,
  text_body text,
  media_id text,
  button_reply_id text,
  attempts smallint,
  lease_token uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_lease_token is null then
    raise exception 'p_lease_token is required';
  end if;

  -- A worker killed on its final allowed attempt must not block every later
  -- message from the same sender forever.
  update public.naia_whatsapp_inbound_queue as expired
  set
    status = 'failed',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = coalesce(expired.last_error_code, 'processing_lease_exhausted'),
    updated_at = now()
  where expired.attempts >= 5
    and (
      expired.status = 'queued'
      or (
        expired.status = 'processing'
        and expired.lease_expires_at < now()
      )
    );

  return query
  with candidate as (
    select queued.id
    from public.naia_whatsapp_inbound_queue as queued
    where queued.attempts < 5
      and (
        (
          queued.status = 'queued'
          and queued.available_at <= now()
        )
        or (
          queued.status = 'processing'
          and queued.lease_expires_at < now()
        )
      )
      and not exists (
        select 1
        from public.naia_whatsapp_inbound_queue as earlier
        where earlier.sender_phone = queued.sender_phone
          and earlier.status in ('queued', 'processing')
          and earlier.sequence_no < queued.sequence_no
      )
    order by queued.sequence_no
    for update skip locked
    limit 1
  ), claimed as (
    update public.naia_whatsapp_inbound_queue as inbox
    set
      status = 'processing',
      attempts = inbox.attempts + 1,
      lease_token = p_lease_token,
      lease_expires_at = now() + make_interval(
        secs => greatest(60, least(coalesce(p_lease_seconds, 360), 900))
      ),
      last_error_code = null,
      updated_at = now()
    from candidate
    where inbox.id = candidate.id
    returning inbox.*
  )
  select
    claimed.id,
    claimed.wamid,
    claimed.organization_id,
    claimed.profile_id,
    claimed.authorized_email,
    claimed.sender_phone,
    claimed.message_kind,
    claimed.text_body,
    claimed.media_id,
    claimed.button_reply_id,
    claimed.attempts,
    claimed.lease_token
  from claimed;
end;
$$;

revoke all on function public.claim_naia_whatsapp_inbound_message(uuid, integer)
from public, anon, authenticated;
grant execute on function public.claim_naia_whatsapp_inbound_message(uuid, integer)
to service_role;
