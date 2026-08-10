set local statement_timeout = '10s';

do $test$
declare
  actor_id uuid;
  nabil_id uuid;
  outsider_id uuid := '20000000-0000-0000-0000-000000000093';
  first_allowed boolean;
  second_allowed boolean;
  third_allowed boolean;
  first_claim boolean;
  replay_claim boolean;
  expired_claim boolean;
  nabil_allowed boolean;
begin
  select id into actor_id
  from auth.users
  where lower(email) = 'ali@qarizmi.com'
  limit 1;

  if actor_id is null then
    actor_id := '20000000-0000-0000-0000-000000000091';
    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values (
      actor_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'ali@qarizmi.com',
      '',
      now(),
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );
  end if;

  select id into nabil_id
  from auth.users
  where lower(email) = 'nabil@qarizmi.com'
  limit 1;
  if nabil_id is null then
    nabil_id := '20000000-0000-0000-0000-000000000092';
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      nabil_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'nabil@qarizmi.com', '', now(),
      '{}'::jsonb, '{}'::jsonb, now(), now()
    );
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    outsider_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'member@qarizmi.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ) on conflict (id) do nothing;

  insert into public.profiles (id, email, full_name) values
    (actor_id, 'ali@qarizmi.com', 'Provider Security QA Ali'),
    (nabil_id, 'nabil@qarizmi.com', 'Provider Security QA Nabil'),
    (outsider_id, 'member@qarizmi.com', 'Provider Security QA Member')
  on conflict (id) do update set email = excluded.email;
  insert into public.organizations (id, name, slug)
  values (
    '10000000-0000-0000-0000-000000000091',
    'Provider Security QA',
    'provider-security-qa'
  )
  on conflict (id) do nothing;
  insert into public.organization_memberships (
    organization_id,
    profile_id,
    role
  ) values
    ('10000000-0000-0000-0000-000000000091', actor_id, 'owner'),
    ('10000000-0000-0000-0000-000000000091', nabil_id, 'owner'),
    ('10000000-0000-0000-0000-000000000091', outsider_id, 'admin')
  on conflict (organization_id, profile_id)
  do update set role = excluded.role;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);

  select allowed into first_allowed
  from public.consume_external_ai_daily_quota(
    'groq',
    'naia-completion',
    2
  );
  select allowed into second_allowed
  from public.consume_external_ai_daily_quota(
    'groq',
    'naia-completion',
    2
  );
  select allowed into third_allowed
  from public.consume_external_ai_daily_quota(
    'groq',
    'naia-completion',
    2
  );

  if not first_allowed or not second_allowed or third_allowed then
    raise exception 'External AI quota CAS did not enforce its exact limit';
  end if;

  perform set_config('request.jwt.claim.sub', nabil_id::text, true);
  select allowed into nabil_allowed
  from public.consume_external_ai_daily_quota(
    'groq',
    'crm-transcription',
    1
  );
  if not nabil_allowed then
    raise exception 'Reviewed Nabil identity was not allowed';
  end if;

  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  begin
    perform public.consume_external_ai_daily_quota(
      'groq',
      'naia-completion',
      2
    );
    raise exception 'Expected nonfounder quota denial';
  exception when insufficient_privilege then
    null;
  end;

  select public.claim_slack_event('EvProviderSecurityReplay91', 300)
  into first_claim;
  select public.claim_slack_event('EvProviderSecurityReplay91', 300)
  into replay_claim;
  if not first_claim or replay_claim then
    raise exception 'Slack replay was not deduplicated atomically';
  end if;

  update public.slack_event_claims
  set claimed_at = now() - interval '10 minutes',
      expires_at = now() - interval '5 minutes'
  where event_id = 'EvProviderSecurityReplay91';
  select public.claim_slack_event('EvProviderSecurityReplay91', 300)
  into expired_claim;
  if not expired_claim then
    raise exception 'Expired Slack claim was not safely reused';
  end if;

  begin
    perform public.claim_slack_event('EvInvalidTtl91', 60);
    raise exception 'Expected invalid Slack TTL rejection';
  exception when invalid_parameter_value then
    null;
  end;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.external_ai_daily_usage'::regclass
  ) or not (
    select relrowsecurity
    from pg_class
    where oid = 'public.slack_event_claims'::regclass
  ) then
    raise exception 'Provider security tables must keep RLS enabled';
  end if;
  if has_table_privilege(
    'authenticated',
    'public.external_ai_daily_usage',
    'select'
  ) or has_table_privilege(
    'authenticated',
    'public.slack_event_claims',
    'select'
  ) then
    raise exception 'Authenticated received forbidden direct table access';
  end if;
  if has_function_privilege(
    'anon',
    'public.consume_external_ai_daily_quota(text,text,integer)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_slack_event(text,integer)',
    'execute'
  ) then
    raise exception 'Provider security RPC grants are too broad';
  end if;
end
$test$;
