\set ON_ERROR_STOP on

-- Run immediately before the credential-boundary migration inside one
-- disposable transaction. This proves that previously browser-mutable Google
-- rows are quarantined without deleting their revocation credential.
insert into public.organizations (id, name, slug)
values (
  '1f000000-0000-0000-0000-000000000002',
  'OAuth Legacy QA',
  'oauth-legacy-qa'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '2f000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'oauth-legacy@qarizmi.com', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
)
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name)
values (
  '2f000000-0000-0000-0000-000000000002',
  'oauth-legacy@qarizmi.com',
  'OAuth Legacy QA'
)
on conflict (id) do nothing;

insert into public.organization_memberships (organization_id, profile_id, role)
values (
  '1f000000-0000-0000-0000-000000000002',
  '2f000000-0000-0000-0000-000000000002',
  'owner'
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
  connected_at
)
values (
  '3f000000-0000-0000-0000-000000000002',
  '1f000000-0000-0000-0000-000000000002',
  'google',
  'connected',
  'oauth-legacy@qarizmi.com',
  array[
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.freebusy',
    'https://www.googleapis.com/auth/gmail.readonly'
  ],
  '{"refresh_token":"synthetic-legacy-revocation-token"}',
  '2f000000-0000-0000-0000-000000000002',
  now()
);
