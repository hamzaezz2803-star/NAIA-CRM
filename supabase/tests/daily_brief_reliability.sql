set local statement_timeout = '10s';

do $test$
declare
  qa_organization_id constant uuid := '10000000-0000-0000-0000-000000000094';
  qa_profile_id constant uuid := '20000000-0000-0000-0000-000000000094';
  reclaimed_count integer;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    qa_profile_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'daily-brief-qa@qarizmi.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ) on conflict (id) do nothing;

  insert into public.profiles (id, email, full_name)
  values (qa_profile_id, 'daily-brief-qa@qarizmi.com', 'Daily Brief QA')
  on conflict (id) do update set email = excluded.email;
  insert into public.organizations (id, name, slug)
  values (qa_organization_id, 'Daily Brief Reliability QA', 'daily-brief-reliability-qa')
  on conflict (id) do nothing;

  insert into public.naia_daily_brief_runs (
    organization_id, profile_id, local_date, delivery_channel, status, updated_at
  ) values (
    qa_organization_id, qa_profile_id, date '2094-01-01', 'whatsapp', 'sending', now()
  ) on conflict (profile_id, local_date, delivery_channel) do update set
    delivery_started_at = null,
    status = 'sending',
    updated_at = now();

  select count(*) into reclaimed_count
  from public.reclaim_naia_daily_brief_run(
    qa_organization_id, qa_profile_id, date '2094-01-01', 'whatsapp'
  );
  if reclaimed_count <> 0 then
    raise exception 'A non-stale sending run was reclaimed';
  end if;

  update public.naia_daily_brief_runs
  set updated_at = now() - interval '11 minutes'
  where profile_id = qa_profile_id
    and local_date = date '2094-01-01'
    and delivery_channel = 'whatsapp';
  select count(*) into reclaimed_count
  from public.reclaim_naia_daily_brief_run(
    qa_organization_id, qa_profile_id, date '2094-01-01', 'whatsapp'
  );
  if reclaimed_count <> 1 then
    raise exception 'A stale pre-delivery sending run was not reclaimed';
  end if;

  select count(*) into reclaimed_count
  from public.reclaim_naia_daily_brief_run(
    qa_organization_id, qa_profile_id, date '2094-01-01', 'whatsapp'
  );
  if reclaimed_count <> 0 then
    raise exception 'The reclaimed run was replayed concurrently';
  end if;

  update public.naia_daily_brief_runs
  set
    delivery_started_at = now() - interval '11 minutes',
    status = 'sending',
    updated_at = now() - interval '11 minutes'
  where profile_id = qa_profile_id
    and local_date = date '2094-01-01'
    and delivery_channel = 'whatsapp';
  select count(*) into reclaimed_count
  from public.reclaim_naia_daily_brief_run(
    qa_organization_id, qa_profile_id, date '2094-01-01', 'whatsapp'
  );
  if reclaimed_count <> 0 then
    raise exception 'An ambiguous post-delivery run was reclaimed';
  end if;
end
$test$;
