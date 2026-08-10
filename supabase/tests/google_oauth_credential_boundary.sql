\set ON_ERROR_STOP on

begin;

set local statement_timeout = '10s';

do $assertions$
declare
  legacy_status text;
  legacy_reason text;
  credential_retained boolean;
begin
  select
    status,
    server_review_reason,
    encrypted_token_reference is not null
  into legacy_status, legacy_reason, credential_retained
  from public.integration_connections
  where id = '3f000000-0000-0000-0000-000000000002';

  if legacy_status <> 'needs-review'
     or legacy_reason <> 'legacy-unattested'
     or not credential_retained then
    raise exception 'legacy Google credential was not quarantined safely';
  end if;
end
$assertions$;

select
  coalesce(
    (select id::text from auth.users where lower(email) = 'oauth-boundary@qarizmi.com' limit 1),
    '2f000000-0000-0000-0000-000000000001'
  ) as profile_id
\gset

insert into public.organizations (id, name, slug)
values (
  '1f000000-0000-0000-0000-000000000001',
  'OAuth Boundary QA',
  'oauth-boundary-qa'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  :'profile_id',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'oauth-boundary@qarizmi.com', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
)
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name)
values (:'profile_id', 'oauth-boundary@qarizmi.com', 'OAuth QA')
on conflict (id) do nothing;

insert into public.organization_memberships (organization_id, profile_id, role)
values (
  '1f000000-0000-0000-0000-000000000001', :'profile_id', 'owner'
)
on conflict (organization_id, profile_id) do update set role = excluded.role;

insert into public.integration_connections (
  id,
  organization_id,
  provider,
  status,
  external_account_label,
  scopes,
  encrypted_token_reference,
  connected_by_profile_id,
  server_review_reason,
  connected_at
)
values (
  '3f000000-0000-0000-0000-000000000001',
  '1f000000-0000-0000-0000-000000000001',
  'google',
  'connected',
  'oauth-boundary@qarizmi.com',
  array[
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.freebusy',
    'https://www.googleapis.com/auth/gmail.readonly'
  ],
  '{"access_token":"synthetic-test-token"}',
  :'profile_id',
  null,
  now()
);

do $assertions$
begin
  if has_table_privilege('authenticated', 'public.integration_connections', 'SELECT') then
    raise exception 'authenticated retained table-level SELECT';
  end if;
  if has_table_privilege('authenticated', 'public.integration_connections', 'INSERT')
     or has_table_privilege('authenticated', 'public.integration_connections', 'UPDATE')
     or has_table_privilege('authenticated', 'public.integration_connections', 'DELETE') then
    raise exception 'authenticated retained connection DML';
  end if;
  if not has_column_privilege(
    'authenticated', 'public.integration_connections', 'status', 'SELECT'
  ) or not has_column_privilege(
    'authenticated', 'public.integration_connections', 'scopes', 'SELECT'
  ) then
    raise exception 'authenticated cannot read safe connection metadata';
  end if;
  if has_column_privilege(
    'authenticated',
    'public.integration_connections',
    'encrypted_token_reference',
    'SELECT'
  ) or has_column_privilege(
    'authenticated',
    'public.integration_connections',
    'server_review_reason',
    'SELECT'
  ) then
    raise exception 'authenticated can read server-only credential columns';
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'integration_connections'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'connection DML RLS policy still exists';
  end if;
  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure.prosrc ilike '%integration_connections%'
      and procedure.prosrc ilike '%encrypted_token_reference%'
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  ) then
    raise exception 'authenticated executable RPC exposes Google credentials';
  end if;
end
$assertions$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'profile_id', true);

do $assertions$
declare
  operation_succeeded boolean;
  own_rows integer;
begin
  select count(*) into own_rows
  from public.integration_connections
  where id = '3f000000-0000-0000-0000-000000000001';
  if own_rows <> 1 then
    raise exception 'self-select metadata policy failed';
  end if;

  operation_succeeded := false;
  begin
    execute 'select encrypted_token_reference from public.integration_connections limit 1';
    operation_succeeded := true;
  exception when insufficient_privilege then
    null;
  end;
  if operation_succeeded then
    raise exception 'browser selected encrypted token reference';
  end if;

  operation_succeeded := false;
  begin
    update public.integration_connections
    set scopes = array['https://www.googleapis.com/auth/gmail.send'],
        status = 'connected'
    where id = '3f000000-0000-0000-0000-000000000001';
    operation_succeeded := true;
  exception when insufficient_privilege then
    null;
  end;
  if operation_succeeded then
    raise exception 'browser falsified scopes/status';
  end if;

  operation_succeeded := false;
  begin
    delete from public.integration_connections
    where id = '3f000000-0000-0000-0000-000000000001';
    operation_succeeded := true;
  exception when insufficient_privilege then
    null;
  end;
  if operation_succeeded then
    raise exception 'browser deleted provider connection';
  end if;
end
$assertions$;

reset role;

do $assertions$
begin
  if not has_column_privilege(
    'service_role',
    'public.integration_connections',
    'encrypted_token_reference',
    'SELECT'
  ) or not has_table_privilege(
    'service_role', 'public.integration_connections', 'UPDATE'
  ) then
    raise exception 'service_role credential boundary is incomplete';
  end if;
end
$assertions$;

rollback;
