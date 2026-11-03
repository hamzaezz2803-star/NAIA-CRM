-- The external AI daily quota (Groq transcription/completion, ElevenLabs voice)
-- was restricted to the two hard-coded cofounder emails, so every other
-- organization owner or admin got "external-ai-quota-unavailable" even though
-- the application gate (AUTH_ALLOWED_EMAILS + owner/admin role) accepted them.
-- Align the database with the application: any owner or admin member may
-- consume the quota. The per-user daily limit is unchanged.

create or replace function public.consume_external_ai_daily_quota(
  requested_provider text,
  requested_operation text,
  requested_limit integer
)
returns table(allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_count integer;
begin
  if actor_id is null then
    raise exception 'External AI quota requires authentication'
      using errcode = '28000';
  end if;

  if requested_limit < 1 or requested_limit > 1000 then
    raise exception 'External AI quota limit is invalid'
      using errcode = '22023';
  end if;
  if requested_provider not in ('groq', 'elevenlabs') then
    raise exception 'External AI provider is invalid'
      using errcode = '22023';
  end if;
  if requested_operation not in (
    'crm-transcription',
    'naia-completion',
    'naia-transcription',
    'naia-voice'
  ) then
    raise exception 'External AI operation is invalid'
      using errcode = '22023';
  end if;

  perform 1
  from public.organization_memberships membership
  where membership.profile_id = actor_id
    and membership.role in ('owner', 'admin')
  limit 1;
  if not found then
    raise exception 'External AI quota is restricted to owner or admin members'
      using errcode = '42501';
  end if;

  insert into public.external_ai_daily_usage (
    profile_id,
    usage_date,
    provider,
    operation,
    request_count,
    updated_at
  ) values (
    actor_id,
    (timezone('utc', now()))::date,
    requested_provider,
    requested_operation,
    1,
    now()
  )
  on conflict (profile_id, usage_date, provider, operation)
  do update
  set request_count = public.external_ai_daily_usage.request_count + 1,
      updated_at = now()
  where public.external_ai_daily_usage.request_count < requested_limit
  returning request_count into next_count;

  if next_count is null then
    return query select false, 0;
  else
    return query select true, greatest(requested_limit - next_count, 0);
  end if;
end
$$;
